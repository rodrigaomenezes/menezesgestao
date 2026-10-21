// Fase 8.3: campos de inteligência (FR-006 e completude do BPI), concordância IA × equipe com liberação pelo
// percentual da empresa (DEC-010) e o encerramento guiado visível na oportunidade.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comEmpresa } from "../../apps/api/src/infra/banco.js";
import { mensagensDaConversa } from "../../apps/api/src/modulos/bre/bre.servico.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);
const pessoa = (chave: string) => e.a.pessoas[chave]!.usuarioId;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

describe("campos de inteligência", () => {
  it("o registro mostra o que falta saber, e a completude do BPI passa a ser sobre esses campos", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    for (const [rotulo, chave, inteligenciaBre] of [
      ["Perfume favorito", "perfume_favorito", true],
      ["Ocasião de uso", "ocasiao", true],
      ["Código antigo", "codigo_antigo", false],
    ] as const) {
      const r = await dono.pedir("POST", "/api/crm/campos", { entidade: "contato", chave, rotulo, tipo: "texto", inteligenciaBre });
      expect(r.statusCode, r.body).toBe(201);
    }
    const campos = (await dono.get("/api/crm/campos")).json();
    expect(campos.filter((c: { inteligenciaBre: boolean }) => c.inteligenciaBre).map((c: { chave: string }) => c.chave).sort()).toEqual(["ocasiao", "perfume_favorito"]);

    const contatoId = (
      await sql("INSERT INTO contato (empresa_id, nome, responsavel_id, campos) VALUES ($1, 'Com dados', $2, $3) RETURNING id", [
        e.a.empresaId,
        pessoa("vendedor"),
        JSON.stringify({ perfume_favorito: "Amadeirado", codigo_antigo: "X1" }),
      ])
    ).rows[0].id;
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get(`/api/bre/contatos/${contatoId}/inteligencia`)).json()).toEqual({ campos: 2, preenchidos: 1, faltando: ["Ocasião de uso"] });
    const outro = await logado(t.app, email(e.a, "vendedor2"));
    expect((await outro.get(`/api/bre/contatos/${contatoId}/inteligencia`)).statusCode).toBe(404);

    // Completude pelos campos: com os 2 preenchidos, 100% (o registro só tem a emoção: pelo jeito antigo daria 25%).
    await sql("UPDATE contato SET campos = campos || $2 WHERE id = $1", [contatoId, JSON.stringify({ ocasiao: "Trabalho" })]);
    const r = await vendedor.pedir("POST", "/api/bre/registros", {
      contatoId,
      resultado: "ADVANCED",
      temperatura: "HOT",
      estadoEmocional: "INTERESTED",
      proximaAcao: "CALL_BACK",
      retornoEm: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10),
    });
    expect(r.statusCode).toBe(201);
    const bpi = (await dono.get("/api/bre/desempenho")).json();
    expect(bpi.itens.find((i: { usuarioId: string }) => i.usuarioId === pessoa("vendedor")).pilares.inteligencia).toBe(100);
  });
});

