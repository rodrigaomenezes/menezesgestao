// Fase 8.4: automação do método BRE. Só liga com a concordância liberada (DEC-010); envia pelo canal com o texto da
// empresa; pula "não contatar", escalonamento aberto e quem não tem telefone; nunca repete; pausa se a concordância cair.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let canalId: string;
let ofertaId: string;
let lote = 0;
let fone = 0;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);
const pessoa = (chave: string) => e.a.pessoas[chave]!.usuarioId;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  canalId = (await sql("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, 'WhatsApp demo', 'demonstracao') RETURNING id", [e.a.empresaId])).rows[0].id;
  ofertaId = (await sql("INSERT INTO oferta (empresa_id, nome) VALUES ($1, 'Perfume') RETURNING id", [e.a.empresaId])).rows[0].id;
});
afterAll(() => t.fechar());

/** n pares análise da IA → registro da equipe; `diferentes` com temperatura diferente (abaixam a concordância). */
async function pares(n: number, diferentes = 0) {
  const base = 1000 * ++lote;
  const contato = (await sql("INSERT INTO contato (empresa_id, nome) VALUES ($1, 'Amostra') RETURNING id", [e.a.empresaId])).rows[0].id;
  const conv = (await sql("INSERT INTO conversa (empresa_id, canal_id, contato_id) VALUES ($1, $2, $3) RETURNING id", [e.a.empresaId, canalId, contato])).rows[0].id;
  for (let i = 0; i < n; i++) {
    await sql(
      `INSERT INTO analise_bre (empresa_id, conversa_id, contato_id, provedor, doutrina, saida, autor_id, criado_em)
       VALUES ($1, $2, $3, 'demonstracao', 'BRE-v1.0 / ETR 0.2', '{"resultado":"ADVANCED","temperatura":"HOT","break":null}', $4, now() + make_interval(secs => $5))`,
      [e.a.empresaId, conv, contato, pessoa("dono"), base + 2 * i],
    );
    await sql(
      `INSERT INTO registro_bre (empresa_id, contato_id, conversa_id, autor_id, resultado, temperatura, proxima_acao, criado_em)
       VALUES ($1, $2, $3, $4, 'ADVANCED', $5, 'CALL_BACK', now() + make_interval(secs => $6))`,
      [e.a.empresaId, contato, conv, pessoa("vendedor"), i < diferentes ? "COLD" : "HOT", base + 2 * i + 1],
    );
    await sql(
      `INSERT INTO sq_bre (empresa_id, conversa_id, avaliado_id, provedor, previa, nota_previa, confirmada, nota, confirmada_por, confirmada_em, criado_por)
       VALUES ($1, $2, $3, 'demonstracao', '{}', 70, '{}', 72, $4, now() + make_interval(secs => $5), $4)`,
      [e.a.empresaId, conv, pessoa("vendedor"), pessoa("dono"), base + 2 * i + 1],
    );
  }
}

/** Cliente com venda confirmada há `dias` dias. */
async function clienteComVenda(nome: string, dias: number, extra: { telefone?: boolean; naoContatar?: boolean; campos?: object } = {}) {
  const telefone = extra.telefone === false ? null : `+551199${String(++fone).padStart(7, "0")}`;
  const id = (
    await sql("INSERT INTO contato (empresa_id, nome, telefone, nao_contatar, responsavel_id, campos) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id", [
      e.a.empresaId,
      nome,
      telefone,
      extra.naoContatar ?? false,
      pessoa("vendedor"),
      JSON.stringify(extra.campos ?? {}),
    ])
  ).rows[0].id as string;
  if (dias >= 0) {
    await sql(
      `INSERT INTO venda (empresa_id, contato_id, oferta_id, vendedor_id, valor_centavos, forma_pagamento, status, data_venda)
       VALUES ($1, $2, $3, $4, 10000, 'pix', 'confirmada', (now() AT TIME ZONE 'America/Sao_Paulo')::date - $5::int)`,
      [e.a.empresaId, id, ofertaId, pessoa("vendedor"), dias],
    );
  }
  return id;
}

const saidas = async (contatoId: string) =>
  (await sql("SELECT m.texto FROM mensagem m JOIN conversa c ON c.id = m.conversa_id WHERE c.contato_id = $1 AND m.direcao = 'saida'", [contatoId])).rows.map((r) => r.texto);

