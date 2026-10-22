// Critérios de pronto da fase 8.2 (2ª sprint): SQ-BRE com prévia e confirmação (AT-019), BPI com dados conhecidos
// (AT-025), coaching por 2 semanas (AT-026), desconto antes do diagnóstico (AT-024) e escalonamento (BR-017).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarServicoDesempenho } from "../../apps/api/src/modulos/bre/desempenho.servico.js";
import { email, esperarAte, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let canalId: string;
let ofertaId: string;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  canalId = (await sql("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, 'Demo', 'demonstracao') RETURNING id", [e.a.empresaId])).rows[0].id;
  ofertaId = (await sql("INSERT INTO oferta (empresa_id, nome) VALUES ($1, 'Oferta teste') RETURNING id", [e.a.empresaId])).rows[0].id;
});
afterAll(() => t.fechar());

const pessoa = (chave: string) => e.a.pessoas[chave]!.usuarioId;

async function cliente(responsavel: string, diasDasVendas: number[] = []): Promise<string> {
  const id = (await sql("INSERT INTO contato (empresa_id, nome, responsavel_id) VALUES ($1, 'Cliente', $2) RETURNING id", [e.a.empresaId, responsavel])).rows[0].id as string;
  for (const dias of diasDasVendas) {
    await sql(
      `INSERT INTO venda (empresa_id, contato_id, oferta_id, vendedor_id, valor_centavos, forma_pagamento, status, data_venda)
       VALUES ($1, $2, $3, $4, 10000, 'pix', 'confirmada', current_date - $5::int)`,
      [e.a.empresaId, id, ofertaId, responsavel, dias],
    );
  }
  return id;
}

/** Conversa atribuída a quem atende, com as mensagens dadas (entrada = cliente). */
async function conversa(contatoId: string, atribuidaA: string, mensagens: [string, string][]): Promise<string> {
  const conv = (await sql("INSERT INTO conversa (empresa_id, canal_id, contato_id, atribuida_a) VALUES ($1, $2, $3, $4) RETURNING id", [e.a.empresaId, canalId, contatoId, atribuidaA])).rows[0].id as string;
  for (const [i, [direcao, texto]] of mensagens.entries()) {
    await sql(
      "INSERT INTO mensagem (empresa_id, conversa_id, canal_id, direcao, tipo, status, texto, criado_em) VALUES ($1, $2, $3, $4, 'texto', 'recebida', $5, now() + make_interval(secs => $6))",
      [e.a.empresaId, conv, canalId, direcao, texto, i],
    );
  }
  return conv;
}


/** Pede a análise à IA (vai para a fila) e espera o trabalhador terminar. */
async function analisar(cliente: Awaited<ReturnType<typeof logado>>, conversaId: string) {
  const r = await cliente.pedir("POST", `/api/bre/conversas/${conversaId}/analisar`);
  expect(r.statusCode, r.body).toBe(202);
  expect(r.json().status).toBe("processando");
  return esperarAte(
    async () => (await cliente.get(`/api/bre/analises/${r.json().id}`)).json(),
    (a) => a.status !== "processando",
  );
}

