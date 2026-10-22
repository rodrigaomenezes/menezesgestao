// Fase 9 — pronto para vender: atraso avisa e depois deixa só consulta (pagar libera na hora, nada é apagado);
// ninguém passa do limite do plano; painel da plataforma só para a equipe; termos versionados com aceite; redefinir
// as duas etapas só com a confirmação da pessoa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarPessoas, email, esperarEmail, linkDoEmail, logado, montarTeste, semearDuasEmpresas, Cliente, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);

beforeAll(async () => {
  t = await montarTeste({ PLATAFORMA_ADMINS: "suporte.plataforma@teste.example.com" });
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

/** Assinatura da empresa com uma fatura vencida há `dias` dias (0 = sem atraso). */
async function assinaturaComAtraso(empresaId: string, dias: number): Promise<{ assinaturaId: string; faturaId: string | null }> {
  await sql("DELETE FROM fatura WHERE empresa_id = $1", [empresaId]);
  await sql("DELETE FROM assinatura WHERE empresa_id = $1", [empresaId]);
  const a = (
    await sql(
      `INSERT INTO assinatura (empresa_id, plano, status, valor_centavos, provedor, proxima_cobranca)
       VALUES ($1, 'completo', $2, 39900, 'demonstracao', current_date + 20) RETURNING id`,
      [empresaId, dias > 0 ? "atrasada" : "ativa"],
    )
  ).rows[0].id as string;
  if (!dias) return { assinaturaId: a, faturaId: null };
  const f = (
    await sql(
      `INSERT INTO fatura (empresa_id, assinatura_id, plano, valor_centavos, vencimento, status)
       VALUES ($1, $2, 'completo', 39900, (now() AT TIME ZONE 'America/Sao_Paulo')::date - $3::int, 'vencida') RETURNING id`,
      [empresaId, a, dias],
    )
  ).rows[0].id as string;
  return { assinaturaId: a, faturaId: f };
}

describe("bloqueio gradual por atraso", () => {
  it("até 7 dias só avisa; depois fica só para consulta; pagar libera na hora", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    await assinaturaComAtraso(e.a.empresaId, 3);
    const aviso = (await dono.get("/api/auth/eu")).json().assinatura;
    expect(aviso).toEqual({ status: "atrasada", testeAte: null, diasAtraso: 3, somenteLeitura: false });
    expect((await dono.post("/api/contatos", { nome: "Ainda grava", telefone: "11 95555-9001" })).statusCode).toBe(201);

    const { faturaId } = await assinaturaComAtraso(e.a.empresaId, 10);
    expect((await dono.get("/api/auth/eu")).json().assinatura).toMatchObject({ diasAtraso: 10, somenteLeitura: true });
    const recusa = await dono.post("/api/contatos", { nome: "Não grava", telefone: "11 95555-9002" });
    expect(recusa.statusCode).toBe(403);
    expect(recusa.json().error).toMatchObject({ code: "ASSINATURA_SO_LEITURA" });
    expect(recusa.json().error.message).toContain("Plano e cobrança");
    // Consulta continua; pagar a fatura está liberado e devolve tudo na hora.
    expect((await dono.get("/api/contatos?limite=5")).statusCode).toBe(200);
    expect((await dono.post(`/api/faturas/${faturaId}/pagar-simulado`)).statusCode).toBe(200);
    expect((await dono.get("/api/auth/eu")).json().assinatura).toMatchObject({ status: "ativa", somenteLeitura: false });
    expect((await dono.post("/api/contatos", { nome: "Voltou a gravar", telefone: "11 95555-9003" })).statusCode).toBe(201);
  });
});

describe("limites do plano", () => {
  it("convite, canal e restauração param no limite, com mensagem que diz o que fazer; a tela de plano mostra o uso", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    await sql("UPDATE empresa SET plano = 'essencial' WHERE id = $1", [e.a.empresaId]); // 3 pessoas, 1 canal (módulos iguais)
    const perfis = (await dono.get("/api/perfis")).json();
    const perfilId = (perfis.itens ?? perfis)[0].id;
    const convite = await dono.post("/api/convites", { email: `limite.${Date.now()}@teste.example.com`, nome: "Passou do limite", perfilId });
    expect(convite.statusCode).toBe(409);
    expect(convite.json().error.code).toBe("LIMITE_DO_PLANO");
    expect(convite.json().error.message).toMatch(/^Pessoas ativas: o plano da empresa permite 3 e já está em \d+\. Quem administra pode trocar de plano/);

    const canais = (await sql("SELECT count(*)::int AS n FROM canal WHERE empresa_id = $1 AND arquivado_em IS NULL", [e.a.empresaId])).rows[0].n;
    if (canais === 0) expect((await dono.post("/api/canais", { nome: "Primeiro", provedor: "demonstracao" })).statusCode).toBe(201);
    const outro = await dono.post("/api/canais", { nome: "Segundo", provedor: "demonstracao" });
    expect(outro.json().error.code).toBe("LIMITE_DO_PLANO");

    const uso = (await dono.get("/api/assinatura")).json().uso;
    expect(uso.map((u: { recurso: string }) => u.recurso)).toEqual(["usuarios", "canais", "armazenamento"]);
    expect(uso[0]).toMatchObject({ limite: 3 });
    expect(uso[1]).toMatchObject({ usado: 1, limite: 1 });

    await sql("UPDATE empresa SET plano = 'completo' WHERE id = $1", [e.a.empresaId]);
    expect((await dono.post("/api/canais", { nome: "Segundo", provedor: "demonstracao" })).statusCode).toBe(201);
  });
});

