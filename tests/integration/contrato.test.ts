// Contrato da API: formato único de erro, DTOs, OpenAPI, saúde dos provedores e identificador (slug) da empresa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { criarEmpresa } from "../../apps/api/src/modulos/empresas/criar-empresa.js";
import {
  Cliente,
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

describe("formato único de erro", () => {
  it("toda falha responde { error: { code, message } }", async () => {
    const anonimo = new Cliente(t.app);
    const semLogin = await anonimo.get("/api/usuarios");
    expect(semLogin.json()).toEqual({ error: { code: "NAO_AUTENTICADO", message: expect.stringMatching(/Entre de novo/) } });

    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.get("/api/usuarios")).json().error.code).toBe("SEM_PERMISSAO");

    const dono = await logado(t.app, email(e.a, "dono"));
    const invalido = await dono.post("/api/unidades", { nome: "" });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().error).toMatchObject({ code: "DADOS_INVALIDOS", details: { campos: [expect.objectContaining({ campo: "nome" })] } });

    const inexistente = await dono.get("/api/usuarios/00000000-0000-4000-8000-000000000000");
    expect(inexistente.json().error.code).toBe("NAO_ENCONTRADO");

    expect((await anonimo.get("/api/nao-existe")).json().error.code).toBe("NAO_ENCONTRADO");
    expect((await anonimo.pedir("POST", "/api/auth/entrar", {}, true)).json().error.code).toBe("CSRF_INVALIDO");
  });

  it("nunca devolve stack trace nem detalhe técnico", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const res = await dono.get("/api/usuarios?cursor=lixo");
    expect(res.body).not.toMatch(/at \w+ \(|node_modules|Error:/);
  });
});

describe("DTOs", () => {
  it("as respostas seguem o contrato e não expõem colunas internas", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const usuarios = (await dono.get("/api/usuarios")).json();
    expect(Object.keys(usuarios.itens[0]).sort()).toEqual(
      ["arquivadoEm", "criadoEm", "email", "equipeId", "equipeNome", "id", "nome", "perfilId", "perfilNome", "status", "unidadeId", "unidadeNome", "usuarioId"].sort(),
    );
    expect(usuarios.itens[0].criadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const eu = (await dono.get("/api/auth/eu")).json();
    expect(JSON.stringify(eu)).not.toMatch(/senha|token_hash|tokenHash/i);
  });
});

describe("documentação OpenAPI", () => {
  it("descreve todas as rotas da API a partir dos esquemas", async () => {
    const doc = (await new Cliente(t.app).get("/api/openapi.json")).json();
    expect(doc.openapi).toMatch(/^3\./);
    const documentadas = new Set(
      Object.entries(doc.paths as Record<string, Record<string, unknown>>).flatMap(([caminho, metodos]) =>
        Object.keys(metodos).map((m) => `${m.toUpperCase()} ${caminho.replace(/\{(\w+)\}/g, ":$1")}`),
      ),
    );
    const ocultas = new Set(["GET /api/tempo-real", "GET /api/openapi.json"]);
    for (const r of t.rotas) {
      const nome = `${r.metodo} ${r.url}`;
      if (!ocultas.has(nome)) expect(documentadas.has(nome), `${nome} sem documentação`).toBe(true);
    }
    expect(doc.paths["/api/convites"].post.requestBody).toBeDefined();
  });
});

describe("saúde", () => {
  it("informa o status dos provedores", async () => {
    const res = (await new Cliente(t.app).get("/api/health")).json();
    expect(res).toMatchObject({ ok: true, provedores: { avisos: "ONLINE" } });
  });
});

describe("identificador (slug) da empresa", () => {
  it("nasce do nome, sem acento, e é único", async () => {
    const [x, y] = await comoSistema(t.banco, async (tx) => {
      const origem = { atorId: null, ip: null, dispositivo: null };
      const nome = `Clínica São José ${Date.now()}`;
      return [await criarEmpresa(tx, origem, { nome, plano: "essencial" }), await criarEmpresa(tx, origem, { nome, plano: "essencial" })];
    });
    expect(x.slug).toMatch(/^clinica-sao-jose-\d+$/);
    expect(y.slug).toBe(`${x.slug}-2`);
  });

  it("o dono troca o slug; repetido ou fora do formato é recusado com explicação", async () => {
    const donoA = await logado(t.app, email(e.a, "dono"));
    const donoB = await logado(t.app, email(e.b, "dono"));
    const slugB = (await donoB.get("/api/empresa")).json().slug;

    const ruim = await donoA.patch("/api/empresa", { slug: "Com Espaço" });
    expect(ruim.json().error.code).toBe("DADOS_INVALIDOS");
    expect(ruim.json().error.message).toMatch(/letras minúsculas/);

    const repetido = await donoA.patch("/api/empresa", { slug: slugB });
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().error.code).toBe("CONFLITO");

    const novo = `escola-a-${Date.now()}`;
    expect((await donoA.patch("/api/empresa", { slug: novo })).json().slug).toBe(novo);
    expect((await donoA.get("/api/auth/eu")).json().empresa.slug).toBe(novo);
  });
});

describe("permissões em tabela", () => {
  it("alterar permissões de um perfil grava linhas e registra antes/depois na auditoria", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const perfil = (await dono.post("/api/perfis", { nome: `Auditor ${Date.now()}`, copiarDe: e.a.perfis.financeiro })).json();
    await dono.patch(`/api/perfis/${perfil.id}`, { permissoes: { auditoria: { ver: "empresa", exportar: "empresa" } } });

    const { rows } = await t.banco.pool.query("SELECT modulo, acao, escopo FROM permissao WHERE perfil_id = $1 ORDER BY acao", [perfil.id]);
    expect(rows).toEqual([
      { modulo: "auditoria", acao: "exportar", escopo: "empresa" },
      { modulo: "auditoria", acao: "ver", escopo: "empresa" },
    ]);
    const registro = (await dono.get(`/api/auditoria?acao=perfil.atualizado`)).json().itens[0];
    expect(registro.antes.permissoes.vendas).toBeDefined();
    expect(registro.depois.permissoes).toEqual({ auditoria: { ver: "empresa", exportar: "empresa" } });
  });

  it("o banco recusa módulo, ação ou escopo fora do catálogo", async () => {
    await expect(
      t.banco.pool.query("INSERT INTO permissao (empresa_id, perfil_id, modulo, acao, escopo) VALUES ($1, $2, 'crm', 'voar', 'empresa')", [
        e.a.empresaId,
        e.a.perfis.gestor,
      ]),
    ).rejects.toThrow(/check constraint/);
  });
});