describe("SQ-BRE na Qualidade (AT-019)", () => {
  it("a IA dá a prévia, o supervisor confirma outra nota e as duas ficam guardadas; o BPI usa a confirmada", async () => {
    const gestor = await logado(t.app, email(e.a, "gestor"));
    const contatoId = await cliente(pessoa("vendedor"));
    const conv = await conversa(contatoId, pessoa("vendedor"), [["saida", "Oi! Como foi com o perfume?"], ["entrada", "Gostei muito"]]);

    const pedido = await gestor.pedir("POST", "/api/qualidade/sq-bre", { conversaId: conv });
    expect(pedido.statusCode).toBe(200);
    expect(pedido.json()).toMatchObject({ status: "processando", previa: null });
    const p = await esperarAte(
      async () => (await gestor.get(`/api/qualidade/sq-bre/${pedido.json().id}`)).json(),
      (x) => x.status !== "processando",
    );
    expect(p).toMatchObject({ status: "previa", provedor: "demonstracao", nota: null, avaliadoId: pessoa("vendedor") });
    expect(p.notaPrevia).toBe(p.previa.H + p.previa.D + p.previa.I + p.previa.V + p.previa.P);
    // Pedir de novo devolve a mesma prévia.
    expect((await gestor.pedir("POST", "/api/qualidade/sq-bre", { conversaId: conv })).json().id).toBe(p.id);

    const donoAntes = await logado(t.app, email(e.a, "dono"));
    expect((await donoAntes.get("/api/bre/desempenho?atualizar=sim&limite=100")).statusCode).toBe(200); // cálculo guardado antes da nota
    const notas = { H: 16, D: 12, I: 12, V: 12, P: 16 };
    const conf = await gestor.pedir("POST", `/api/qualidade/sq-bre/${p.id}/confirmar`, { notas, feedback: "Faltou diagnosticar o uso." });
    expect(conf.statusCode).toBe(200);
    expect(conf.json()).toMatchObject({ status: "confirmada", nota: 68, faixa: "Regular", previa: p.previa, confirmada: notas });
    expect((await gestor.pedir("POST", `/api/qualidade/sq-bre/${p.id}/confirmar`, { notas })).json().error.message).toBe("Esta avaliação já foi confirmada.");

    const audit = await sql("SELECT antes, depois FROM auditoria WHERE acao = 'qualidade.sq_bre_confirmado' AND entidade_id = $1", [conv]);
    expect(audit.rows[0].antes.nota).toBe(p.notaPrevia);
    expect(audit.rows[0].depois.nota).toBe(68);

    // O BPI guardado já existia (calculado antes): confirmar a nota marca como velho e a leitura recalcula sozinha.
    const dono = await logado(t.app, email(e.a, "dono"));
    const bpi = (await dono.get("/api/bre/desempenho?limite=100")).json();
    expect(bpi.itens.find((i: { usuarioId: string }) => i.usuarioId === pessoa("vendedor")).pilares.qualidade).toBe(68);
  });

  it("ninguém avalia o próprio atendimento; vendedor não avalia; empresa sem o motor não usa o SQ-BRE", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente(pessoa("gestor"));
    const conv = await conversa(contatoId, pessoa("gestor"), [["entrada", "Oi"]]);
    expect((await vendedor.pedir("POST", "/api/qualidade/sq-bre", { conversaId: conv })).statusCode).toBe(403);
    const gestor = await logado(t.app, email(e.a, "gestor"));
    expect((await gestor.pedir("POST", "/api/qualidade/sq-bre", { conversaId: conv })).json().error.message).toBe("Ninguém avalia o próprio atendimento. Peça a outro gestor.");
    const donoB = await logado(t.app, email(e.b, "dono"));
    expect((await donoB.get("/api/qualidade/sq-bre")).statusCode).toBe(403);
  });
});

describe("BPI com dados conhecidos (AT-025)", () => {
  it("cada pilar sai da fonte certa e o BPI usa os pesos do livro, sem o pilar que não tem dados", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const v2 = pessoa("vendedor2");
    await dono.pedir("PUT", "/api/bre/config", { metaReceitaCentavos: 100_000 });

    // Receita: R$ 500 de R$ 1.000 → 50.
    const contatoId = await cliente(v2);
    await sql(
      `INSERT INTO venda (empresa_id, contato_id, oferta_id, vendedor_id, valor_centavos, forma_pagamento, status, data_venda)
       VALUES ($1, $2, $3, $4, 50000, 'pix', 'confirmada', (now() AT TIME ZONE 'America/Sao_Paulo')::date)`,
      [e.a.empresaId, contatoId, ofertaId, v2],
    );

    // Pipeline: 2 oportunidades abertas no início do mês, 1 avançou → 50.
    const funil = (await sql("INSERT INTO funil (empresa_id, nome) VALUES ($1, 'Funil BPI') RETURNING id", [e.a.empresaId])).rows[0].id;
    const et1 = (await sql("INSERT INTO etapa (empresa_id, funil_id, nome, ordem) VALUES ($1, $2, 'Um', 1) RETURNING id", [e.a.empresaId, funil])).rows[0].id;
    const et2 = (await sql("INSERT INTO etapa (empresa_id, funil_id, nome, ordem) VALUES ($1, $2, 'Dois', 2) RETURNING id", [e.a.empresaId, funil])).rows[0].id;
    const antesDoMes = "date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 day'";
    const op = async () =>
      (await sql(`INSERT INTO oportunidade (empresa_id, contato_id, funil_id, etapa_id, titulo, responsavel_id, criado_em) VALUES ($1, $2, $3, $4, 'Op', $5, ${antesDoMes}) RETURNING id`, [e.a.empresaId, contatoId, funil, et1, v2])).rows[0].id;
    const avancou = await op();
    await op();
    await sql("INSERT INTO evento (empresa_id, tipo, entidade, entidade_id, dados) VALUES ($1, 'oportunidade.etapa_alterada', 'oportunidade', $2, $3)", [
      e.a.empresaId,
      avancou,
      JSON.stringify({ etapaAnteriorId: et1, etapaNovaId: et2 }),
    ]);

    // Inteligência: 1 registro com emoção e "sim" (completude 2/4 = 50% → 62,5) e dado novo (100% → 100) → 81,3.
    const v2Login = await logado(t.app, email(e.a, "vendedor2"));
    const reg = await v2Login.pedir("POST", "/api/bre/registros", {
      contatoId,
      resultado: "ADVANCED",
      temperatura: "HOT",
      estadoEmocional: "INTERESTED",
      sins: ["CONFIRMATION"],
      proximaAcao: "CALL_BACK",
      retornoEm: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10),
    });
    expect(reg.statusCode).toBe(201);

    // Relacionamento: 2 follow-ups do motor vencidos, 1 feito no dia → 50.
    for (const feita of [true, false]) {
      await sql(
        `INSERT INTO tarefa (empresa_id, contato_id, titulo, responsavel_id, vence_em, concluida_em, origem_bre)
         VALUES ($1, $2, 'Pós-venda', $3, now() - interval '1 minute', ${feita ? "now()" : "NULL"}, 'pos_venda')`,
        [e.a.empresaId, contatoId, v2],
      );
    }

    const bpi = (await dono.get("/api/bre/desempenho?atualizar=sim&limite=100")).json();
    const linha = bpi.itens.find((i: { usuarioId: string }) => i.usuarioId === v2);
    expect(linha.pilares).toEqual({ receita: 50, pipeline: 50, inteligencia: 81.3, qualidade: null, relacionamento: 50 });
    // (30×50 + 20×50 + 20×81,3 + 10×50) / 80 = 4626 / 80 = 57,8
    expect(linha).toMatchObject({ bpi: 57.8, faixa: "Plano de desenvolvimento" });
    expect(bpi.itens.map((i: { posicao: number }) => i.posicao)).toEqual(bpi.itens.map((_: unknown, i: number) => i + 1));

    // Quem só vê o próprio vê só a própria linha.
    const proprio = (await v2Login.get("/api/bre/desempenho?atualizar=sim")).json();
    expect(proprio.itens.map((i: { usuarioId: string }) => i.usuarioId)).toEqual([v2]);
  });
});

