import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Cliente,
  SENHA_TESTE,
  email,
  esperarEmail,
  linkDoEmail,
  logado,
  montarTeste,
  semearDuasEmpresas,
  type AmbienteTeste,
  type EmpresasTeste,
} from "../teste/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

async function acoesAuditadas(empresaId: string | null, usuarioId: string): Promise<string[]> {
  const { rows } = await t.banco.pool.query<{ acao: string }>(
    "SELECT acao FROM auditoria WHERE ator_id = $1 AND empresa_id IS NOT DISTINCT FROM $2 ORDER BY criado_em",
    [usuarioId, empresaId],
  );
  return rows.map((r) => r.acao);
}

describe("login", () => {
  it("entra, cria cookie seguro e registra na auditoria", async () => {
    const c = new Cliente(t.app);
    const res = await c.post("/api/auth/entrar", { email: email(e.a, "dono").toUpperCase(), senha: SENHA_TESTE });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((k) => k.name === "mg_sessao");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    const eu = (await c.get("/api/auth/eu")).json();
    expect(eu.empresa.id).toBe(e.a.empresaId);
    expect(eu.perfil.nome).toBe("Dono / Administrador");
    expect(eu.permissoes.usuarios.administrar).toBe("empresa");
    expect(await acoesAuditadas(e.a.empresaId, e.a.pessoas.dono.usuarioId)).toContain("login");
  });

  it("cookie com Secure quando o endereço público é https", async () => {
    const outro = await montarTeste({ APP_URL: "https://app.exemplo.com" });
    try {
      const primeira = await outro.app.inject({ method: "GET", url: "/api/health" });
      expect(primeira.cookies.find((k) => k.name === "mg_csrf")?.secure).toBe(true);
      const c = new Cliente(outro.app);
      const res = await c.post("/api/auth/entrar", { email: email(e.a, "dono"), senha: SENHA_TESTE });
      expect(res.cookies.find((k) => k.name === "mg_sessao")?.secure).toBe(true);
    } finally {
      await outro.fechar();
    }
  });

  it("mesma mensagem para e-mail inexistente e senha errada", async () => {
    const c = new Cliente(t.app);
    const a = await c.post("/api/auth/entrar", { email: "ninguem@teste.example.com", senha: "qualquer coisa" });
    const b = await c.post("/api/auth/entrar", { email: email(e.a, "gestor"), senha: "senha errada aqui" });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().erro).toBe(b.json().erro);
  });

  it("bloqueia depois de 5 tentativas erradas, mesmo com a senha certa", async () => {
    const c = new Cliente(t.app);
    const alvo = email(e.a, "vendedor2");
    for (let i = 0; i < 5; i++) {
      expect((await c.post("/api/auth/entrar", { email: alvo, senha: "senha errada demais" })).statusCode).toBe(401);
    }
    const bloqueado = await c.post("/api/auth/entrar", { email: alvo, senha: SENHA_TESTE });
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.json().erro).toMatch(/Esqueci a senha/);
    expect(await acoesAuditadas(null, e.a.pessoas.vendedor2.usuarioId)).toEqual(Array(5).fill("login.falhou"));
    await t.banco.pool.query("UPDATE usuario SET bloqueado_ate = NULL, tentativas_falhas = 0 WHERE id = $1", [
      e.a.pessoas.vendedor2.usuarioId,
    ]);
  });

  it("limita tentativas de login por IP", async () => {
    const outro = await montarTeste({ LIMITE_LOGIN_MINUTO: "3" });
    try {
      const c = new Cliente(outro.app);
      const status: number[] = [];
      for (let i = 0; i < 4; i++) {
        status.push((await c.post("/api/auth/entrar", { email: "x@teste.example.com", senha: "1234567890" })).statusCode);
      }
      expect(status).toEqual([401, 401, 401, 429]);
    } finally {
      await outro.fechar();
    }
  });

  it("recusa escrita sem o token de CSRF", async () => {
    const c = new Cliente(t.app);
    const res = await c.pedir("POST", "/api/auth/entrar", { email: email(e.a, "dono"), senha: SENHA_TESTE }, true);
    expect(res.statusCode).toBe(403);
    expect(res.json().erro).toMatch(/Recarregue a página/);
  });

  it("entrar de novo no mesmo navegador encerra a sessão anterior", async () => {
    const c = await logado(t.app, email(e.a, "gestor"));
    const antes = (await c.get("/api/auth/sessoes")).json().itens.length;
    await c.entrar(email(e.a, "gestor"));
    expect((await c.get("/api/auth/sessoes")).json().itens.length).toBe(antes);
  });

  it("sair encerra a sessão", async () => {
    const c = await logado(t.app, email(e.a, "gestor"));
    expect((await c.post("/api/auth/sair")).statusCode).toBe(200);
    expect((await c.get("/api/auth/eu")).statusCode).toBe(401);
  });

  it("recusa JSON acima de 1 MB", async () => {
    const c = new Cliente(t.app);
    const res = await c.post("/api/auth/entrar", { email: "a@b.com", senha: "x".repeat(1024 * 1024) });
    expect(res.statusCode).toBe(413);
  });
});

