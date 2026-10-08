import { randomBytes } from "node:crypto";
import { carregarConfig, type Config } from "../config.js";

/** Banco dos testes: DATABASE_URL_TESTE, ou DATABASE_URL (no CI é um banco descartável). */
export function urlBancoTeste(): string {
  const url = process.env.DATABASE_URL_TESTE ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Defina DATABASE_URL_TESTE (ou DATABASE_URL) para rodar os testes.");
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
