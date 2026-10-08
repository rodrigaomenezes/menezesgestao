import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as esquema from "./esquema.js";

export type Db = NodePgDatabase<typeof esquema>;

/** Uma transação aberta. `empresaId` vazio = caminho do sistema (sem RLS). */
export interface Tx {
  db: Db;
  cliente: pg.PoolClient;
  empresaId: string | null;
}

export interface Banco {
  pool: pg.Pool;
}

export function criarBanco(databaseUrl: string): Banco {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // Erros de conexões ociosas não podem derrubar o processo em silêncio nem quebrá-lo: registra e segue.
  pool.on("error", (err) => console.error("[banco] erro em conexão ociosa:", err.message));
  return { pool };
}

async function emTransacao<T>(
  banco: Banco,
  empresaId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const cliente = await banco.pool.connect();
  try {
    await cliente.query("BEGIN");
    if (empresaId) {
      await cliente.query("SET LOCAL ROLE mg_app");
      await cliente.query("SELECT set_config('app.empresa_id', $1, true)", [empresaId]);
    }
    const resultado = await fn({ db: drizzle(cliente, { schema: esquema }), cliente, empresaId });
    await cliente.query("COMMIT");
    return resultado;
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    cliente.release();
  }
}

/**
 * Camada única de acesso a dados de uma empresa. Abre uma transação com o papel mg_app e
 * app.empresa_id definido: o RLS do PostgreSQL garante que nada de outra empresa aparece,
 * mesmo que uma consulta esqueça o filtro.
 */
export function comEmpresa<T>(banco: Banco, empresaId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!empresaId) throw new Error("comEmpresa exige empresaId");
  return emTransacao(banco, empresaId, fn);
}

/**
 * Caminho do sistema, sem RLS. Use só onde ainda não existe empresa no contexto:
 * login, sessões, tokens, migrações, jobs e criação de empresa.
 */
export function comoSistema<T>(banco: Banco, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return emTransacao(banco, null, fn);
}
