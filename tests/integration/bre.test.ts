// Critérios de pronto da fase 8.1 (Motor BRE sem IA): os testes de aceitação AT-013 a AT-017 e AT-020 a AT-022 da
// ETR BRE-ETR-001 v0.2, a rotina de silêncio, o pós-venda e o isolamento entre empresas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarServicoBre } from "../../apps/api/src/modulos/bre/bre.servico.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let bre: ReturnType<typeof criarServicoBre>;
let ofertaId: string;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  bre = criarServicoBre({ banco: t.banco } as never);
  const { rows } = await t.banco.pool.query("INSERT INTO oferta (empresa_id, nome) VALUES ($1, 'Perfume teste') RETURNING id", [e.a.empresaId]);
  ofertaId = rows[0].id;
});
afterAll(() => t.fechar());

/** Contato da empresa A, do vendedor, com vendas confirmadas há N dias. */
async function cliente(diasDasVendas: number[], nome = "Cliente"): Promise<string> {
  const vendedor = e.a.pessoas.vendedor!.usuarioId;
  const { rows } = await t.banco.pool.query("INSERT INTO contato (empresa_id, nome, responsavel_id) VALUES ($1, $2, $3) RETURNING id", [e.a.empresaId, nome, vendedor]);
  const id = rows[0].id as string;
  for (const dias of diasDasVendas) {
    await t.banco.pool.query(
      `INSERT INTO venda (empresa_id, contato_id, oferta_id, vendedor_id, valor_centavos, forma_pagamento, status, data_venda)
       VALUES ($1, $2, $3, $4, 10000, 'pix', 'confirmada', current_date - $5::int)`,
      [e.a.empresaId, id, ofertaId, vendedor, dias],
    );
  }
  return id;
}

const registro = (contatoId: string, extra: Record<string, unknown> = {}) => ({
  contatoId,
  resultado: "NO_REPLY",
  temperatura: "COLD",
  proximaAcao: "CALL_BACK",
  retornoEm: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
  ...extra,
});

/** Faz a última tentativa do ciclo aberto parecer antiga (sem esperar 48 h de verdade). */
const envelhecerTentativa = (contatoId: string, dias: number) =>
  t.banco.pool.query("UPDATE ciclo_contato SET ultima_tentativa_em = now() - make_interval(days => $2) WHERE contato_id = $1 AND encerrado_em IS NULL", [contatoId, dias]);

describe("Motor BRE — estado do cliente e fila do dia", () => {
  it("AT-013: o job diário classifica pelo número de compras e pelos dias desde a entrega", async () => {
    const umaCompra50 = await cliente([50]);
    const duasCompras50 = await cliente([200, 50]);
    const recente = await cliente([10]);
    const inativo = await cliente([200]);
    await bre.classificar(e.a.empresaId);
    const { rows } = await t.banco.pool.query("SELECT id, estado_bre, compras_qtd FROM contato WHERE id = ANY($1)", [[umaCompra50, duasCompras50, recente, inativo]]);
    const estado = Object.fromEntries(rows.map((r) => [r.id, r.estado_bre]));
    expect(estado[umaCompra50]).toBe("ABOUT_TO_SLEEP");
    expect(estado[duasCompras50]).toBe("ACTIVE");
    expect(estado[recente]).toBe("RECENT");
    expect(estado[inativo]).toBe("INACTIVE");
    const evento = await t.banco.pool.query("SELECT 1 FROM evento WHERE tipo = 'bre.estado_cliente_alterado' AND entidade_id = $1", [recente]);
    expect(evento.rowCount).toBe(1);
  });

  it("AT-014: cliente recente só entra na fila 48 h depois da entrega", async () => {
    const hoje = await cliente([0], "Entregue hoje");
    const dezDias = await cliente([10], "Entregue há dez dias");
    await bre.classificar(e.a.empresaId);
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { itens: { contatoId: string }[]; proximoCursor: string | null } = (await vendedor.get(`/api/bre/fila-do-dia?limite=100${cursor ? `&cursor=${cursor}` : ""}`)).json();
      ids.push(...r.itens.map((i) => i.contatoId));
      cursor = r.proximoCursor;
    } while (cursor);
    expect(ids).toContain(dezDias);
    expect(ids).not.toContain(hoje);
  });
});

