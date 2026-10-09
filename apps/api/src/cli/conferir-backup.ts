// npm run backup:conferir — confere uma cópia restaurada do banco (veja docs/BACKUP.md).
//   DATABASE_URL=<cópia restaurada> npm run backup:conferir
//   DATABASE_URL=<cópia> REFERENCIA_URL=<banco original> npm run backup:conferir   (compara as contagens)
// Sai com código 1 se algo não conferir. Mostra só números e nomes de tabelas — nenhum dado pessoal.
import pg from "pg";
import { carregarArquivoEnv } from "../config.js";
import { conferirRestauracao, retratoDoBanco } from "../infra/backup.js";

async function principal() {
  carregarArquivoEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Defina DATABASE_URL apontando para a cópia restaurada.");
  const copia = new pg.Pool({ connectionString: url, max: 2 });
  const original = process.env.REFERENCIA_URL ? new pg.Pool({ connectionString: process.env.REFERENCIA_URL, max: 2 }) : null;
  try {
    const restaurado = await retratoDoBanco(copia);
    const referencia = original ? await retratoDoBanco(original) : undefined;
    const problemas = await conferirRestauracao(restaurado, referencia);
    const total = Object.values(restaurado.linhas).reduce((a, b) => a + b, 0);
    console.info(`Cópia: ${restaurado.migracoes.length} migrações, ${restaurado.tabelasComRls} tabelas com RLS, ${total} linhas, último evento ${restaurado.ultimoEvento ?? "—"}.`);
    if (problemas.length) {
      console.error(`A restauração NÃO confere:\n- ${problemas.join("\n- ")}`);
      process.exitCode = 1;
    } else console.info("Restauração conferida: pode usar esta cópia.");
  } finally {
    await copia.end();
    await original?.end();
  }
}

principal().catch((err) => {
  console.error("Não foi possível conferir:", (err as Error).message);
  process.exit(1);
});
