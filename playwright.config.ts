import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// DATABASE_URL_TESTE pode vir do .env local.
if (existsSync(".env")) process.loadEnvFile(".env");

const PORTA = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  // Um banco para todos os testes: um por vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORTA}`, locale: "pt-BR", timezoneId: "America/Sao_Paulo", trace: "retain-on-failure" },
  // Larguras validadas (Prompt Mestre, seção 61): 360, 390, 768, 1024 e 1440 px.
  projects: [
    { name: "celular-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 }, browserName: "chromium" } },
    { name: "celular-390", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, browserName: "chromium" } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "notebook-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "computador-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "node --conditions=development --import tsx tests/e2e/servidor.ts",
    url: `http://localhost:${PORTA}/api/health`,
    env: { PORT: String(PORTA) },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
  },
});