describe("Motor BRE — pipeline, Break e encerramento", () => {
  it("AT-015: com marcos BRE, o funil recusa pular de Lead identificado para Venda", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const funil = (await dono.pedir("POST", "/api/crm/funis", { nome: "Funil BRE" })).json();
    const lead = (await dono.pedir("POST", "/api/crm/etapas", { funilId: funil.id, nome: "Lead", ordem: 0, marcoBre: "LEAD_IDENTIFIED" })).json();
    const diag = (await dono.pedir("POST", "/api/crm/etapas", { funilId: funil.id, nome: "Diagnóstico", ordem: 1, marcoBre: "DIAGNOSIS" })).json();
    const venda = (await dono.pedir("POST", "/api/crm/etapas", { funilId: funil.id, nome: "Venda", ordem: 2, marcoBre: "SALE" })).json();
    expect(lead.marcoBre).toBe("LEAD_IDENTIFIED");
    const contatoId = await cliente([]);
    const op = (await dono.pedir("POST", "/api/oportunidades", { contatoId, funilId: funil.id, etapaId: lead.id, titulo: "Primeira compra" })).json();
    const pulo = await dono.pedir("POST", `/api/oportunidades/${op.id}/etapa`, { etapaId: venda.id });
    expect(pulo.statusCode).toBe(400);
    expect(pulo.json().error.message).toBe("Pelo método BRE, de Lead identificado só se vai para: Diagnóstico, Encerrado.");
    expect((await dono.pedir("POST", `/api/oportunidades/${op.id}/etapa`, { etapaId: diag.id })).statusCode).toBe(200);

    // AT-016: encerrar sem o checklist completo não salva e diz o que falta.
    const checklist = { motivoCompreendido: true, crmAtualizado: true, temperaturaDefinida: true, proximoGatilho: true, reentradaDefinida: false, nadaSemRegistro: true };
    const incompleto = await dono.pedir("POST", `/api/bre/oportunidades/${op.id}/encerrar`, { criterio: "NO_INTEREST_PERMANENT", temperatura: "COLD", checklist });
    expect(incompleto.statusCode).toBe(400);
    expect(incompleto.json().error.details.faltando).toEqual(["Data ou evento de reentrada"]);
    const completo = await dono.pedir("POST", `/api/bre/oportunidades/${op.id}/encerrar`, {
      criterio: "NO_INTEREST_PERMANENT",
      temperatura: "COLD",
      checklist: { ...checklist, reentradaDefinida: true },
      reentrada: { tipo: "EVENT", condicao: "Lançamento da linha nova", motivo: "Sem interesse agora" },
    });
    expect(completo.statusCode).toBe(200);
    expect(completo.json().reentradaId).toBeTruthy();
  });

  it("AT-017: Break sem motivo é recusado; categoria Financeiro gera reentrada na próxima campanha", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente([20]);
    const semMotivo = await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId, { resultado: "REPLIED_NO_ADVANCE", break: { categoria: "C_FINANCIAL", comentario: "Achou caro" } }));
    expect(semMotivo.statusCode).toBe(400);

    const motivos = (await vendedor.get("/api/bre/motivos")).json().itens as { id: string; categoria: string; nome: string }[];
    const preco = motivos.find((m) => m.categoria === "C_FINANCIAL" && m.nome === "Preço")!;
    const r = await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId, { resultado: "REPLIED_NO_ADVANCE", break: { categoria: "C_FINANCIAL", motivoId: preco.id, comentario: "Achou caro" } }));
    expect(r.statusCode).toBe(201);
    const { rows } = await t.banco.pool.query("SELECT tipo, condicao FROM reentrada WHERE id = $1", [r.json().reentradaId]);
    expect(rows[0]).toEqual({ tipo: "EVENT", condicao: "Próxima campanha" });

    // Motivo de outra categoria não vale para esta.
    const tempo = motivos.find((m) => m.categoria === "A_TIME")!;
    const errado = await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId, { resultado: "REPLIED_NO_ADVANCE", break: { categoria: "C_FINANCIAL", motivoId: tempo.id, comentario: "Achou caro" } }));
    expect(errado.json().error.message).toBe("Escolha um motivo da categoria do Break.");
  });
});