describe("Automação BRE (fase 8.4)", () => {
  it("só liga com o painel IA × equipe liberado; envia o pós-venda com o texto da empresa e pula quem não pode receber", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    await dono.pedir("PUT", "/api/bre/config", { amostraParaAutomacao: 20, concordanciaParaAutomacao: 85 });
    const criada = await dono.pedir("POST", "/api/bre/automacoes", { tipo: "POS_VENDA", nome: "Chegou bem?", canalId, texto: "Oi {nome}, chegou bem? Qualquer coisa, fale com {vendedor}.", dias: 2 });
    expect(criada.statusCode, criada.body).toBe(201);
    const automacao = criada.json();
    expect(automacao.ativa).toBe(false);

    const semLiberacao = await dono.pedir("PATCH", `/api/bre/automacoes/${automacao.id}`, { ativa: true });
    expect(semLiberacao.statusCode).toBe(400);
    expect(semLiberacao.json().error.message).toContain("o painel IA × equipe precisa estar liberado");

    await pares(20);
    expect((await dono.pedir("PATCH", `/api/bre/automacoes/${automacao.id}`, { ativa: true })).json().ativa).toBe(true);

    const maria = await clienteComVenda("Maria Souza", 2);
    const naoQuer = await clienteComVenda("Não Quer", 2, { naoContatar: true });
    const escalado = await clienteComVenda("Escalado", 2);
    await sql("INSERT INTO escalonamento (empresa_id, contato_id, situacao, origem) VALUES ($1, $2, 'COMPLAINT', 'manual')", [e.a.empresaId, escalado]);
    const semFone = await clienteComVenda("Sem Fone", 2, { telefone: false });
    const outroDia = await clienteComVenda("Outro Dia", 5);

    const r = (await dono.pedir("POST", "/api/bre/automacoes/executar")).json();
    expect(r).toEqual({ enviadas: 1, ignoradas: 3, pausada: null });
    expect(await saidas(maria)).toEqual(["Oi Maria, chegou bem? Qualquer coisa, fale com Vendedor A1."]);
    for (const c of [naoQuer, escalado, semFone, outroDia]) expect(await saidas(c)).toEqual([]);

    const motivos = (await sql("SELECT c.nome, x.status, x.detalhe FROM bre_automacao_execucao x JOIN contato c ON c.id = x.contato_id WHERE x.automacao_id = $1 ORDER BY c.nome", [automacao.id])).rows;
    expect(motivos).toEqual([
      { nome: "Escalado", status: "ignorada", detalhe: "Está com uma pessoa (escalonamento aberto)." },
      { nome: "Maria Souza", status: "enviada", detalhe: null },
      { nome: "Não Quer", status: "ignorada", detalhe: "O aluno pediu para não ser contatado. Só fale de novo quando o aluno mandar mensagem." },
      { nome: "Sem Fone", status: "ignorada", detalhe: "Sem telefone." },
    ]);

    // Rodar de novo não repete nada.
    expect((await dono.pedir("POST", "/api/bre/automacoes/executar")).json()).toEqual({ enviadas: 0, ignoradas: 0, pausada: null });
    expect(await saidas(maria)).toHaveLength(1);
    const lista = (await dono.get("/api/bre/automacoes/execucoes?limite=10")).json();
    expect(lista.itens).toHaveLength(4);

    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get("/api/bre/automacoes")).statusCode).toBe(403);
  });

  it("aniversário pelo campo de data da empresa", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    expect((await dono.pedir("POST", "/api/crm/campos", { entidade: "contato", chave: "nascimento", rotulo: "Data de nascimento", tipo: "data" })).statusCode).toBe(201);
    const errada = await dono.pedir("POST", "/api/bre/automacoes", { tipo: "ANIVERSARIO", nome: "Parabéns", canalId, texto: "Parabéns, {nome}!", campoChave: "nao_existe" });
    expect(errada.json().error.message).toBe("Escolha um campo de data do cadastro (ex.: data de nascimento).");
    const a = (await dono.pedir("POST", "/api/bre/automacoes", { tipo: "ANIVERSARIO", nome: "Parabéns", canalId, texto: "Parabéns, {nome}!", campoChave: "nascimento" })).json();
    await dono.pedir("PATCH", `/api/bre/automacoes/${a.id}`, { ativa: true });
    const hoje = (await sql("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'MM-DD') AS d")).rows[0].d;
    const aniversariante = await clienteComVenda("Ana Lima", -1, { campos: { nascimento: `1990-${hoje}` } });
    const outro = await clienteComVenda("Bruno", -1, { campos: { nascimento: "1990-01-01" === `1990-${hoje}` ? "1990-01-02" : "1990-01-01" } });
    await dono.pedir("POST", "/api/bre/automacoes/executar");
    expect(await saidas(aniversariante)).toEqual(["Parabéns, Ana!"]);
    expect(await saidas(outro)).toEqual([]);
  });

  it("se a concordância cair, as automações ligadas pausam sozinhas", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    await pares(20, 10);
    const cliente = await clienteComVenda("Depois da Queda", 2);
    const r = (await dono.pedir("POST", "/api/bre/automacoes/executar")).json();
    expect(r.enviadas).toBe(0);
    expect(r.pausada).toContain("Temperatura");
    expect(await saidas(cliente)).toEqual([]);
  });
});