describe("painel da plataforma", () => {
  it("só a equipe da plataforma vê todas as empresas; suspender deixa só consulta e reativar devolve", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    expect((await dono.get("/api/plataforma/empresas")).statusCode).toBe(403);
    expect((await dono.get("/api/auth/eu")).json().plataformaAdmin).toBe(false);

    const [admin] = await criarPessoas(t.banco, e.b, 1);
    await sql("UPDATE usuario SET email = 'suporte.plataforma@teste.example.com' WHERE lower(email) = lower($1)", [admin]);
    const plataforma = await logado(t.app, "suporte.plataforma@teste.example.com");
    expect((await plataforma.get("/api/auth/eu")).json().plataformaAdmin).toBe(true);

    const lista = (await plataforma.get(`/api/plataforma/empresas?busca=${encodeURIComponent(e.a.d.nome)}&limite=5`)).json();
    const a = lista.itens.find((x: { id: string }) => x.id === e.a.empresaId);
    expect(a).toMatchObject({ plano: "completo", status: "ativa", saude: expect.stringMatching(/boa|atencao|risco/) });
    expect(a.pessoas).toBeGreaterThan(0);

    const suspensa = await plataforma.post(`/api/plataforma/empresas/${e.a.empresaId}/suspender`, { motivo: "Teste de suspensão" });
    expect(suspensa.json()).toMatchObject({ status: "suspensa", saude: "risco" });
    const recusa = await dono.post("/api/contatos", { nome: "Suspensa", telefone: "11 95555-9004" });
    expect(recusa.json().error.message).toBe("A empresa está suspensa e só pode consultar os dados. Fale com o suporte.");

    expect((await plataforma.post(`/api/plataforma/empresas/${e.a.empresaId}/reativar`)).json().status).toBe("ativa");
    expect((await dono.post("/api/contatos", { nome: "Reativada", telefone: "11 95555-9005" })).statusCode).toBe(201);

    const auditoria = await sql("SELECT acao FROM auditoria WHERE empresa_id = $1 AND acao LIKE 'plataforma.%' ORDER BY criado_em", [e.a.empresaId]);
    expect(auditoria.rows.map((r) => r.acao)).toEqual(["plataforma.suspensa", "plataforma.reativada"]);

    // Estender teste só vale para empresa em teste.
    await sql("UPDATE assinatura SET status = 'teste', teste_ate = current_date + 2 WHERE empresa_id = $1", [e.a.empresaId]);
    const estendida = (await plataforma.post(`/api/plataforma/empresas/${e.a.empresaId}/estender-teste`, { dias: 10 })).json();
    expect(estendida.testeAte).toBe((await sql("SELECT to_char(current_date + 12, 'YYYY-MM-DD') AS d")).rows[0].d);
  });
});

