import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// DATABASE_URL_TESTE pode vir do .env local.
if (existsSync(".env")) process.loadEnvFile(".env");

const PORTA = 3100;

export default defineConfig({
  testDir: "e2e",
  // Um banco para todos os testes: um por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORTA}`, locale: "pt-BR", timezoneId: "America/Sao_Paulo", trace: "retain-on-failure" },
  projects: [
    {
      name: "celular",
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 }, browserName: "chromium" },
    },
    { name: "computador", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npx tsx e2e/servidor.ts",
    url: `http://localhost:${PORTA}/api/health`,
    env: { PORT: String(PORTA) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
  },
});
