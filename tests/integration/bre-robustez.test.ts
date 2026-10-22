// Fase 8.5: a IA pela fila de jobs aguenta falha (recusa vira "falhou" com motivo; erro passageiro sobe para a fila
// tentar de novo; pedido parado expira), tem limite por hora e não trava a avaliação. O BPI fica guardado e paginado.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarServicoBre } from "../../apps/api/src/modulos/bre/bre.servico.js";
import { criarServicoDesempenho } from "../../apps/api/src/modulos/bre/desempenho.servico.js";
import { IaIndisponivel, type ProvedorIaBre } from "../../apps/api/src/modulos/bre/ia.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let canalId: string;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);
const pessoa = (chave: string) => e.a.pessoas[chave]!.usuarioId;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  canalId = (await sql("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, 'Demo', 'demonstracao') RETURNING id", [e.a.empresaId])).rows[0].id;
});
afterAll(() => t.fechar());

async function conversa(responsavel = pessoa("vendedor")) {
  const contato = (await sql("INSERT INTO contato (empresa_id, nome, responsavel_id) VALUES ($1, 'Cliente', $2) RETURNING id", [e.a.empresaId, responsavel])).rows[0].id;
  const conv = (await sql("INSERT INTO conversa (empresa_id, canal_id, contato_id, atribuida_a) VALUES ($1, $2, $3, $4) RETURNING id", [e.a.empresaId, canalId, contato, responsavel])).rows[0].id;
  await sql("INSERT INTO mensagem (empresa_id, conversa_id, canal_id, direcao, tipo, status, texto) VALUES ($1, $2, $3, 'entrada', 'texto', 'recebida', 'Oi')", [e.a.empresaId, conv, canalId]);
  return { contato: contato as string, conv: conv as string };
}

/** Análise "processando" como o pedido deixa (sem passar pela fila). */
async function analisePendente(conv: string, contato: string, minutosAtras = 0) {
  return (
    await sql(
      `INSERT INTO analise_bre (empresa_id, conversa_id, contato_id, provedor, doutrina, status, autor_id, criado_em)
       VALUES ($1, $2, $3, '', 'BRE-v1.0 / ETR 0.2', 'processando', $4, now() - make_interval(mins => $5)) RETURNING id`,
      [e.a.empresaId, conv, contato, pessoa("vendedor"), minutosAtras],
    )
  ).rows[0].id as string;
}

const provedor = (falha: Error): ProvedorIaBre => ({
  nome: "teste",
  analisar: async () => {
    throw falha;
  },
});