describe("termos com aceite versionado", () => {
  it("documento público com a versão; pessoa nova aceita termos e privacidade; contrato só quem administra", async () => {
    const doc = (await new Cliente(t.app).get("/api/publico/documentos/privacidade")).json();
    expect(doc).toMatchObject({ id: "privacidade", titulo: "Política de Privacidade", versao: "1.0" });
    expect(doc.texto).toContain("Lei Geral de Proteção de Dados");
    expect(doc.texto).not.toMatch(/\{(versao|plataforma|encarregado)\}/);

    const dono = await logado(t.app, email(e.a, "dono"));
    expect((await dono.get("/api/auth/eu")).json().termosPendentes).toEqual([]);

    const [nova] = await criarPessoas(t.banco, e.a, 1);
    const pessoa = await logado(t.app, nova!);
    expect((await pessoa.get("/api/auth/eu")).json().termosPendentes).toEqual(["termos", "privacidade"]);
    expect((await pessoa.post("/api/termos/aceitar", { documentos: ["contrato"] })).statusCode).toBe(403);
    expect((await pessoa.post("/api/termos/aceitar", { documentos: ["termos", "privacidade"] })).statusCode).toBe(200);
    expect((await pessoa.get("/api/auth/eu")).json().termosPendentes).toEqual([]);
    // Prova de aceite é imutável.
    await expect(sql("DELETE FROM termo_aceite WHERE usuario_id = (SELECT id FROM usuario WHERE email = $1)", [nova])).rejects.toThrow(/somente inserção/);
  });
});

describe("redefinir as duas etapas", () => {
  it("o administrador pede, nada muda até a pessoa confirmar pelo e-mail; depois as sessões caem", async () => {
    const alvo = email(e.a, "vendedor");
    const sessaoDoAlvo = await logado(t.app, alvo);
    await sql("UPDATE usuario SET duas_etapas_metodo = 'email', duas_etapas_ativada_em = now() WHERE lower(email) = lower($1)", [alvo]);
    const dono = await logado(t.app, email(e.a, "dono"));
    const inicio = new Date();
    const pedido = await dono.post(`/api/usuarios/${e.a.pessoas.vendedor!.vinculoId}/redefinir-duas-etapas`, { motivo: "Perdeu o celular" });
    expect(pedido.statusCode, pedido.body).toBe(200);
    expect((await sql("SELECT duas_etapas_metodo FROM usuario WHERE lower(email) = lower($1)", [alvo])).rows[0].duas_etapas_metodo).toBe("email");

    const token = linkDoEmail(await esperarEmail(t.banco, alvo, inicio));
    const c = new Cliente(t.app);
    expect((await c.post("/api/auth/duas-etapas/confirmar-redefinicao", { token })).statusCode).toBe(200);
    expect((await sql("SELECT duas_etapas_metodo FROM usuario WHERE lower(email) = lower($1)", [alvo])).rows[0].duas_etapas_metodo).toBeNull();
    expect((await c.post("/api/auth/duas-etapas/confirmar-redefinicao", { token })).statusCode).toBe(400);
    expect((await sessaoDoAlvo.get("/api/auth/eu")).statusCode).toBe(401);

    const proprio = await dono.post(`/api/usuarios/${e.a.pessoas.dono!.vinculoId}/redefinir-duas-etapas`, { motivo: "Eu mesmo" });
    expect(proprio.statusCode).toBe(409);
  });
});

describe("suporte e status", () => {
  it("página de status pública diz se o serviço está operando", async () => {
    const s = (await new Cliente(t.app).get("/api/publico/status")).json();
    expect(s.componentes.map((c: { nome: string }) => c.nome)).toContain("Banco de dados");
    expect(s.componentes.find((c: { nome: string }) => c.nome === "Banco de dados").ok).toBe(true);
    expect((await new Cliente(t.app).get("/api/publico/suporte")).json()).toEqual({ whatsapp: null, email: null, encarregado: null });
  });
});
