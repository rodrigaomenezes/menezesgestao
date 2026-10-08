import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// DATABASE_URL_TESTE pode vir do .env local.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/teste/preparar-banco.ts"],
    // Os testes de integração dividem um banco real: um arquivo por vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: { NODE_ENV: "test" },
  },
});
