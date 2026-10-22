// Pendências da fase 8: o BPI fica desatualizado quando a venda ou a etapa muda; o catálogo guarda categoria, estoque
// e lançamento (a venda confirmada baixa o estoque); automações de lançamento compatível e alerta de estoque; e a
// automação pode sair como mensagem modelo aprovada na Meta.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let canalId: string;
let fone = 0;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);
const pessoa = (chave: string) => e.a.pessoas[chave]!.usuarioId;
const bpiVelho = async () => (await sql("SELECT bool_and(calculado_em = '-infinity') AS velho FROM bre_bpi WHERE empresa_id = $1", [e.a.empresaId])).rows[0].velho;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  canalId = (await sql("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, 'WhatsApp demo', 'demonstracao') RETURNING id", [e.a.empresaId])).rows[0].id;
});
afterAll(() => t.fechar());

/** Concordância IA × equipe liberada (20 pares iguais), para poder ligar automações. */
async function liberarAutomacao() {
  const contato = (await sql("INSERT INTO contato (empresa_id, nome) VALUES ($1, 'Amostra') RETURNING id", [e.a.empresaId])).rows[0].id;
  const conv = (await sql("INSERT INTO conversa (empresa_id, canal_id, contato_id) VALUES ($1, $2, $3) RETURNING id", [e.a.empresaId, canalId, contato])).rows[0].id;
  for (let i = 0; i < 20; i++) {
    await sql(
      `INSERT INTO analise_bre (empresa_id, conversa_id, contato_id, provedor, doutrina, saida, autor_id, criado_em)
       VALUES ($1, $2, $3, 'demonstracao', 'BRE-v1.0 / ETR 0.2', '{"resultado":"ADVANCED","temperatura":"HOT","break":null}', $4, now() + make_interval(secs => $5))`,
      [e.a.empresaId, conv, contato, pessoa("dono"), 2 * i],
    );
    await sql(
      `INSERT INTO registro_bre (empresa_id, contato_id, conversa_id, autor_id, resultado, temperatura, proxima_acao, criado_em)
       VALUES ($1, $2, $3, $4, 'ADVANCED', 'HOT', 'CALL_BACK', now() + make_interval(secs => $5))`,
      [e.a.empresaId, contato, conv, pessoa("vendedor"), 2 * i + 1],
    );
    await sql(
      `INSERT INTO sq_bre (empresa_id, conversa_id, avaliado_id, provedor, previa, nota_previa, confirmada, nota, confirmada_por, confirmada_em, criado_por)
       VALUES ($1, $2, $3, 'demonstracao', '{}', 70, '{}', 72, $4, now() + make_interval(secs => $5), $4)`,
      [e.a.empresaId, conv, pessoa("vendedor"), pessoa("dono"), 2 * i + 1],
    );
  }
  const dono = await logado(t.app, email(e.a, "dono"));
  await dono.pedir("PUT", "/api/bre/config", { amostraParaAutomacao: 20, concordanciaParaAutomacao: 85 });
}

async function comprador(nome: string, ofertaId: string) {
  const id = (
    await sql("INSERT INTO contato (empresa_id, nome, telefone, responsavel_id) VALUES ($1, $2, $3, $4) RETURNING id", [
      e.a.empresaId,
      nome,
      `+551198${String(++fone).padStart(7, "0")}`,
      pessoa("vendedor"),
    ])
  ).rows[0].id as string;
  await sql(
    `INSERT INTO venda (empresa_id, contato_id, oferta_id, vendedor_id, valor_centavos, forma_pagamento, status, data_venda)
     VALUES ($1, $2, $3, $4, 10000, 'pix', 'confirmada', (now() AT TIME ZONE 'America/Sao_Paulo')::date - 30)`,
    [e.a.empresaId, id, ofertaId, pessoa("vendedor")],
  );
  return id;
}

const saidas = async (contatoId: string) =>
  (await sql("SELECT m.texto, m.modelo FROM mensagem m JOIN conversa c ON c.id = m.conversa_id WHERE c.contato_id = $1 AND m.direcao = 'saida'", [contatoId])).rows;

