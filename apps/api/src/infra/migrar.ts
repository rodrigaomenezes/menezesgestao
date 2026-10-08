import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const PASTA = fileURLToPath(new URL("../../../../database/migrations/", import.meta.url));
const TRAVA = 7_340_001; // pg_advisory_lock: duas instâncias subindo juntas não migram ao mesmo tempo.

/** Aplica as migrações pendentes, em ordem, cada uma na sua transação. Devolve os nomes aplicados. */
export async function migrar(pool: pg.Pool): Promise<string[]> {
  const cliente = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [TRAVA]);
    await cliente.query(`CREATE TABLE IF NOT EXISTS _migracao (
      nome text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await cliente.query<{ nome: string }>("SELECT nome FROM _migracao");
    const feitas = new Set(rows.map((r) => r.nome));
    const arquivos = (await readdir(PASTA)).filter((a) => a.endsWith(".sql")).sort();

    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = await readFile(PASTA + arquivo, "utf8");
      try {
        await cliente.query("BEGIN");
        await cliente.query(sql);
        await cliente.query("INSERT INTO _migracao (nome) VALUES ($1)", [arquivo]);
        await cliente.query("COMMIT");
      } catch (err) {
        await cliente.query("ROLLBACK");
        throw new Error(`Falha na migração ${arquivo}: ${(err as Error).message}`);
      }
      aplicadas.push(arquivo);
    }
    return aplicadas;
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [TRAVA]).catch(() => undefined);
    cliente.release();
  }
}
