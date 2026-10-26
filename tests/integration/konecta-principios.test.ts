// Princípios trazidos do documento de requisitos da Konecta (entrega 1): perfis padrão novos, limites visíveis,
// erro por campo e duplicidade que aponta o registro existente.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_CAMPOS_POR_TIPO, MAX_ETIQUETAS, permissoesDoPerfilBase } from "@mg/shared";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
const sql = (texto: string, valores: unknown[] = []) => comoSistema(t.banco, (tx) => tx.cliente.query(texto, valores));

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
});
afterAll(() => t.fechar());

/** Permissões do perfil no banco, no mesmo formato de permissoesDoPerfilBase(). */
async function permissoesNoBanco(base: string) {
  const { rows } = await sql(
    `SELECT pe.modulo, pe.acao, pe.escopo FROM permissao pe JOIN perfil p ON p.id = pe.perfil_id WHERE p.empresa_id = $1 AND p.base = $2`,
    [e.a.empresaId, base],
  );
  const r: Record<string, Record<string, string>> = {};
  for (const l of rows as { modulo: string; acao: string; escopo: string }[]) (r[l.modulo] ??= {})[l.acao] = l.escopo;
  return r;
}

describe("perfis padrão da Konecta", () => {
  it("empresa nova nasce com Empresário, Supervisor e Auditor, com as permissões da matriz", async () => {
    for (const base of ["empresario", "supervisor", "auditor"] as const) expect(await permissoesNoBanco(base)).toEqual(permissoesDoPerfilBase(base));
    const auditor = permissoesDoPerfilBase("auditor");
    expect(Object.values(auditor).every((acoes) => Object.keys(acoes!).every((a) => a === "ver"))).toBe(true);
    expect(permissoesDoPerfilBase("supervisor").crm).toEqual({ ver: "equipe", criar: "equipe", editar: "equipe", arquivar: "equipe" });
    expect(permissoesDoPerfilBase("empresario").crm?.exportar).toBeUndefined();
  });

  it("a migração dá os perfis às empresas que já existiam, uma vez só", async () => {
    await sql(`DELETE FROM permissao WHERE perfil_id IN (SELECT id FROM perfil WHERE empresa_id = $1 AND base = 'auditor')`, [e.a.empresaId]);
    await sql(`DELETE FROM perfil WHERE empresa_id = $1 AND base = 'auditor'`, [e.a.empresaId]);
    const migracao = readFileSync(new URL("../../database/migrations/0021_perfis_konecta.sql", import.meta.url), "utf8");
    await sql(migracao);
    await sql(migracao); // idempotente
    expect(await permissoesNoBanco("auditor")).toEqual(permissoesDoPerfilBase("auditor"));
    const { rows } = await sql(`SELECT count(*)::int AS n FROM perfil WHERE empresa_id = $1 AND base = 'auditor'`, [e.a.empresaId]);
    expect(rows[0].n).toBe(1);
  });
});

describe("limites visíveis", () => {
  it(`etiquetas: ${MAX_ETIQUETAS} ativas no máximo; arquivar libera vaga; restaurar no limite é recusado`, async () => {
    const { rows } = await sql(`SELECT count(*)::int AS n FROM etiqueta WHERE empresa_id = $1 AND arquivado_em IS NULL`, [e.a.empresaId]);
    await sql(
      `INSERT INTO etiqueta (empresa_id, nome) SELECT $1, 'Lote ' || g FROM generate_series(1, $2::int) g`,
      [e.a.empresaId, MAX_ETIQUETAS - rows[0].n - 1],
    );
    const ultima = await dono.post("/api/crm/etiquetas", { nome: "Última vaga" });
    expect(ultima.statusCode, ultima.body).toBe(201);
    const passou = await dono.post("/api/crm/etiquetas", { nome: "Uma a mais" });
    expect(passou.statusCode).toBe(400);
    expect(passou.json().error.message).toMatch(/limite/);
    expect((await dono.patch(`/api/crm/etiquetas/${ultima.json().id}`, { arquivado: true })).statusCode).toBe(200);
    const nova = await dono.post("/api/crm/etiquetas", { nome: "Cabe agora" });
    expect(nova.statusCode, nova.body).toBe(201);
    expect((await dono.patch(`/api/crm/etiquetas/${ultima.json().id}`, { arquivado: false })).statusCode).toBe(400);
    // Editar a que já está ativa não ocupa vaga nova.
    expect((await dono.patch(`/api/crm/etiquetas/${nova.json().id}`, { nome: "Renomeada", arquivado: false })).statusCode).toBe(200);
  });

  it(`campos personalizados: ${MAX_CAMPOS_POR_TIPO} ativos por tipo; o outro tipo não é afetado`, async () => {
    await sql(
      `INSERT INTO campo_personalizado (empresa_id, entidade, chave, rotulo, tipo) SELECT $1, 'contato', 'lote_' || g, 'Lote ' || g, 'texto' FROM generate_series(1, $2::int) g`,
      [e.a.empresaId, MAX_CAMPOS_POR_TIPO],
    );
    const passou = await dono.post("/api/crm/campos", { entidade: "contato", chave: "mais_um", rotulo: "Mais um", tipo: "texto" });
    expect(passou.statusCode).toBe(400);
    const outro = await dono.post("/api/crm/campos", { entidade: "oportunidade", chave: "cabe", rotulo: "Cabe", tipo: "texto" });
    expect(outro.statusCode, outro.body).toBe(201);
  });
});

describe("erro por campo e duplicidade", () => {
  it("dado inválido devolve o erro de cada campo em details.campos", async () => {
    const r = await dono.post("/api/contatos", { nome: "", email: "nao-e-email" });
    expect(r.statusCode).toBe(400);
    const campos = (r.json().error.details.campos as { campo: string }[]).map((c) => c.campo);
    expect(campos).toEqual(expect.arrayContaining(["nome", "email"]));
  });

  it("telefone repetido em outro formato não cria outro registro e aponta o existente", async () => {
    const primeiro = await dono.post("/api/contatos", { nome: "Duplicado Um", telefone: "(31) 98877-6655" });
    expect(primeiro.statusCode, primeiro.body).toBe(201);
    const segundo = await dono.post("/api/contatos", { nome: "Duplicado Dois", telefone: "+55 31 98877-6655" });
    expect(segundo.statusCode).toBe(409);
    expect(segundo.json().error.details).toEqual({ contatoId: primeiro.json().id });
  });
});
