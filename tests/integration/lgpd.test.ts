// Fase 7 — LGPD: exportar os dados do titular, anonimizar (sem apagar os fatos), "não contatar" em todo
// contato de saída e prazos de retenção aplicados pelo job.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarServicoLgpd } from "../../apps/api/src/modulos/lgpd/lgpd.servico.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";
import { conversaDo, criarCanalDemo, esperar, simular } from "../apoio/conversas.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let canalId: string;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  canalId = await criarCanalDemo(dono);
});
afterAll(() => t.fechar());

const contar = async (sql: string, p: unknown[]) => Number((await t.banco.pool.query<{ n: string }>(sql, p)).rows[0].n);

/** Contato com nota e conversa (mensagem do cliente e resposta). */
async function contatoCompleto(nome: string, telefone: string) {
  const c = (await dono.post("/api/contatos", { nome, telefone, email: `${nome.split(" ")[0].normalize("NFD").replace(/[^a-zA-Z]/g, "").toLowerCase()}@exemplo.com` })).json();
  expect(c.id, JSON.stringify(c)).toBeTruthy();
  expect((await dono.post(`/api/contatos/${c.id}/notas`, { texto: `Nota sobre ${nome}` })).statusCode).toBe(201);
  await simular(dono, canalId, { telefone, texto: `Mensagem de ${nome}` });
  const conversa = await esperar(() => conversaDo(dono, c.telefone), "conversa");
  expect((await dono.post(`/api/conversas/${conversa.id}/mensagens`, { texto: `Resposta para ${nome}` })).statusCode).toBe(201);
  return { ...c, conversaId: conversa.id } as { id: string; telefone: string; conversaId: string };
}

