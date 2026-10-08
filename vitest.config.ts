import { defineConfig } from "vitest/config";

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
