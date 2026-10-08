import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// DATABASE_URL_TESTE pode vir do .env local.
if (existsSync(".env")) process.loadEnvFile(".env");

// O pacote compartilhado é usado direto do código-fonte nos testes (condição "development").
const resolve = { conditions: ["development"] };

export default defineConfig({
  resolve,
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: "test" },
    projects: [
      {
        resolve,
        test: {
          name: "unidade",
          include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
          env: { NODE_ENV: "test" },
        },
      },
      {
        resolve,
        test: {
          name: "integracao",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/apoio/preparar-banco.ts"],
          // Os testes de integração dividem um banco real: um arquivo por vez.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
          env: { NODE_ENV: "test" },
        },
      },
    ],
  },
});