describe("Motor BRE — limites de contato", () => {
  it("AT-020 e AT-021: três tentativas sem resposta encerram o ciclo; o próximo contato espera 15 dias ou a data combinada", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente([30]);
    expect((await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId))).statusCode).toBe(201);
    const cedo = await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId));
    expect(cedo.json().error.message).toBe("Aguarde 48 horas desde a última tentativa antes de abordar de novo.");
    await envelhecerTentativa(contatoId, 3);
    expect((await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId))).statusCode).toBe(201);
    await envelhecerTentativa(contatoId, 3);
    const terceira = (await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId))).json();
    expect(terceira.cicloEncerrado).toBe(true);
    expect(terceira.reentradaId).toBeTruthy();

    const bloqueada = await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId));
    expect(bloqueada.statusCode).toBe(400);
    expect(bloqueada.json().error.message).toContain("15 dias");

    // Combinado com o cliente para hoje: vale mais que o limite.
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    await vendedor.pedir("POST", "/api/bre/reentradas", { contatoId, tipo: "TIME", previstaPara: hoje, motivo: "Cliente pediu para chamar hoje" });
    expect((await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId))).statusCode).toBe(201);
  });

  it("AT-022: quem pede para não ser contatado sai da fila e não aceita nova tentativa", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente([40]);
    await bre.classificar(e.a.empresaId);
    const r = await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId, { resultado: "OPTED_OUT", proximaAcao: "CLOSE_NO_INTEREST", retornoEm: null }));
    expect(r.statusCode).toBe(201);
    const { rows } = await t.banco.pool.query("SELECT nao_contatar FROM contato WHERE id = $1", [contatoId]);
    expect(rows[0].nao_contatar).toBe(true);
    const tentativa = await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId));
    expect(tentativa.json().error.message).toBe("O aluno pediu para não ser contatado. Só fale de novo quando o aluno mandar mensagem.");
    const fila = (await vendedor.get("/api/bre/fila-do-dia?limite=100")).json();
    expect(fila.itens.map((i: { contatoId: string }) => i.contatoId)).not.toContain(contatoId);
  });

  it("silêncio de 7 dias encerra o ciclo sozinho e programa reentrada", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente([30]);
    await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId));
    await envelhecerTentativa(contatoId, 8);
    expect(await bre.encerrarSilencios(e.a.empresaId)).toBeGreaterThanOrEqual(1);
    const { rows } = await t.banco.pool.query("SELECT motivo_encerramento FROM ciclo_contato WHERE contato_id = $1", [contatoId]);
    expect(rows[0].motivo_encerramento).toBe("SILENCE");
    const r = await t.banco.pool.query("SELECT motivo FROM reentrada WHERE contato_id = $1 AND status = 'pendente'", [contatoId]);
    expect(r.rows[0].motivo).toBe("Sem resposta por 7 dias");
  });

  it("venda registrada cria o retorno e a agenda de pós-venda (D+2, 5, 10, 20, 30)", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente([60]);
    const r = (await vendedor.pedir("POST", "/api/bre/registros", registro(contatoId, { resultado: "PURCHASED", temperatura: "READY_TO_BUY", sins: ["CONFIRMATION", "AGREEMENT", "VISUALIZATION"] }))).json();
    expect(r.tarefas).toBe(6);
    const { rows } = await t.banco.pool.query("SELECT titulo FROM tarefa WHERE contato_id = $1 ORDER BY vence_em", [contatoId]);
    expect(rows.map((x) => x.titulo)).toEqual(["Pós-venda D+2", "Retorno: retornar depois", "Pós-venda D+5", "Pós-venda D+10", "Pós-venda D+20", "Pós-venda D+30"]);
  });
});