describe("Coaching (AT-026)", () => {
  it("pilar abaixo de 70 por 2 semanas avisa o gestor uma vez; com 1 semana só, não", async () => {
    const semana = async (dias: number) => (await sql(`SELECT date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') - make_interval(days => $1) AS d`, [dias])).rows[0].d;
    const sqConfirmado = async (avaliado: string, quando: Date) => {
      const contatoId = await cliente(avaliado);
      const conv = await conversa(contatoId, avaliado, [["entrada", "Oi"]]);
      const n = { H: 13, D: 13, I: 13, V: 13, P: 13 };
      await sql(
        `INSERT INTO sq_bre (empresa_id, conversa_id, avaliado_id, provedor, previa, nota_previa, confirmada, nota, confirmada_por, confirmada_em, criado_por)
         VALUES ($1, $2, $3, 'demonstracao', $4, 65, $4, 65, $5, $6, $5)`,
        [e.a.empresaId, conv, avaliado, JSON.stringify(n), pessoa("dono"), quando],
      );
    };
    // Vendedor: 65 nas duas últimas semanas. Consultora: 65 só na última.
    await sqConfirmado(pessoa("vendedor"), new Date((await semana(12)).getTime()));
    await sqConfirmado(pessoa("vendedor"), new Date((await semana(5)).getTime()));
    await sqConfirmado(pessoa("consultor"), new Date((await semana(5)).getTime()));

    const dono = await logado(t.app, email(e.a, "dono"));
    await dono.pedir("PUT", "/api/bre/config", { metaReceitaCentavos: null });
    const desempenho = criarServicoDesempenho({ banco: t.banco } as never);
    expect(await desempenho.alertarCoaching(e.a.empresaId)).toBeGreaterThanOrEqual(1);
    expect(await desempenho.alertarCoaching(e.a.empresaId)).toBe(0);
    const alertas = async (chave: string) =>
      (await sql("SELECT pilar FROM coaching_alerta WHERE empresa_id = $1 AND usuario_id = $2 ORDER BY pilar", [e.a.empresaId, pessoa(chave)])).rows.map((x) => x.pilar);
    expect(await alertas("vendedor")).toEqual(["qualidade"]);
    expect(await alertas("consultor")).toEqual([]);
    // Quem não atende não entra no BPI: nada de alerta para dono e financeiro.
    expect(await alertas("dono")).toEqual([]);
    expect(await alertas("financeiro")).toEqual([]);
    const aviso = await sql("SELECT titulo FROM notificacao WHERE usuario_id = $1 AND titulo LIKE 'Coaching:%'", [pessoa("gestor")]);
    expect(aviso.rows[0].titulo).toBe("Coaching: Vendedor A1 está abaixo de 70 em Qualidade há 2 semanas");

    const bpi = (await dono.get("/api/bre/desempenho?atualizar=sim&limite=100")).json();
    expect(bpi.itens.find((i: { usuarioId: string }) => i.usuarioId === pessoa("vendedor")).coaching).toEqual(["Qualidade"]);
    expect(bpi.itens.find((i: { usuarioId: string }) => i.usuarioId === pessoa("consultor")).coaching).toEqual([]);
  });
});