describe("exportar dados do titular", () => {
  it("devolve tudo o que a empresa guarda sobre o contato e registra quem exportou", async () => {
    const c = await contatoCompleto("Renata Exporta", "(11) 96100-0001");
    const r = await dono.get(`/api/contatos/${c.id}/dados-pessoais`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="dados-pessoais-/);
    const d = r.json();
    expect(d.contato).toMatchObject({ nome: "Renata Exporta", telefone: "+5511961000001", email: "renata@exemplo.com" });
    expect(d.notas.map((n: { texto: string }) => n.texto)).toContain("Nota sobre Renata Exporta");
    expect(d.mensagens.map((m: { texto: string }) => m.texto)).toEqual(expect.arrayContaining(["Mensagem de Renata Exporta", "Resposta para Renata Exporta"]));
    expect(d.historico.length).toBeGreaterThan(0);
    expect(await contar("SELECT count(*) AS n FROM auditoria WHERE acao = 'contato.dados_exportados' AND entidade_id = $1", [c.id])).toBe(1);
  });

  it("vendedor (sem permissão de exportar) e outra empresa não exportam", async () => {
    const c = (await dono.post("/api/contatos", { nome: "Sem Export", telefone: "(11) 96100-0009" })).json();
    expect((await (await logado(t.app, email(e.a, "vendedor"))).get(`/api/contatos/${c.id}/dados-pessoais`)).statusCode).toBe(403);
    expect((await (await logado(t.app, email(e.b, "dono"))).get(`/api/contatos/${c.id}/dados-pessoais`)).statusCode).toBe(404);
  });
});

describe("anonimizar", () => {
  it("tira os dados pessoais de tudo, mantém os fatos e não tem volta", async () => {
    const c = await contatoCompleto("Otávio Anônimo", "(11) 96100-0002");
    const eventosAntes = await contar("SELECT count(*) AS n FROM evento WHERE contato_id = $1", [c.id]);
    // Precisa confirmar com a palavra.
    expect((await dono.post(`/api/contatos/${c.id}/anonimizar`, { confirmacao: "sim" })).statusCode).toBe(400);
    expect((await (await logado(t.app, email(e.a, "gestor"))).post(`/api/contatos/${c.id}/anonimizar`, { confirmacao: "ANONIMIZAR" })).statusCode).toBe(403);
    const r = await dono.post(`/api/contatos/${c.id}/anonimizar`, { confirmacao: "ANONIMIZAR" });
    expect(r.statusCode, r.body).toBe(200);

    const ficha = (await dono.get(`/api/contatos/${c.id}`)).json();
    expect(ficha).toMatchObject({ nome: "Contato anonimizado", telefone: null, email: null, naoContatar: true });
    expect(ficha.anonimizadoEm).toBeTruthy();
    expect(ficha.arquivadoEm).toBeTruthy();

    // Nenhum vestígio do nome, telefone ou e-mail em lugar nenhum da empresa — nem no histórico.
    for (const termo of ["Otávio", "961000002", "otavio@exemplo.com"]) {
      for (const [tabela, coluna] of [
        ["contato", "to_jsonb(x)"],
        ["nota", "to_jsonb(x)"],
        ["mensagem", "to_jsonb(x)"],
        ["conversa", "to_jsonb(x)"],
        ["evento", "to_jsonb(x)"],
        ["auditoria", "to_jsonb(x)"],
      ]) {
        const n = await contar(`SELECT count(*) AS n FROM ${tabela} x WHERE x.empresa_id = $1 AND ${coluna}::text ILIKE $2`, [e.a.empresaId, `%${termo}%`]);
        expect(n, `${termo} ainda aparece em ${tabela}`).toBe(0);
      }
    }
    // Os fatos ficam: mesmos eventos (metas e histórico continuam fechando), mais o da anonimização.
    expect(await contar("SELECT count(*) AS n FROM evento WHERE contato_id = $1", [c.id])).toBe(eventosAntes + 1);
    expect(await contar("SELECT count(*) AS n FROM mensagem WHERE conversa_id = $1", [c.conversaId])).toBeGreaterThanOrEqual(2);
    // Fora da anonimização, o histórico continua somente inserção.
    await expect(t.banco.pool.query("UPDATE evento SET dados = '{}' WHERE contato_id = $1", [c.id])).rejects.toThrow(/somente inserção/);
    // De novo: nada muda.
    expect((await dono.post(`/api/contatos/${c.id}/anonimizar`, { confirmacao: "ANONIMIZAR" })).statusCode).toBe(200);
  });
});

describe("não contatar", () => {
  it("vale para conversa nova, ligação por número, fila e mensagens automáticas", async () => {
    const c = (await dono.post("/api/contatos", { nome: "Paula Recusa", telefone: "(11) 96100-0003", naoContatar: true })).json();
    const conversa = await dono.post("/api/conversas", { canalId, contatoId: c.id });
    expect(conversa.statusCode).toBe(400);
    expect(conversa.json().error.message).toMatch(/não ser contatado/);
    const lig = await dono.post("/api/ligacoes", { provedor: "treino", numero: "(11) 96100-0003" });
    expect(lig.statusCode).toBe(400);
    const fila = (await dono.post("/api/filas", { nome: "Fila LGPD" })).json();
    const r = (await dono.post(`/api/filas/${fila.id}/itens`, { contatoIds: [c.id] })).json();
    expect(r).toMatchObject({ adicionados: 0, naoContatar: 1 });

    // Ela escreve: a conversa abre, mas a boas-vindas automática não sai.
    expect((await dono.pedir("PUT", "/api/automacoes/boas_vindas", { texto: "Olá, {nome}!", ativa: true })).statusCode).toBe(200);
    await simular(dono, canalId, { telefone: "(11) 96100-0003", texto: "quero cancelar" });
    const cv = await esperar(() => conversaDo(dono, "+5511961000003"), "conversa da Paula");
    expect(await contar("SELECT count(*) AS n FROM mensagem WHERE conversa_id = $1 AND automacao IS NOT NULL", [cv.id])).toBe(0);
    await dono.pedir("PUT", "/api/automacoes/boas_vindas", { texto: "x", ativa: false });
  });
});

describe("retenção", () => {
  it("valida os prazos e o job aplica: mensagens antigas e contatos arquivados há muito tempo", async () => {
    expect((await dono.pedir("PUT", "/api/empresa/retencao", { mensagensMeses: 3, arquivadosMeses: null })).statusCode).toBe(400);
    expect((await (await logado(t.app, email(e.a, "gestor"))).pedir("PUT", "/api/empresa/retencao", { mensagensMeses: 12, arquivadosMeses: 6 })).statusCode).toBe(403);
    expect((await dono.pedir("PUT", "/api/empresa/retencao", { mensagensMeses: 12, arquivadosMeses: 6 })).json()).toEqual({ mensagensMeses: 12, arquivadosMeses: 6 });

    const velho = await contatoCompleto("Vera Antiga", "(11) 96100-0004");
    await dono.post(`/api/contatos/${velho.id}/arquivar`);
    await t.banco.pool.query("UPDATE contato SET arquivado_em = now() - interval '7 months' WHERE id = $1", [velho.id]);
    const recente = await contatoCompleto("Rita Recente", "(11) 96100-0005");
    await t.banco.pool.query("UPDATE mensagem SET criado_em = now() - interval '13 months' WHERE conversa_id = $1", [recente.conversaId]);

    const r = await criarServicoLgpd({ config: t.config, banco: t.banco, jobs: t.jobs, avisos: null as never, tempoReal: t.tempoReal }).aplicarRetencao();
    expect(r.contatos).toBeGreaterThanOrEqual(1);
    expect(r.mensagens).toBeGreaterThanOrEqual(2);
    expect((await dono.get(`/api/contatos/${velho.id}`)).json().nome).toBe("Contato anonimizado");
    expect((await dono.get(`/api/contatos/${recente.id}`)).json().nome).toBe("Rita Recente");
    const { rows } = await t.banco.pool.query("SELECT DISTINCT texto FROM mensagem WHERE conversa_id = $1", [recente.conversaId]);
    expect(rows).toEqual([{ texto: "[removida pelo prazo de retenção]" }]);
    // A outra empresa não tem prazo: nada dela muda.
    expect(await contar("SELECT count(*) AS n FROM contato WHERE empresa_id = $1 AND anonimizado_em IS NOT NULL", [e.b.empresaId])).toBe(0);
  });
});