describe("BPI desatualizado por venda e etapa", () => {
  it("venda confirmada, cancelada e mudança de etapa marcam o BPI para recalcular; a venda confirmada baixa o estoque e o cancelamento devolve", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const oferta = (await dono.pedir("POST", "/api/ofertas", { nome: "Kit Verão", categoria: "Perfumaria", estoque: 3, lancamentoEm: "2026-11-01" })).json();
    expect(oferta).toMatchObject({ categoria: "Perfumaria", estoque: 3, lancamentoEm: "2026-11-01" });
    const contato = (await dono.pedir("POST", "/api/contatos", { nome: "Carla Estoque", telefone: "11 95555-7001" })).json();

    await dono.get("/api/bre/desempenho?atualizar=sim");
    expect(await bpiVelho()).toBe(false);
    const venda = (await dono.pedir("POST", "/api/vendas", { contatoId: contato.id, ofertaId: oferta.id, valorCentavos: 9900, formaPagamento: "pix", status: "confirmada" })).json();
    expect(await bpiVelho()).toBe(true);
    const estoque = async () => (await sql("SELECT estoque FROM oferta WHERE id = $1", [oferta.id])).rows[0].estoque;
    expect(await estoque()).toBe(2);

    await dono.get("/api/bre/desempenho?atualizar=sim");
    expect((await dono.pedir("PATCH", `/api/vendas/${venda.id}`, { status: "cancelada", motivoCancelamento: "Desistiu" })).statusCode).toBe(200);
    expect(await bpiVelho()).toBe(true);
    expect(await estoque()).toBe(3);

    await dono.get("/api/bre/desempenho?atualizar=sim");
    const config = (await dono.get("/api/crm/configuracao")).json();
    const funil = config.funis[0];
    const op = (await dono.pedir("POST", "/api/oportunidades", { contatoId: contato.id, funilId: funil.id, titulo: "Kit Carla" })).json();
    const destino = funil.etapas.filter((x: { tipo: string }) => x.tipo === "aberta")[1];
    expect((await dono.pedir("POST", `/api/oportunidades/${op.id}/etapa`, { etapaId: destino.id })).statusCode).toBe(200);
    expect(await bpiVelho()).toBe(true);

    const errado = await dono.pedir("PATCH", `/api/ofertas/${oferta.id}`, { estoque: -1 });
    expect(errado.json().error.message).toContain("Estoque: use 0 ou mais.");
  });
});

describe("Lançamento compatível, alerta de estoque e mensagem modelo", () => {
  it("avisa quem já comprou da mesma categoria, uma vez só, com o {produto}; a automação com modelo da Meta grava o modelo preenchido", async () => {
    await liberarAutomacao();
    const dono = await logado(t.app, email(e.a, "dono"));
    const hoje = (await sql("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d as string;
    const antiga = (await dono.pedir("POST", "/api/ofertas", { nome: "Colônia Clássica", categoria: "fragrâncias" })).json();
    const nova = (await dono.pedir("POST", "/api/ofertas", { nome: "Colônia Nova", categoria: "Fragrâncias", lancamentoEm: hoje })).json();
    const outraLinha = (await dono.pedir("POST", "/api/ofertas", { nome: "Hidratante", categoria: "Cuidados", estoque: 2 })).json();
    const hidratanteIrmao = (await dono.pedir("POST", "/api/ofertas", { nome: "Loção", categoria: "Cuidados" })).json();

    const fiel = await comprador("Fernanda Fiel", antiga.id);
    const outro = await comprador("Otávio Outro", outraLinha.id);
    const pele = await comprador("Paula Pele", hidratanteIrmao.id);

    const lanc = await dono.pedir("POST", "/api/bre/automacoes", {
      tipo: "LANCAMENTO",
      nome: "Lançamento",
      canalId,
      texto: "Oi {nome}, chegou {produto}!",
      modelo: { nome: "lancamento_v1", idioma: "pt_BR", parametros: ["nome", "produto"] },
    });
    expect(lanc.statusCode, lanc.body).toBe(201);
    expect(lanc.json().modelo).toEqual({ nome: "lancamento_v1", idioma: "pt_BR", parametros: ["nome", "produto"] });
    const semLimite = await dono.pedir("POST", "/api/bre/automacoes", { tipo: "ESTOQUE", nome: "Últimas", canalId, texto: "x" });
    expect(semLimite.json().error.message).toContain("Diga a partir de quantas unidades avisar.");
    const est = (await dono.pedir("POST", "/api/bre/automacoes", { tipo: "ESTOQUE", nome: "Últimas unidades", canalId, texto: "{nome}, últimas unidades de {produto}.", limiteEstoque: 2 })).json();
    expect(est.limiteEstoque).toBe(2);
    for (const a of [lanc.json(), est]) expect((await dono.pedir("PATCH", `/api/bre/automacoes/${a.id}`, { ativa: true })).json().ativa).toBe(true);

    const r = (await dono.pedir("POST", "/api/bre/automacoes/executar")).json();
    expect(r).toMatchObject({ enviadas: 2, pausada: null });
    expect(await saidas(fiel)).toEqual([{ texto: "Oi Fernanda, chegou Colônia Nova!", modelo: { nome: "lancamento_v1", idioma: "pt_BR", parametros: ["Fernanda", "Colônia Nova"] } }]);
    expect(await saidas(pele)).toEqual([{ texto: "Paula, últimas unidades de Hidratante.", modelo: null }]);
    // Quem comprou o próprio item com estoque baixo não é "compatível" com ele; nem quem é de outra linha.
    expect(await saidas(outro)).toEqual([]);

    expect((await dono.pedir("POST", "/api/bre/automacoes/executar")).json()).toMatchObject({ enviadas: 0 });
    expect(nova.lancamentoEm).toBe(hoje);

    // Tirar o modelo volta a mandar texto comum.
    const semModelo = (await dono.pedir("PATCH", `/api/bre/automacoes/${lanc.json().id}`, { modelo: null })).json();
    expect(semModelo.modelo).toBeNull();
    const nomeErrado = await dono.pedir("PATCH", `/api/bre/automacoes/${lanc.json().id}`, { modelo: { nome: "Com Espaço" } });
    expect(nomeErrado.json().error.message).toContain("Nome do modelo: use o nome exato aprovado na Meta (letras minúsculas, números e _).");
  });
});