describe("IA: desconto e escalonamento", () => {
  it("AT-024: cliente ativo sem diagnóstico não recebe desconto; depois do diagnóstico, recebe", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente(pessoa("vendedor"), [200, 10]);
    await sql("UPDATE contato SET estado_bre = 'ACTIVE' WHERE id = $1", [contatoId]);
    const conv = await conversa(contatoId, pessoa("vendedor"), [["entrada", "Achei caro esse"]]);
    const antes = (await analisar(vendedor, conv)).sugestao;
    expect(antes.sugereDesconto).toBe(false);
    expect(antes.bloqueios).toContain("Desconto não sugerido: só depois do diagnóstico concluído.");

    const funil = (await sql("INSERT INTO funil (empresa_id, nome) VALUES ($1, 'Funil diag') RETURNING id", [e.a.empresaId])).rows[0].id;
    const interesse = (await sql("INSERT INTO etapa (empresa_id, funil_id, nome, marco_bre) VALUES ($1, $2, 'Interesse', 'INTEREST') RETURNING id", [e.a.empresaId, funil])).rows[0].id;
    await sql("INSERT INTO oportunidade (empresa_id, contato_id, funil_id, etapa_id, titulo, responsavel_id) VALUES ($1, $2, $3, $4, 'Op', $5)", [e.a.empresaId, contatoId, funil, interesse, pessoa("vendedor")]);
    const depois = (await analisar(vendedor, conv)).sugestao;
    expect(depois.sugereDesconto).toBe(true);
  });

  it("reclamação abre escalonamento pela IA (um só), avisa o responsável e o gestor, e para as automações", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente(pessoa("vendedor"));
    const conv = await conversa(contatoId, pessoa("vendedor"), [["entrada", "Quero fazer uma reclamação, o pedido veio errado"]]);
    expect((await analisar(vendedor, conv)).sugestao.escalonamento).toBe("COMPLAINT");
    await analisar(vendedor, conv);
    const abertos = await sql("SELECT id, origem FROM escalonamento WHERE contato_id = $1 AND status = 'aberto'", [contatoId]);
    expect(abertos.rows).toEqual([{ id: abertos.rows[0].id, origem: "ia" }]);
    for (const quem of ["vendedor", "gestor"]) {
      const n = await sql("SELECT 1 FROM notificacao WHERE usuario_id = $1 AND titulo = 'Precisa de uma pessoa: Reclamação'", [pessoa(quem)]);
      expect(n.rowCount, quem).toBeGreaterThanOrEqual(1);
    }

    const lista = (await vendedor.get("/api/bre/escalonamentos")).json();
    expect(lista.itens.map((i: { contatoId: string }) => i.contatoId)).toContain(contatoId);
    const outro = await logado(t.app, email(e.a, "vendedor2"));
    expect((await outro.get("/api/bre/escalonamentos")).json().itens.map((i: { contatoId: string }) => i.contatoId)).not.toContain(contatoId);
    expect((await outro.pedir("PATCH", `/api/bre/escalonamentos/${abertos.rows[0].id}`)).statusCode).toBe(404);
    expect((await vendedor.pedir("PATCH", `/api/bre/escalonamentos/${abertos.rows[0].id}`)).statusCode).toBe(200);
    expect((await sql("SELECT status FROM escalonamento WHERE id = $1", [abertos.rows[0].id])).rows[0].status).toBe("resolvido");
  });

  it("a pessoa também escalona pelo registro da conversa", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente(pessoa("vendedor"));
    const r = await vendedor.pedir("POST", "/api/bre/registros", {
      contatoId,
      resultado: "ADVANCED",
      temperatura: "READY_TO_BUY",
      proximaAcao: "SCHEDULE_TALK",
      retornoEm: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
      escalonamento: "VIP",
    });
    expect(r.statusCode).toBe(201);
    const x = await sql("SELECT situacao, origem FROM escalonamento WHERE contato_id = $1", [contatoId]);
    expect(x.rows).toEqual([{ situacao: "VIP", origem: "manual" }]);
  });
});
