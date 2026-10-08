import { criarApp } from "./app.js";
import { criarProvedorAvisos } from "./modulos/avisos/avisos.js";
import { ErroConfig, carregarArquivoEnv, carregarConfig } from "./config.js";
import { criarBanco } from "./infra/banco.js";
import { migrar } from "./infra/migrar.js";
import { iniciarJobs } from "./infra/jobs.js";
import { TempoReal } from "./modulos/eventos/tempo-real.js";

// Falha cedo: sem configuração completa, banco migrado e jobs de pé, o servidor não sobe.
async function iniciar() {
  carregarArquivoEnv();
  let config;
  try {
    config = carregarConfig();
  } catch (err) {
    if (err instanceof ErroConfig) {
      console.error(`[CONFIG] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const banco = criarBanco(config.databaseUrl);
  const aplicadas = await migrar(banco.pool);
  if (aplicadas.length) console.info(`[banco] migrações aplicadas: ${aplicadas.join(", ")}`);

  const avisos = criarProvedorAvisos(config, banco);
  if (config.producao && avisos.id === "demonstracao") {
    console.warn("[avisos] SMTP_URL não definida: e-mails ficam na caixa de demonstração e não chegam a ninguém.");
  }
  const statusAvisos = await avisos.verificar();
  if (statusAvisos !== "ONLINE") console.warn(`[avisos] provedor ${avisos.id} com status ${statusAvisos}: confira SMTP_URL.`);
  const jobs = await iniciarJobs(config, avisos);
  const tempoReal = new TempoReal(banco, config.databaseUrl);
  await tempoReal.iniciar();

  const { app } = await criarApp({ config, banco, jobs, avisos, tempoReal });
  await app.listen({ port: config.porta, host: "0.0.0.0" });

  const encerrar = async (sinal: string) => {
    app.log.info(`recebido ${sinal}, encerrando`);
    await tempoReal.parar();
    await app.close();
    await jobs.parar();
    await banco.pool.end();
    process.exit(0);
  };
  process.once("SIGTERM", () => void encerrar("SIGTERM"));
  process.once("SIGINT", () => void encerrar("SIGINT"));
}

iniciar().catch((err) => {
  console.error("[inicio] o servidor não conseguiu subir:", err);
  process.exit(1);
});
