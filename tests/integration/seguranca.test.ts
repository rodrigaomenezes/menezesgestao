// Fase 7: login em duas etapas (app autenticador, e-mail, códigos de recuperação) e regra da empresa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { codigoTotp, passoAtual } from "../../apps/api/src/infra/seguranca/totp.js";
import { Cliente, SENHA_TESTE, email, esperarEmail, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

const codigoDoEmail = (texto: string) => {
  const m = texto.match(/é: (\d{6})/);
  if (!m) throw new Error(`e-mail sem código: ${texto}`);
  return m[1];
};

async function ligarApp(c: Cliente): Promise<{ segredo: string; codigos: string[] }> {
  const ini = await c.post("/api/conta/duas-etapas/iniciar", { metodo: "totp" });
  expect(ini.statusCode, ini.body).toBe(200);
  const { segredo, qr } = ini.json();
  expect(qr).toMatch(/^data:image\/png;base64,/);
  const conf = await c.post("/api/conta/duas-etapas/confirmar", { codigo: codigoTotp(segredo, passoAtual()) });
  expect(conf.statusCode, conf.body).toBe(200);
  return { segredo, codigos: conf.json().codigos };
}

describe("duas etapas pelo app autenticador", () => {
  let segredo = "";
  let codigos: string[] = [];
  const quem = () => email(e.a, "gestor");

  it("liga com o primeiro código e devolve 10 códigos de recuperação", async () => {
    const c = await logado(t.app, quem());
    ({ segredo, codigos } = await ligarApp(c));
    expect(codigos).toHaveLength(10);
    expect((await c.get("/api/conta/duas-etapas")).json()).toMatchObject({ ativa: true, metodo: "totp", codigosRestantes: 10 });
    // O segredo fica cifrado no banco; os códigos, só como HMAC.
    const { rows } = await t.banco.pool.query("SELECT duas_etapas_segredo, duas_etapas_recuperacao FROM usuario WHERE lower(email) = lower($1)", [quem()]);
    expect(rows[0].duas_etapas_segredo).toMatch(/^v1:/);
    expect(rows[0].duas_etapas_segredo).not.toContain(segredo);
    expect(rows[0].duas_etapas_recuperacao.join()).not.toContain(codigos[0].replace("-", ""));
  });

  it("senha certa não abre sessão: falta o código; código errado é recusado e contado", async () => {
    const c = new Cliente(t.app);
    const r = await c.post("/api/auth/entrar", { email: quem(), senha: SENHA_TESTE });
    expect(r.json()).toEqual({ ok: true, duasEtapas: { metodo: "totp", destino: null } });
    expect(c.cookies.has("mg_sessao")).toBe(false);
    expect((await c.get("/api/auth/eu")).statusCode).toBe(401);
    const errado = await c.post("/api/auth/duas-etapas", { codigo: "000000" });
    expect(errado.statusCode).toBe(401);
    expect(errado.json().error.code).toBe("CODIGO_INVALIDO");
    const certo = await c.post("/api/auth/duas-etapas", { codigo: codigoTotp(segredo, passoAtual() + 1) });
    expect(certo.statusCode, certo.body).toBe(200);
    expect((await c.get("/api/auth/eu")).json().duasEtapas).toEqual({ ativa: true, obrigatoria: false, pendente: false });
    const { rows } = await t.banco.pool.query("SELECT acao FROM auditoria WHERE ator_id = $1 ORDER BY criado_em", [e.a.pessoas.gestor.usuarioId]);
    expect(rows.map((x) => x.acao)).toEqual(expect.arrayContaining(["duas_etapas.ativada", "login.senha_conferida", "login.codigo_errado", "login"]));
  });

  it("o mesmo código do app não vale duas vezes", async () => {
    const c = new Cliente(t.app);
    await c.post("/api/auth/entrar", { email: quem(), senha: SENHA_TESTE });
    expect((await c.post("/api/auth/duas-etapas", { codigo: codigoTotp(segredo, passoAtual() + 1) })).statusCode).toBe(401);
  });

  it("código de recuperação entra uma vez só", async () => {
    const c = new Cliente(t.app);
    await c.post("/api/auth/entrar", { email: quem(), senha: SENHA_TESTE });
    expect((await c.post("/api/auth/duas-etapas", { codigo: codigos[0].toUpperCase() })).statusCode).toBe(200);
    expect((await c.get("/api/conta/duas-etapas")).json().codigosRestantes).toBe(9);
    const outro = new Cliente(t.app);
    await outro.post("/api/auth/entrar", { email: quem(), senha: SENHA_TESTE });
    expect((await outro.post("/api/auth/duas-etapas", { codigo: codigos[0] })).statusCode).toBe(401);
  });

  it("depois de 5 códigos errados o desafio morre, mesmo com o código certo", async () => {
    const c = new Cliente(t.app);
    await c.post("/api/auth/entrar", { email: quem(), senha: SENHA_TESTE });
    for (let i = 0; i < 5; i++) await c.post("/api/auth/duas-etapas", { codigo: "111111" });
    expect((await c.post("/api/auth/duas-etapas", { codigo: codigos[1] })).statusCode).toBe(401);
    // Sem o cookie do desafio (ou com um inventado), nada feito.
    const sem = new Cliente(t.app);
    expect((await sem.post("/api/auth/duas-etapas", { codigo: codigos[1] })).statusCode).toBe(401);
    // As falhas contam para o bloqueio da conta; zera para os próximos testes.
    await t.banco.pool.query("UPDATE usuario SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1", [e.a.pessoas.gestor.usuarioId]);
  });

  it("desligar pede a senha", async () => {
    const c = new Cliente(t.app);
    await c.post("/api/auth/entrar", { email: quem(), senha: SENHA_TESTE });
    await c.post("/api/auth/duas-etapas", { codigo: codigos[2] });
    expect((await c.post("/api/conta/duas-etapas/desligar", { senha: "errada" })).statusCode).toBe(401);
    expect((await c.post("/api/conta/duas-etapas/desligar", { senha: SENHA_TESTE })).statusCode).toBe(200);
    expect((await new Cliente(t.app).post("/api/auth/entrar", { email: quem(), senha: SENHA_TESTE })).json()).toEqual({ ok: true });
  });
});

describe("duas etapas por e-mail", () => {
  it("configura e entra com o código que chega por e-mail", async () => {
    const quem = email(e.b, "dono");
    const c = await logado(t.app, quem);
    const desde = new Date();
    const ini = (await c.post("/api/conta/duas-etapas/iniciar", { metodo: "email" })).json();
    expect(ini).toMatchObject({ metodo: "email", segredo: null, qr: null });
    expect(ini.destino).toMatch(/^.\*\*\*@/);
    const codigo = codigoDoEmail(await esperarEmail(t.banco, quem, desde));
    expect((await c.post("/api/conta/duas-etapas/confirmar", { codigo })).statusCode).toBe(200);

    const novo = new Cliente(t.app);
    const antes = new Date();
    const r = (await novo.post("/api/auth/entrar", { email: quem, senha: SENHA_TESTE })).json();
    expect(r.duasEtapas.metodo).toBe("email");
    const primeiro = codigoDoEmail(await esperarEmail(t.banco, quem, antes));
    // Pedir outro: o anterior deixa de valer.
    const reenvio = new Date();
    expect((await novo.post("/api/auth/duas-etapas/reenviar")).statusCode).toBe(200);
    const segundo = codigoDoEmail(await esperarEmail(t.banco, quem, reenvio));
    if (primeiro !== segundo) expect((await novo.post("/api/auth/duas-etapas", { codigo: primeiro })).statusCode).toBe(401);
    expect((await novo.post("/api/auth/duas-etapas", { codigo: segundo })).statusCode).toBe(200);
    expect((await novo.get("/api/auth/eu")).json().empresa.id).toBe(e.b.empresaId);
  });
});

describe("regra da empresa", () => {
  it("exigida de todos: quem não configurou só acessa a configuração; depois, tudo volta", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    // Quem exige precisa ter ligado antes.
    expect((await dono.pedir("PUT", "/api/empresa/seguranca", { exigirDuasEtapas: "todos" })).statusCode).toBe(400);
    await ligarApp(dono);
    expect((await dono.pedir("PUT", "/api/empresa/seguranca", { exigirDuasEtapas: "todos" })).statusCode).toBe(200);
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get("/api/auth/eu")).json().duasEtapas).toEqual({ ativa: false, obrigatoria: true, pendente: true });
    const bloqueado = await vendedor.get("/api/contatos");
    expect(bloqueado.statusCode).toBe(403);
    expect(bloqueado.json().error.code).toBe("DUAS_ETAPAS_OBRIGATORIAS");
    await ligarApp(vendedor);
    expect((await vendedor.get("/api/contatos")).statusCode).toBe(200);
    // Exigida: não dá para desligar.
    const desligar = await vendedor.post("/api/conta/duas-etapas/desligar", { senha: SENHA_TESTE });
    expect(desligar.statusCode).toBe(400);
    // Só administradores: o vendedor deixa de ser obrigado.
    expect((await dono.pedir("PUT", "/api/empresa/seguranca", { exigirDuasEtapas: "admins" })).statusCode).toBe(200);
    expect((await vendedor.get("/api/conta/duas-etapas")).json().obrigatoria).toBe(false);
    expect((await dono.get("/api/auth/eu")).json().duasEtapas).toEqual({ ativa: true, obrigatoria: true, pendente: false });
    // Só quem administra configurações muda a regra.
    expect((await vendedor.pedir("PUT", "/api/empresa/seguranca", { exigirDuasEtapas: "nao" })).statusCode).toBe(403);
    expect((await dono.pedir("PUT", "/api/empresa/seguranca", { exigirDuasEtapas: "nao" })).statusCode).toBe(200);
  });
});