describe("concordância IA × equipe (DEC-010)", () => {
  /** n pares análise → registro na mesma conversa, em ordem; `diferentes` deles com temperatura diferente. */
  let lote = 0;
  async function pares(n: number, diferentes: number, bloqueio = false) {
    const base = 1000 * ++lote; // cada lote fica depois do anterior (a amostra é a mais recente)
    const canal = (await sql("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, 'Demo', 'demonstracao') RETURNING id", [e.a.empresaId])).rows[0].id;
    const contato = (await sql("INSERT INTO contato (empresa_id, nome) VALUES ($1, 'Amostra') RETURNING id", [e.a.empresaId])).rows[0].id;
    const conv = (await sql("INSERT INTO conversa (empresa_id, canal_id, contato_id) VALUES ($1, $2, $3) RETURNING id", [e.a.empresaId, canal, contato])).rows[0].id;
    for (let i = 0; i < n; i++) {
      const saida = { resultado: "ADVANCED", temperatura: "HOT", break: null };
      await sql(
        `INSERT INTO analise_bre (empresa_id, conversa_id, contato_id, provedor, doutrina, saida, bloqueios, autor_id, criado_em)
         VALUES ($1, $2, $3, 'demonstracao', 'BRE-v1.0 / ETR 0.2', $4, $5, $6, now() + make_interval(secs => $7))`,
        [e.a.empresaId, conv, contato, JSON.stringify(saida), JSON.stringify(bloqueio && i === 0 ? ["Desconto não sugerido"] : []), pessoa("dono"), base + 2 * i],
      );
      await sql(
        `INSERT INTO registro_bre (empresa_id, contato_id, conversa_id, autor_id, resultado, temperatura, proxima_acao, criado_em)
         VALUES ($1, $2, $3, $4, 'ADVANCED', $5, 'CALL_BACK', now() + make_interval(secs => $6))`,
        [e.a.empresaId, contato, conv, pessoa("vendedor"), i < diferentes ? "COLD" : "HOT", base + 2 * i + 1],
      );
      await sql(
        `INSERT INTO sq_bre (empresa_id, conversa_id, avaliado_id, provedor, previa, nota_previa, confirmada, nota, confirmada_por, confirmada_em, criado_por)
         VALUES ($1, $2, $3, 'demonstracao', '{}', 70, '{}', 73, $4, now() + make_interval(secs => $5), $4)`,
        [e.a.empresaId, conv, pessoa("vendedor"), pessoa("dono"), base + 2 * i + 1],
      );
    }
  }

  it("sem amostra não libera; com concordância e sem bloqueio libera; abaixo do percentual ou com bloqueio, não", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    await dono.pedir("PUT", "/api/bre/config", { amostraParaAutomacao: 20, concordanciaParaAutomacao: 85 });
    const vazio = (await dono.get("/api/bre/concordancia")).json();
    expect(vazio).toMatchObject({ liberado: false, amostraMinima: 20, percentualMinimo: 85 });
    expect(vazio.motivo).toContain("Amostra ainda pequena");

    await pares(20, 0);
    const ok = (await dono.get("/api/bre/concordancia")).json();
    expect(ok.campos.map((c: { percentual: number }) => c.percentual)).toEqual([100, 100, 100, 100]);
    expect(ok).toMatchObject({ liberado: true, analises: 20, analisesComBloqueio: 0 });

    // A amostra é a mais recente: 20 novos pares, 4 com temperatura diferente → 80%.
    await pares(20, 4);
    const baixo = (await dono.get("/api/bre/concordancia")).json();
    expect(baixo.campos.find((c: { campo: string }) => c.campo === "temperatura").percentual).toBe(80);
    expect(baixo).toMatchObject({ liberado: false, motivo: '"Temperatura" está em 80%, abaixo dos 85% definidos.' });

    await pares(20, 0, true);
    const barrado = (await dono.get("/api/bre/concordancia")).json();
    expect(barrado).toMatchObject({ liberado: false, analisesComBloqueio: 1 });

    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get("/api/bre/concordancia")).statusCode).toBe(403);
  });
});

describe("encerramento guiado na oportunidade", () => {
  it("a oportunidade passa a dizer que foi encerrada pelo método, com o critério", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const contatoId = (await sql("INSERT INTO contato (empresa_id, nome, responsavel_id) VALUES ($1, 'Encerra', $2) RETURNING id", [e.a.empresaId, pessoa("dono")])).rows[0].id;
    const funilId = (await dono.get("/api/crm/configuracao")).json().funis[0].id;
    const op = (await dono.pedir("POST", "/api/oportunidades", { contatoId, funilId, titulo: "Teste" })).json();
    expect(op.encerradaBre).toBeNull();
    const checklist = { motivoCompreendido: true, crmAtualizado: true, temperaturaDefinida: true, proximoGatilho: true, reentradaDefinida: true, nadaSemRegistro: true };
    expect((await dono.pedir("POST", `/api/bre/oportunidades/${op.id}/encerrar`, { criterio: "PROFILE_MISMATCH", temperatura: "COLD", checklist })).statusCode).toBe(200);
    const lista = (await dono.get(`/api/oportunidades?contatoId=${contatoId}`)).json();
    expect(lista.itens[0].encerradaBre.criterio).toBe("PROFILE_MISMATCH");
  });
});

describe("mascaramento para a IA (DEC-009)", () => {
  it("desligado (padrão dos testes) a IA lê a conversa como está; ligado, sem telefone, e-mail e CPF", async () => {
    const canal = (await sql("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, 'Demo', 'demonstracao') RETURNING id", [e.a.empresaId])).rows[0].id;
    const contato = (await sql("INSERT INTO contato (empresa_id, nome) VALUES ($1, 'Mascara') RETURNING id", [e.a.empresaId])).rows[0].id;
    const conv = (await sql("INSERT INTO conversa (empresa_id, canal_id, contato_id) VALUES ($1, $2, $3) RETURNING id", [e.a.empresaId, canal, contato])).rows[0].id;
    await sql("INSERT INTO mensagem (empresa_id, conversa_id, canal_id, direcao, tipo, status, texto) VALUES ($1, $2, $3, 'entrada', 'texto', 'recebida', $4)", [
      e.a.empresaId,
      conv,
      canal,
      "Meu zap é (11) 98765-4321, e-mail ana@exemplo.com.br, CPF 123.456.789-09",
    ]);
    const lido = () => comEmpresa(t.banco, e.a.empresaId, (tx) => mensagensDaConversa(tx, conv));
    expect((await lido())[0]!.texto).toBe("Meu zap é (11) 98765-4321, e-mail ana@exemplo.com.br, CPF 123.456.789-09");
    const dono = await logado(t.app, email(e.a, "dono"));
    await dono.pedir("PUT", "/api/bre/config", { mascararDadosIa: true });
    expect((await lido())[0]!.texto).toBe("Meu zap é [telefone], e-mail [e-mail], CPF [CPF]");
  });
});
