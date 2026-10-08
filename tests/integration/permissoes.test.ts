// Permissão por módulo × ação × escopo, checada no servidor.
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrarAcesso } from "../../apps/api/src/modulos/acesso/acesso.js";
import {
  email,
  logado,
  montarTeste,
  semearDuasEmpresas,
  type AmbienteTeste,
  type EmpresasTeste,
} from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

const nomes = (corpo: { itens: { nome: string }[] }) => corpo.itens.map((i) => i.nome).sort();

describe("declaração de acesso", () => {
  it("o servidor não sobe com rota /api sem declarar acesso", async () => {
    const app = Fastify();
    await app.register(cookie);
    registrarAcesso(app, t.banco, t.config);
    expect(() => app.get("/api/esquecida", async () => ({ ok: true }))).toThrow(
      /Rota sem declaração de acesso: GET \/api\/esquecida/,
    );
    await app.close();
  });

  it("sem login, rota protegida responde 401 com orientação", async () => {
    const res = await t.app.inject({ method: "GET", url: "/api/usuarios" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(/Entre de novo/);
  });
});

describe("perfis", () => {
  it("vendedor não acessa usuários, configurações nem auditoria", async () => {
    const c = await logado(t.app, email(e.a, "vendedor"));
    for (const url of ["/api/usuarios", "/api/unidades", "/api/empresa", "/api/auditoria", "/api/perfis"]) {
      const res = await c.get(url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.message).toMatch(/administrador/);
    }
    expect((await c.post("/api/convites", { email: "x@teste.example.com", nome: "X", perfilId: e.a.perfis.dono })).statusCode).toBe(403);
  });

  it("gestor vê usuários só da própria equipe e não edita", async () => {
    const c = await logado(t.app, email(e.a, "gestor"));
    const res = await c.get("/api/usuarios");
    expect(res.statusCode).toBe(200);
    expect(nomes(res.json())).toEqual(["Gestor A", "Vendedor A1"]);
    // Vendedor de outra equipe: não aparece nem por id.
    expect((await c.get(`/api/usuarios/${e.a.pessoas.vendedor2.vinculoId}`)).statusCode).toBe(404);
    expect((await c.patch(`/api/usuarios/${e.a.pessoas.vendedor.vinculoId}`, { perfilId: e.a.perfis.dono })).statusCode).toBe(403);
  });

  it("gestor vê a auditoria só de quem está na equipe dele", async () => {
    await logado(t.app, email(e.a, "vendedor2"));
    await logado(t.app, email(e.a, "vendedor"));
    const c = await logado(t.app, email(e.a, "gestor"));
    const itens = (await c.get("/api/auditoria")).json().itens as { atorId: string }[];
    const atores = new Set(itens.map((i) => i.atorId));
    expect(atores.has(e.a.pessoas.vendedor.usuarioId)).toBe(true);
    expect(atores.has(e.a.pessoas.vendedor2.usuarioId)).toBe(false);
  });

  it("financeiro vê a auditoria da empresa toda", async () => {
    const c = await logado(t.app, email(e.a, "financeiro"));
    const itens = (await c.get("/api/auditoria?acao=login")).json().itens as { atorId: string }[];
    expect(new Set(itens.map((i) => i.atorId)).has(e.a.pessoas.vendedor2.usuarioId)).toBe(true);
  });

  it("perfil personalizado: dono copia, ajusta, e a mudança vale na hora", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const sdr = (await dono.post("/api/perfis", { nome: "SDR", copiarDe: e.a.perfis.vendedor })).json();
    const ajuste = await dono.patch(`/api/perfis/${sdr.id}`, {
      permissoes: { ...sdr.permissoes, usuarios: { ver: "empresa" }, inventado: { ver: "empresa" } },
    });
    expect(ajuste.statusCode).toBe(200);
    expect(ajuste.json().permissoes.usuarios).toEqual({ ver: "empresa" });
    expect(ajuste.json().permissoes.inventado).toBeUndefined();

    expect((await dono.patch(`/api/usuarios/${e.a.pessoas.vendedor.vinculoId}`, { perfilId: sdr.id })).statusCode).toBe(200);
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get("/api/usuarios")).statusCode).toBe(200);

    // Em uso, não arquiva.
    const arquivar = await dono.post(`/api/perfis/${sdr.id}/arquivar`);
    expect(arquivar.statusCode).toBe(409);
    expect(arquivar.json().error.message).toMatch(/em uso/);
  });

  it("o perfil de Dono é protegido e sempre sobra um Dono", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    expect((await dono.patch(`/api/perfis/${e.a.perfis.dono}`, { permissoes: {} })).statusCode).toBe(403);
    expect((await dono.post(`/api/usuarios/${e.a.pessoas.dono.vinculoId}/arquivar`)).statusCode).toBe(409);
    expect((await dono.patch(`/api/usuarios/${e.a.pessoas.dono.vinculoId}`, { perfilId: e.a.perfis.gestor })).statusCode).toBe(409);
  });
});

