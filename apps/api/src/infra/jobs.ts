// Fila de jobs (pg-boss): rotinas e envios com trava e nova tentativa. Nada de setInterval no servidor.
import PgBoss from "pg-boss";
import type { Tx } from "./banco.js";
import type { Config } from "../config.js";
import type { ProvedorAvisos, MensagemEmail } from "../modulos/avisos/avisos.js";
import { cifrar, decifrar } from "./seguranca/cripto.js";
import { erroSeguro, registrarLog } from "./log.js";

export const FILAS = {
  email: "aviso.email",
  limparSessoes: "manutencao.sessoes",
} as const;

/** Jobs que esgotaram as tentativas vão para cá (dead-letter), para análise e reenvio manual. */
export const FILA_FALHAS = "falhas";

export interface Jobs {
  /** Enfileira um e-mail. Com `tx`, o job só existe se a transação confirmar. */
  enviarEmail(tx: Tx | null, mensagem: MensagemEmail): Promise<void>;
  /** Enfileira um job de módulo (dados sem segredo). Com `tx`, só existe se a transação confirmar. */
  enfileirar(tx: Tx | null, fila: string, dados: object, opcoes?: { aposSegundos?: number; chaveUnica?: string }): Promise<void>;
  /** Registra o trabalhador de uma fila de módulo (com tentativas limitadas e dead-letter). */
  trabalhar<T extends object>(fila: string, fn: (dados: T) => Promise<void>): Promise<void>;
  /** Agenda uma fila (já registrada com trabalhar) num horário fixo (cron, fuso de São Paulo). */
  agendar(fila: string, cron: string): Promise<void>;
  parar(): Promise<void>;
}

export async function iniciarJobs(config: Config, avisos: ProvedorAvisos): Promise<Jobs> {
  const boss = new PgBoss({ connectionString: config.databaseUrl, max: 3 });
  boss.on("error", (err) => console.error("[jobs] erro:", err.message));
  await boss.start();

  // O código de empresa (papel mg_app) também enfileira, dentro da própria transação.
  await boss.getDb().executeSql(
    `GRANT USAGE ON SCHEMA pgboss TO mg_app;
     GRANT SELECT ON pgboss.queue TO mg_app;
     GRANT INSERT, SELECT (id) ON pgboss.job TO mg_app;`,
    [],
  );

  // Tentativas limitadas com espera crescente; depois disso, o job vai para a fila de falhas.
  await boss.createQueue(FILA_FALHAS, { name: FILA_FALHAS });
  for (const fila of Object.values(FILAS)) {
    const opcoes = { name: fila, retryLimit: 5, retryDelay: 30, retryBackoff: true, deadLetter: FILA_FALHAS };
    await boss.createQueue(fila, opcoes);
    await boss.updateQueue(fila, opcoes); // fila criada antes desta versão ganha a dead-letter

  }

  // O conteúdo do e-mail pode ter link de acesso: vai cifrado para a tabela de jobs.
  await boss.work<{ cifrado: string }>(FILAS.email, { pollingIntervalSeconds: config.teste ? 0.5 : 2 }, async (lote) => {
    for (const job of lote) {
      try {
        await avisos.enviarEmail(JSON.parse(decifrar(config.crmChave, job.data.cifrado)) as MensagemEmail);
      } catch (err) {
        // Nunca registra o conteúdo (tem link de acesso): só a fila, o id do job e o motivo.
        registrarLog({ level: "error", event: "job.falhou", fila: FILAS.email, jobId: job.id, erro: erroSeguro(err) });
        throw err;
      }
    }
  });

  await boss.work(FILAS.limparSessoes, async () => {
    await boss.getDb().executeSql(
      `DELETE FROM sessao WHERE expira_em < now() - interval '30 days' OR encerrada_em < now() - interval '30 days';
       DELETE FROM token_acesso WHERE expira_em < now() - interval '30 days';`,
      [],
    );
  });
  await boss.schedule(FILAS.limparSessoes, "17 3 * * *", {}, { tz: "America/Sao_Paulo" });

  return {
    async enviarEmail(tx, mensagem) {
      const dados = { cifrado: cifrar(config.crmChave, JSON.stringify(mensagem)) };
      if (tx) {
        await boss.send(FILAS.email, dados, {
          db: { executeSql: (texto, valores) => tx.cliente.query(texto, valores) },
        });
      } else {
        await boss.send(FILAS.email, dados);
      }
    },
    async enfileirar(tx, fila, dados, opcoes = {}) {
      await boss.send(fila, dados, {
        ...(opcoes.aposSegundos ? { startAfter: opcoes.aposSegundos } : {}),
        // Mesma chave na fila = um job só (ex.: um follow-up por conversa).
        ...(opcoes.chaveUnica ? { singletonKey: opcoes.chaveUnica } : {}),
        ...(tx ? { db: { executeSql: (texto: string, valores: unknown[]) => tx.cliente.query(texto, valores) } } : {}),
      });
    },
    async trabalhar(fila, fn) {
      const opcoes = { name: fila, retryLimit: 3, retryDelay: 30, retryBackoff: true, deadLetter: FILA_FALHAS };
      await boss.createQueue(fila, opcoes);
      await boss.updateQueue(fila, opcoes);
      await boss.work<object>(fila, { pollingIntervalSeconds: config.teste ? 0.5 : 2 }, async (lote) => {
        for (const job of lote) {
          try {
            await fn(job.data as never);
          } catch (err) {
            registrarLog({ level: "error", event: "job.falhou", fila, jobId: job.id, erro: erroSeguro(err) });
            throw err;
          }
        }
      });
    },
    async agendar(fila, cron) {
      await boss.schedule(fila, cron, {}, { tz: "America/Sao_Paulo" });
    },
    async parar() {
      await boss.stop({ graceful: true, timeout: 5000, wait: true });
    },
  };
}
