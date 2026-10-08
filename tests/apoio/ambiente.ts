import { randomBytes } from "node:crypto";
import { carregarConfig, type Config } from "../../apps/api/src/config.js";

/**
 * Banco dos testes: só DATABASE_URL_TESTE, e o nome precisa conter "test".
 * Os testes apagam o banco inteiro a cada execução: nunca podem apontar para o de desenvolvimento.
 */
export function urlBancoTeste(): string {
  const url = process.env.DATABASE_URL_TESTE;
  if (!url) throw new Error("Defina DATABASE_URL_TESTE (um banco só para testes; ele é apagado a cada execução).");
  const nome = new URL(url).pathname.slice(1);
  if (!/test/i.test(nome)) {
    throw new Error(`DATABASE_URL_TESTE aponta para o banco "${nome}". Use um banco com "teste" no nome: ele é apagado a cada execução.`);
  }
  return url;
}

// Segredos gerados a cada execução: nenhum valor fixo no código.
const SEGREDOS = { sessao: randomBytes(32).toString("hex"), chave: randomBytes(32).toString("hex") };

export function configTeste(extra: Record<string, string> = {}): Config {
  return carregarConfig({
    NODE_ENV: "test",
    DATABASE_URL: urlBancoTeste(),
    SESSION_SECRET: SEGREDOS.sessao,
    CRM_CHAVE: SEGREDOS.chave,
    LIMITE_REQ_MINUTO: "100000",
    LIMITE_LOGIN_MINUTO: "100000",
    ...extra,
  });
}
