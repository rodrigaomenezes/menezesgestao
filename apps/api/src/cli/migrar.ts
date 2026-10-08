// npm run db:migrate — aplica as migrações pendentes (o servidor também aplica ao iniciar).
import { carregarArquivoEnv, carregarConfig } from "../config.js";
import { criarBanco } from "../infra/banco.js";
import { migrar } from "../infra/migrar.js";

async function principal() {
  carregarArquivoEnv();
  const banco = criarBanco(carregarConfig().databaseUrl);
  try {
    const aplicadas = await migrar(banco.pool);
    console.info(aplicadas.length ? `Migrações aplicadas: ${aplicadas.join(", ")}` : "Banco já está atualizado.");
  } finally {
    await banco.pool.end();
  }
}

principal().catch((err) => {
  console.error("Não foi possível migrar o banco:", err);
  process.exit(1);
});