describe("arquivar e restaurar", () => {
  it("arquivar tira o acesso sem apagar; restaurar devolve tudo", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const fin = await logado(t.app, email(e.a, "financeiro"));
    const alvo = e.a.pessoas.financeiro.vinculoId;

    expect((await dono.post(`/api/usuarios/${alvo}/arquivar`)).statusCode).toBe(200);
    expect((await fin.get("/api/auditoria")).statusCode).toBe(403);
    expect(nomes((await dono.get("/api/usuarios")).json())).not.toContain("Financeiro A");
    expect(nomes((await dono.get("/api/usuarios?arquivados=sim")).json())).toContain("Financeiro A");

    expect((await dono.post(`/api/usuarios/${alvo}/restaurar`)).statusCode).toBe(200);
    expect((await fin.get("/api/auditoria")).statusCode).toBe(200);

    const acoes = (await dono.get(`/api/auditoria?entidade=usuario`)).json().itens.map((i: { acao: string }) => i.acao);
    expect(acoes).toEqual(expect.arrayContaining(["usuario.arquivado", "usuario.restaurado"]));
  });

  it("unidades e equipes: criar, editar, arquivar e restaurar geram auditoria e eventos", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const u = (await dono.post("/api/unidades", { nome: "Nova unidade" })).json();
    expect((await dono.patch(`/api/unidades/${u.id}`, { endereco: "Rua 1" })).json().endereco).toBe("Rua 1");
    expect((await dono.post(`/api/unidades/${u.id}/arquivar`)).statusCode).toBe(200);
    expect((await dono.post(`/api/unidades/${u.id}/restaurar`)).statusCode).toBe(200);

    const eq = await dono.post("/api/equipes", { nome: "Equipe nova", unidadeId: u.id, gestorId: e.a.pessoas.gestor.usuarioId });
    expect(eq.statusCode).toBe(201);
    expect(eq.json().gestorNome).toBe("Gestor A");

    const { rows } = await t.banco.pool.query<{ tipo: string }>(
      "SELECT tipo FROM evento WHERE empresa_id = $1 AND entidade_id = $2 ORDER BY criado_em",
      [e.a.empresaId, u.id],
    );
    expect(rows.map((r) => r.tipo)).toEqual(["unidade.criada", "unidade.atualizada", "unidade.arquivada", "unidade.restaurada"]);
  });

  it("listagem pagina por cursor", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const p1 = (await dono.get("/api/usuarios?limite=2")).json();
    expect(p1.itens).toHaveLength(2);
    expect(p1.proximoCursor).toBeTruthy();
    const p2 = (await dono.get(`/api/usuarios?limite=2&cursor=${p1.proximoCursor}`)).json();
    expect(p2.itens).toHaveLength(2);
    expect(p2.itens.map((i: { id: string }) => i.id)).not.toContain(p1.itens[0].id);
    expect((await dono.get("/api/usuarios?limite=500")).statusCode).toBe(400);
    expect((await dono.get("/api/usuarios?cursor=lixo")).statusCode).toBe(400);
  });
});

describe("empresa e marca", () => {
  it("dono troca nome e cores; cor inválida é recusada com explicação", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const ruim = await dono.patch("/api/empresa", { marca: { corPrimaria: "azul", corDestaque: "#000000" } });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().error.message).toMatch(/#RRGGBB/);
    const ok = await dono.patch("/api/empresa", { marca: { corPrimaria: "#123456", corDestaque: "#654321" }, fuso: "America/Manaus" });
    expect(ok.statusCode).toBe(200);
    expect((await dono.get("/api/marca")).json().corPrimaria).toBe("#123456");
    expect((await dono.get("/api/auth/eu")).json().marca.corPrimaria).toBe("#123456");
  });
});