describe("Motor BRE — configuração e isolamento", () => {
  it("limites mudam por empresa, em nova versão, e recusam combinação impossível", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const antes = (await dono.get("/api/bre/config")).json();
    expect(antes.tentativasPorCiclo).toBe(3);
    expect((await dono.pedir("PUT", "/api/bre/config", { recenteAte: 200 })).statusCode).toBe(400);
    const depois = (await dono.pedir("PUT", "/api/bre/config", { diasEntreCiclos: 20 })).json();
    expect(depois).toMatchObject({ diasEntreCiclos: 20, versao: antes.versao + 1 });
    await dono.pedir("PUT", "/api/bre/config", { diasEntreCiclos: 15 });
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.pedir("PUT", "/api/bre/config", { diasEntreCiclos: 1 })).statusCode).toBe(403);
  });

  it("empresa sem o módulo não usa o motor, e nada atravessa de uma empresa para outra", async () => {
    const donoB = await logado(t.app, email(e.b, "dono"));
    expect((await donoB.get("/api/bre/config")).statusCode).toBe(403);
    const contatoA = await cliente([30]);
    const donoA = await logado(t.app, email(e.a, "dono"));
    const contatoB = (await t.banco.pool.query("INSERT INTO contato (empresa_id, nome) VALUES ($1, 'De B') RETURNING id", [e.b.empresaId])).rows[0].id;
    expect((await donoA.pedir("POST", "/api/bre/registros", registro(contatoB))).statusCode).toBe(404);
    // Oferta de outra empresa não entra como referência.
    const ofertaB = (await t.banco.pool.query("INSERT INTO oferta (empresa_id, nome) VALUES ($1, 'De B') RETURNING id", [e.b.empresaId])).rows[0].id;
    const cruzado = await donoA.pedir("POST", "/api/bre/registros", registro(contatoA, { resultado: "ADVANCED", produtoOfertaId: ofertaB }));
    expect(cruzado.json().error.message).toBe("Conversa ou oferta não encontrada nesta empresa.");
    // Vendedor só registra na própria carteira.
    const outro = await logado(t.app, email(e.a, "vendedor2"));
    expect((await outro.pedir("POST", "/api/bre/registros", registro(contatoA))).statusCode).toBe(404);
  });
});

describe("Motor BRE — análise da conversa pela IA (8.2)", () => {
  /** Conversa do contato com as mensagens dadas (entrada = cliente). */
  async function conversa(contatoId: string, mensagens: [string, string][]): Promise<string> {
    const canal = (await t.banco.pool.query("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, 'Demo', 'demonstracao') RETURNING id", [e.a.empresaId])).rows[0].id;
    const conv = (await t.banco.pool.query("INSERT INTO conversa (empresa_id, canal_id, contato_id) VALUES ($1, $2, $3) RETURNING id", [e.a.empresaId, canal, contatoId])).rows[0].id;
    for (const [i, [direcao, texto]] of mensagens.entries()) {
      await t.banco.pool.query(
        "INSERT INTO mensagem (empresa_id, conversa_id, canal_id, direcao, tipo, status, texto, criado_em) VALUES ($1, $2, $3, $4, 'texto', 'recebida', $5, now() + make_interval(secs => $6))",
        [e.a.empresaId, conv, canal, direcao, texto, i],
      );
    }
    return conv;
  }

  it("a IA de demonstração sugere o registro; o motor tira desconto do recente e oferta antes dos três sim", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente([5]);
    await bre.classificar(e.a.empresaId);
    const conv = await conversa(contatoId, [["saida", "Oi! Chegou bem o perfume?"], ["entrada", "Chegou, gostei, mas o próximo está caro demais"]]);
    const r = await vendedor.pedir("POST", `/api/bre/conversas/${conv}/analisar`);
    expect(r.statusCode).toBe(200);
    const a = r.json();
    expect(a).toMatchObject({ provedor: "demonstracao", resultado: "REPLIED_NO_ADVANCE", sugereDesconto: false, sugereOferta: false, break: { categoria: "C_FINANCIAL" } });
    expect(a.bloqueios).toEqual([
      "Desconto não sugerido: no estado Recente nunca há desconto.",
      'Oferta não sugerida: faltam os três "sim" (confirmação, concordância e visualização).',
    ]);
    const { rows } = await t.banco.pool.query("SELECT provedor, doutrina FROM analise_bre WHERE id = $1", [a.id]);
    expect(rows[0]).toEqual({ provedor: "demonstracao", doutrina: "BRE-v1.0 / ETR 0.2" });
  });

  it("quem pediu para não ser contatado nunca vai para a IA", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const contatoId = await cliente([5]);
    await t.banco.pool.query("UPDATE contato SET nao_contatar = true WHERE id = $1", [contatoId]);
    const conv = await conversa(contatoId, [["entrada", "Oi"]]);
    const r = await vendedor.pedir("POST", `/api/bre/conversas/${conv}/analisar`);
    expect(r.json().error.message).toBe("Este aluno pediu para não ser contatado ou foi anonimizado: a conversa não vai para a IA.");
    expect((await t.banco.pool.query("SELECT 1 FROM analise_bre WHERE conversa_id = $1", [conv])).rowCount).toBe(0);
  });
});
