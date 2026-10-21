// Fase 8.6: a empresa cobra os clientes dela pelo provedor dela. Chave cifrada e nunca devolvida; cobrança nasce da
// venda; o aviso do provedor dá baixa (venda confirmada, estoque, BPI); aviso repetido ou com token errado não muda nada;
// uma empresa não mexe na cobrança da outra.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

async function vendaPendente(dono: Awaited<ReturnType<typeof logado>>, n: number) {
  const oferta = (await dono.pedir("POST", "/api/ofertas", { nome: `Curso ${n}`, estoque: 10 })).json();
  const contato = (await dono.pedir("POST", "/api/contatos", { nome: `Pagador ${n}`, telefone: `11 94444-10${String(n).padStart(2, "0")}` })).json();
  const v = await dono.pedir("POST", "/api/vendas", { contatoId: contato.id, ofertaId: oferta.id, valorCentavos: 15000, formaPagamento: "pix" });
  expect(v.statusCode, v.body).toBe(201);
  return { venda: v.json(), ofertaId: oferta.id as string };
}

const aviso = (empresaId: string, token: string | undefined, corpo: object) =>
  t.app.inject({ method: "POST", url: `/api/webhooks/cobranca/${empresaId}`, headers: token ? { "x-token-cobranca": token } : {}, payload: corpo });

describe("cobrança dos clientes pelo provedor da empresa", () => {
  it("sem conta conectada explica o que fazer; a chave do provedor real é exigida e nunca volta", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const { venda } = await vendaPendente(dono, 1);
    const sem = await dono.pedir("POST", `/api/vendas/${venda.id}/cobrancas`, { forma: "pix" });
    expect(sem.json().error.message).toContain("Conecte a conta de cobrança");
    const semChave = await dono.pedir("PUT", "/api/cobranca/conta", { provedor: "asaas" });
    expect(semChave.json().error.message).toBe("Informe a chave de API do provedor.");
    const conta = await dono.pedir("PUT", "/api/cobranca/conta", { provedor: "demonstracao" });
    expect(conta.statusCode, conta.body).toBe(200);
    expect(conta.json()).toMatchObject({ provedor: "demonstracao", finalChave: null, ativa: true });
    expect(conta.json().urlWebhook).toMatch(new RegExp(`/api/webhooks/cobranca/${e.a.empresaId}$`));
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get("/api/cobranca/conta")).statusCode).toBe(403);
  });

  it("gera Pix, simula o pagamento e a venda se confirma sozinha (estoque e BPI); aviso repetido não muda nada", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const { venda, ofertaId } = await vendaPendente(dono, 2);
    const c = await dono.pedir("POST", `/api/vendas/${venda.id}/cobrancas`, { forma: "pix" });
    expect(c.statusCode, c.body).toBe(201);
    expect(c.json()).toMatchObject({ forma: "pix", status: "pendente", valorCentavos: 15000 });
    expect(c.json().pixCopiaCola).toBeTruthy();
    const dupla = await dono.pedir("POST", `/api/vendas/${venda.id}/cobrancas`, { forma: "boleto" });
    expect(dupla.json().error.message).toBe("Esta venda já tem uma cobrança em aberto. Cancele a anterior para gerar outra.");

    await dono.get("/api/bre/desempenho?atualizar=sim");
    const paga = await dono.pedir("POST", `/api/cobrancas/${c.json().id}/simular-pagamento`);
    expect(paga.json()).toMatchObject({ status: "paga" });
    const v = (await sql("SELECT status FROM venda WHERE id = $1", [venda.id])).rows[0];
    expect(v.status).toBe("confirmada");
    expect((await sql("SELECT estoque FROM oferta WHERE id = $1", [ofertaId])).rows[0].estoque).toBe(9);
    expect((await sql("SELECT bool_and(calculado_em = '-infinity') AS velho FROM bre_bpi WHERE empresa_id = $1", [e.a.empresaId])).rows[0].velho).toBe(true);
    const eventos = await sql("SELECT count(*)::int AS n FROM evento WHERE tipo = 'venda.confirmada' AND entidade_id = $1", [venda.id]);
    expect(eventos.rows[0].n).toBe(1);

    // O mesmo aviso de novo: nada muda (nem evento, nem estoque).
    const token = (await dono.get("/api/cobranca/conta")).json().conta.tokenWebhook;
    const idExterno = (await sql("SELECT id_externo FROM cobranca WHERE id = $1", [c.json().id])).rows[0].id_externo;
    expect((await aviso(e.a.empresaId, token, { id: `simulado_${c.json().id}`, idExterno, status: "paga" })).statusCode).toBe(200);
    expect((await sql("SELECT estoque FROM oferta WHERE id = $1", [ofertaId])).rows[0].estoque).toBe(9);
    expect((await sql("SELECT count(*)::int AS n FROM evento WHERE tipo = 'venda.confirmada' AND entidade_id = $1", [venda.id])).rows[0].n).toBe(1);
  });

  it("aviso com token errado é recusado; outra empresa não vê nem paga a cobrança", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const { venda } = await vendaPendente(dono, 3);
    const c = (await dono.pedir("POST", `/api/vendas/${venda.id}/cobrancas`, { forma: "link" })).json();
    expect(c.link).toMatch(/^https:\/\//);
    const idExterno = (await sql("SELECT id_externo FROM cobranca WHERE id = $1", [c.id])).rows[0].id_externo;
    expect((await aviso(e.a.empresaId, "errado", { id: "x1", idExterno, status: "paga" })).statusCode).toBe(403);
    expect((await aviso(e.a.empresaId, undefined, { id: "x2", idExterno, status: "paga" })).statusCode).toBe(403);
    // Token da empresa B (se tiver conta) não serve para a A.
    const donoB = await logado(t.app, email(e.b, "dono"));
    const tokenB = (await donoB.pedir("PUT", "/api/cobranca/conta", { provedor: "demonstracao" })).json().tokenWebhook;
    expect((await aviso(e.a.empresaId, tokenB, { id: "x3", idExterno, status: "paga" })).statusCode).toBe(403);
    // 404 (não existe para B) ou 403 (B sem o módulo de vendas no plano): nunca vê nem paga.
    expect([403, 404]).toContain((await donoB.pedir("POST", `/api/cobrancas/${c.id}/simular-pagamento`)).statusCode);
    expect([403, 404]).toContain((await donoB.get(`/api/vendas/${venda.id}/cobrancas`)).statusCode);
    expect((await sql("SELECT status FROM cobranca WHERE id = $1", [c.id])).rows[0].status).toBe("pendente");

    const cancelada = await dono.pedir("POST", `/api/cobrancas/${c.id}/cancelar`);
    expect(cancelada.json().status).toBe("cancelada");
    const nova = await dono.pedir("POST", `/api/vendas/${venda.id}/cobrancas`, { forma: "boleto" });
    expect(nova.statusCode).toBe(201);
  });

  it("a chave do provedor é guardada cifrada e não aparece na resposta", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    // Sem rede no teste: a demonstração aceita chave e a guarda cifrada como qualquer provedor.
    const r = (await dono.pedir("PUT", "/api/cobranca/conta", { provedor: "demonstracao", chave: "chave-secreta-1234" })).json();
    expect(r.finalChave).toBe("1234");
    expect(JSON.stringify(r)).not.toContain("chave-secreta");
    const guardada = (await sql("SELECT credenciais FROM conta_cobranca WHERE empresa_id = $1", [e.a.empresaId])).rows[0].credenciais;
    expect(guardada).toMatch(/^v1:/);
    expect(guardada).not.toContain("chave-secreta");
  });
});
