// Prepara o banco de testes do zero a cada execução: apaga os schemas e roda as migrações.
import pg from "pg";
import { migrar } from "../db/migrar.js";
import { urlBancoTeste } from "./ambiente.js";

export default async function preparar() {
  const pool = new pg.Pool({ connectionString: urlBancoTeste() });
  try {
    await pool.query("DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    await migrar(pool);
  } finally {
    await pool.end();
  }
}