describe("IA pela fila de jobs", () => {
  it("recusa da IA vira 'falhou' com o motivo e avisa quem pediu", async () => {
    const { conv, contato } = await conversa();
    const id = await analisePendente(conv, contato);
    const bre = criarServicoBre({ banco: t.banco } as never, provedor(new IaIndisponivel("A IA não analisou esta conversa. Preencha o registro manualmente.")));
    await bre.processarAnalise(e.a.empresaId, id);
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get(`/api/bre/analises/${id}`)).json()).toMatchObject({ status: "falhou", erro: "A IA não analisou esta conversa. Preencha o registro manualmente.", sugestao: null });
    const aviso = await sql("SELECT para_usuario_id FROM evento WHERE tipo = 'bre.analise_falhou' AND entidade_id = $1", [id]);
    expect(aviso.rows).toEqual([{ para_usuario_id: pessoa("vendedor") }]);
  });

  it("erro passageiro sobe para a fila tentar de novo; pedido parado há mais de 10 minutos conta como falha", async () => {
    const { conv, contato } = await conversa();
    const id = await analisePendente(conv, contato);
    const bre = criarServicoBre({ banco: t.banco } as never, provedor(new Error("ECONNRESET")));
    await expect(bre.processarAnalise(e.a.empresaId, id)).rejects.toThrow("ECONNRESET");
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get(`/api/bre/analises/${id}`)).json().status).toBe("processando");

    const velha = await analisePendente(conv, contato, 11);
    expect((await vendedor.get(`/api/bre/analises/${velha}`)).json()).toMatchObject({ status: "falhou", erro: "A IA não respondeu a tempo. Tente de novo ou preencha manualmente." });
  });

  it("a empresa tem limite de pedidos à IA por hora", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const { n } = (await sql("SELECT (SELECT count(*) FROM analise_bre WHERE empresa_id = $1) + (SELECT count(*) FROM sq_bre WHERE empresa_id = $1) AS n", [e.a.empresaId])).rows[0];
    await dono.pedir("PUT", "/api/bre/config", { limiteIaPorHora: Number(n) + 1 });
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const { conv } = await conversa();
    expect((await vendedor.pedir("POST", `/api/bre/conversas/${conv}/analisar`)).statusCode).toBe(202);
    const segunda = await vendedor.pedir("POST", `/api/bre/conversas/${conv}/analisar`);
    expect(segunda.statusCode).toBe(400);
    expect(segunda.json().error.message).toBe(`A empresa chegou ao limite de ${Number(n) + 1} análises de IA por hora. Tente de novo mais tarde ou preencha manualmente.`);
    await dono.pedir("PUT", "/api/bre/config", { limiteIaPorHora: 300 });
  });

  it("prévia do SQ-BRE que falhou não trava: o supervisor avalia mesmo assim; ainda processando, espera", async () => {
    const { conv } = await conversa();
    const sq = (
      await sql("INSERT INTO sq_bre (empresa_id, conversa_id, avaliado_id, provedor, criado_por) VALUES ($1, $2, $3, '', $4) RETURNING id", [
        e.a.empresaId,
        conv,
        pessoa("vendedor"),
        pessoa("gestor"),
      ])
    ).rows[0].id;
    const gestor = await logado(t.app, email(e.a, "gestor"));
    const notas = { H: 15, D: 15, I: 15, V: 15, P: 20 };
    const cedo = await gestor.pedir("POST", `/api/qualidade/sq-bre/${sq}/confirmar`, { notas });
    expect(cedo.json().error.message).toBe("A prévia da IA ainda está sendo preparada. Aguarde um instante.");

    const desempenho = criarServicoDesempenho({ banco: t.banco } as never, provedor(new IaIndisponivel("A IA não analisou esta conversa. Preencha o registro manualmente.")));
    await desempenho.processarPrevia(e.a.empresaId, sq);
    expect((await gestor.get(`/api/qualidade/sq-bre/${sq}`)).json()).toMatchObject({ status: "falhou", previa: null });
    const ok = await gestor.pedir("POST", `/api/qualidade/sq-bre/${sq}/confirmar`, { notas });
    expect(ok.json()).toMatchObject({ status: "confirmada", nota: 80, notaPrevia: null });
  });
});

describe("BPI guardado e paginado", () => {
  it("guarda o cálculo, reaproveita enquanto é recente, recalcula a pedido e pagina pela posição", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const primeira = (await dono.get("/api/bre/desempenho?atualizar=sim&limite=2")).json();
    expect(primeira.itens).toHaveLength(2);
    expect(primeira.itens.map((i: { posicao: number }) => i.posicao)).toEqual([1, 2]);
    expect(primeira.proximoCursor).toBeTruthy();
    const segunda = (await dono.get(`/api/bre/desempenho?limite=2&cursor=${primeira.proximoCursor}`)).json();
    expect(segunda.itens.map((i: { posicao: number }) => i.posicao)).toEqual([3, 4]);
    expect(segunda.calculadoEm).toBe(primeira.calculadoEm); // reaproveitou o cálculo guardado

    const guardadas = (await sql("SELECT count(*)::int AS n FROM bre_bpi WHERE empresa_id = $1", [e.a.empresaId])).rows[0].n;
    expect(guardadas).toBe(Object.keys(e.a.pessoas).length);
    const depois = (await dono.get("/api/bre/desempenho?atualizar=sim&limite=2")).json();
    expect(Date.parse(depois.calculadoEm)).toBeGreaterThan(Date.parse(primeira.calculadoEm));
    expect((await dono.get("/api/bre/desempenho?cursor=xx")).statusCode).toBe(400);
  });
});