describe("várias empresas e dispositivos", () => {
  it("quem está em duas empresas troca de empresa sem sair", async () => {
    const c = await logado(t.app, email(e.a, "consultor"));
    const eu = (await c.get("/api/auth/eu")).json();
    expect(eu.empresas.map((x: { id: string }) => x.id).sort()).toEqual([e.a.empresaId, e.b.empresaId].sort());
    expect(eu.empresa.id).toBe(e.a.empresaId);

    expect((await c.post("/api/auth/empresa-ativa", { empresaId: e.b.empresaId })).statusCode).toBe(200);
    const depois = (await c.get("/api/auth/eu")).json();
    expect(depois.empresa.id).toBe(e.b.empresaId);
    expect(depois.perfil.nome).toBe("Financeiro");
  });

  it("não troca para empresa em que não tem vínculo", async () => {
    const c = await logado(t.app, email(e.a, "dono"));
    expect((await c.post("/api/auth/empresa-ativa", { empresaId: e.b.empresaId })).statusCode).toBe(404);
  });

  it("lista os dispositivos e encerra um deles", async () => {
    const celular = await logado(t.app, email(e.a, "financeiro"));
    const computador = await logado(t.app, email(e.a, "financeiro"));
    const lista = (await computador.get("/api/auth/sessoes")).json();
    expect(lista.itens.length).toBeGreaterThanOrEqual(2);
    const outra = lista.itens.find((s: { atual: boolean }) => !s.atual);
    expect((await computador.delete(`/api/auth/sessoes/${outra.id}`)).statusCode).toBe(200);
    expect((await celular.get("/api/auth/eu")).statusCode).toBe(401);
    expect((await computador.get("/api/auth/eu")).statusCode).toBe(200);
  });
});

describe("recuperação de senha", () => {
  it("manda link por e-mail, troca a senha e encerra as sessões abertas", async () => {
    const alvo = email(e.b, "vendedor");
    const aberta = await logado(t.app, alvo);
    const inicio = new Date();
    const c = new Cliente(t.app);
    expect((await c.post("/api/auth/esqueci", { email: alvo })).statusCode).toBe(200);
    // Resposta igual para e-mail que não existe.
    expect((await c.post("/api/auth/esqueci", { email: "nao.existe@teste.example.com" })).json()).toEqual({ ok: true });

    const token = linkDoEmail(await esperarEmail(t.banco, alvo, inicio));
    const curta = await c.post("/api/auth/redefinir", { token, senha: "curta" });
    expect(curta.statusCode).toBe(400);
    expect(curta.json().erro).toMatch(/pelo menos 10 caracteres/);

    expect((await c.post("/api/auth/redefinir", { token, senha: "uma senha nova bem longa" })).statusCode).toBe(200);
    expect((await c.post("/api/auth/redefinir", { token, senha: "outra senha nova longa" })).statusCode).toBe(400);
    expect((await aberta.get("/api/auth/eu")).statusCode).toBe(401);
    await new Cliente(t.app).entrar(alvo, "uma senha nova bem longa");
  });

  it("o conteúdo do e-mail não fica legível na fila de jobs", async () => {
    const { rows } = await t.banco.pool.query("SELECT data::text AS d FROM pgboss.job WHERE name = 'aviso.email' LIMIT 5");
    for (const r of rows) expect(r.d).not.toMatch(/token=/);
  });
});

describe("convite", () => {
  it("dono convida, a pessoa cria a senha, entra e o dono é notificado", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const novo = `novo.${Date.now()}@teste.example.com`;
    const inicio = new Date();
    const convite = await dono.post("/api/convites", {
      email: novo,
      nome: "Pessoa Nova",
      perfilId: e.a.perfis.vendedor,
      unidadeId: e.a.unidades.Centro,
    });
    expect(convite.statusCode).toBe(201);

    // Antes de aceitar, não entra.
    expect((await new Cliente(t.app).post("/api/auth/entrar", { email: novo, senha: "qualquer senha" })).statusCode).toBe(401);

    const token = linkDoEmail(await esperarEmail(t.banco, novo, inicio));
    const c = new Cliente(t.app);
    const info = (await c.get(`/api/auth/convite?token=${token}`)).json();
    expect(info).toMatchObject({ empresaNome: e.a.d.nome, email: novo, precisaSenha: true });

    expect((await c.post("/api/auth/aceitar-convite", { token, nome: "Pessoa Nova" })).statusCode).toBe(400);
    expect((await c.post("/api/auth/aceitar-convite", { token, nome: "Pessoa Nova", senha: "senha da pessoa nova" })).statusCode).toBe(200);
    const eu = (await c.get("/api/auth/eu")).json();
    expect(eu.empresa.id).toBe(e.a.empresaId);
    expect(eu.perfil.nome).toBe("Vendedor / Atendente");

    // Link usado não vale de novo.
    expect((await c.get(`/api/auth/convite?token=${token}`)).statusCode).toBe(404);

    const notificacoes = (await dono.get("/api/notificacoes")).json();
    expect(notificacoes.naoLidas).toBeGreaterThanOrEqual(1);
    expect(notificacoes.itens[0].titulo).toMatch(/Pessoa Nova aceitou o convite/);
    expect((await dono.post(`/api/notificacoes/${notificacoes.itens[0].id}/lida`)).statusCode).toBe(200);
  });

  it("convidar quem já está na empresa dá erro claro", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const res = await dono.post("/api/convites", {
      email: email(e.a, "gestor"),
      nome: "Gestor",
      perfilId: e.a.perfis.vendedor,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().erro).toMatch(/já faz parte/);
  });
});
