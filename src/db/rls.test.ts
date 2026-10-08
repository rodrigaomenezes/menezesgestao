// Segunda barreira do isolamento: o próprio PostgreSQL, sem passar pela API.
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { comEmpresa, comoSistema, criarBanco, type Banco } from "./banco.js";
import { migrar } from "./migrar.js";
import { semearDuasEmpresas, type EmpresasTeste } from "../teste/app-teste.js";
import { urlBancoTeste } from "../teste/ambiente.js";

let banco: Banco;
let e: EmpresasTeste;

beforeAll(async () => {
  banco = criarBanco(urlBancoTeste());
  e = await semearDuasEmpresas(banco);
});
afterAll(() => banco.pool.end());

/** Tabelas de negócio: todas as que têm empresa_id, mais a própria empresa. */
async function tabelasDeNegocio(): Promise<string[]> {
  const { rows } = await banco.pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'empresa_id' ORDER BY table_name`,
  );
  return rows.map((r) => r.table_name);
}

/** Roda como o papel da aplicação, com ou sem empresa no contexto. */
async function comoApp<T>(empresaId: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await banco.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE mg_app");
    if (empresaId) await c.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

describe("Row Level Security", () => {
  it("toda tabela com empresa_id tem RLS ligado e política", async () => {
    const tabelas = await tabelasDeNegocio();
    expect(tabelas.length).toBeGreaterThanOrEqual(8);
    for (const t of [...tabelas, "empresa", "usuario"]) {
      const { rows } = await banco.pool.query<{ rls: boolean; politicas: number; leitura: boolean }>(
        `SELECT c.relrowsecurity AS rls,
                (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS politicas,
                has_table_privilege('mg_app', c.oid, 'SELECT') AS leitura
           FROM pg_class c WHERE c.relname = $1 AND c.relnamespace = 'public'::regnamespace`,
        [t],
      );
      expect(rows[0].rls, `${t} sem RLS`).toBe(true);
      // Tabela só do sistema (ex.: sessão) fica sem política e sem leitura para a aplicação: nada passa.
      if (rows[0].leitura || t !== "sessao") expect(rows[0].politicas, `${t} sem política`).toBeGreaterThan(0);
    }
  });

  it("o papel da aplicação não ignora o RLS", async () => {
    const { rows } = await banco.pool.query("SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'mg_app'");
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("sem empresa no contexto, não enxerga nada", async () => {
    for (const t of [...(await tabelasDeNegocio()), "empresa"]) {
      if (t === "sessao" || t === "token_acesso") continue;
      const { rows } = await comoApp(null, (c) => c.query(`SELECT count(*)::int AS n FROM ${t}`));
      expect(rows[0].n, t).toBe(0);
    }
  });

  it("com a empresa A, um SELECT sem WHERE só devolve linhas de A", async () => {
    for (const t of await tabelasDeNegocio()) {
      if (t === "sessao" || t === "token_acesso") continue;
      const { rows } = await comoApp(e.a.empresaId, (c) => c.query(`SELECT DISTINCT empresa_id FROM ${t}`));
      for (const r of rows) expect(r.empresa_id, t).toBe(e.a.empresaId);
    }
    const empresas = await comoApp(e.a.empresaId, (c) => c.query("SELECT id FROM empresa"));
    expect(empresas.rows).toEqual([{ id: e.a.empresaId }]);
    const usuarios = await comoApp(e.a.empresaId, (c) => c.query("SELECT id FROM usuario"));
    const deB = e.b.pessoas.vendedor.usuarioId;
    expect(usuarios.rows.map((r) => r.id)).not.toContain(deB);
    expect(usuarios.rows.map((r) => r.id)).toContain(e.a.pessoas.vendedor.usuarioId);
  });

  it("não grava nem altera linha de outra empresa", async () => {
    await expect(
      comoApp(e.a.empresaId, (c) => c.query("INSERT INTO unidade (empresa_id, nome) VALUES ($1, 'invasora')", [e.b.empresaId])),
    ).rejects.toThrow(/row-level security/);
    const alteradas = await comoApp(e.a.empresaId, (c) =>
      c.query("UPDATE unidade SET nome = 'x' WHERE empresa_id = $1", [e.b.empresaId]),
    );
    expect(alteradas.rowCount).toBe(0);
  });

  it("nunca lê senha, sessões nem tokens", async () => {
    await expect(comoApp(e.a.empresaId, (c) => c.query("SELECT senha_hash FROM usuario"))).rejects.toThrow(/permission denied/);
    await expect(comoApp(e.a.empresaId, (c) => c.query("SELECT * FROM sessao"))).rejects.toThrow(/permission denied/);
    await expect(comoApp(e.a.empresaId, (c) => c.query("SELECT * FROM token_acesso"))).rejects.toThrow(/permission denied/);
  });

  it("não apaga nada: excluir é arquivar", async () => {
    await expect(comoApp(e.a.empresaId, (c) => c.query("DELETE FROM unidade"))).rejects.toThrow(/permission denied/);
    await expect(comoApp(e.a.empresaId, (c) => c.query("DELETE FROM vinculo"))).rejects.toThrow(/permission denied/);
  });

  it("comEmpresa aplica o isolamento", async () => {
    const ids = await comEmpresa(banco, e.a.empresaId, async (tx) => {
      const { rows } = await tx.cliente.query<{ empresa_id: string }>("SELECT DISTINCT empresa_id FROM vinculo");
      return rows.map((r) => r.empresa_id);
    });
    expect(ids).toEqual([e.a.empresaId]);
  });
});

describe("auditoria e eventos são somente inserção", () => {
  for (const tabela of ["auditoria", "evento"]) {
    it(`${tabela}: ninguém altera nem apaga, nem o dono do banco`, async () => {
      await comoSistema(banco, (tx) =>
        tx.cliente.query(
          tabela === "auditoria"
            ? "INSERT INTO auditoria (empresa_id, acao, entidade) VALUES ($1, 'teste', 'teste')"
            : "INSERT INTO evento (empresa_id, tipo, entidade) VALUES ($1, 'teste', 'teste')",
          [e.a.empresaId],
        ),
      );
      await expect(comoApp(e.a.empresaId, (c) => c.query(`UPDATE ${tabela} SET entidade = 'x'`))).rejects.toThrow(
        /permission denied/,
      );
      await expect(comoApp(e.a.empresaId, (c) => c.query(`DELETE FROM ${tabela}`))).rejects.toThrow(/permission denied/);
      await expect(comoSistema(banco, (tx) => tx.cliente.query(`UPDATE ${tabela} SET entidade = 'x'`))).rejects.toThrow(
        /somente inserção/,
      );
      await expect(comoSistema(banco, (tx) => tx.cliente.query(`DELETE FROM ${tabela}`))).rejects.toThrow(/somente inserção/);
      await expect(comoSistema(banco, (tx) => tx.cliente.query(`TRUNCATE ${tabela}`))).rejects.toThrow(/somente inserção/);
    });
  }
});

describe("migrações", () => {
  it("são idempotentes: rodar de novo não aplica nada nem quebra", async () => {
    expect(await migrar(banco.pool)).toEqual([]);
    const sql = await readFile(new URL("../../migracoes/0001_fundacao.sql", import.meta.url), "utf8");
    await comoSistema(banco, (tx) => tx.cliente.query(sql));
    await comoSistema(banco, (tx) => tx.cliente.query(sql));
  });
});
