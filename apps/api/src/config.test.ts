import { describe, expect, it } from "vitest";
import { carregarConfig, ErroConfig } from "./config.js";

const valido = {
  DATABASE_URL: "postgres://x@localhost/db",
  SESSION_SECRET: "a".repeat(64),
  CRM_CHAVE: "b".repeat(64),
};

describe("configuração", () => {
  it("não sobe sem os segredos obrigatórios", () => {
    expect(() => carregarConfig({})).toThrow(ErroConfig);
    try {
      carregarConfig({});
    } catch (e) {
      expect((e as Error).message).toMatch(/DATABASE_URL/);
      expect((e as Error).message).toMatch(/SESSION_SECRET/);
      expect((e as Error).message).toMatch(/CRM_CHAVE/);
    }
  });

  it("recusa chave de criptografia fora do formato", () => {
    expect(() => carregarConfig({ ...valido, CRM_CHAVE: "gere-com-openssl" })).toThrow(/64 caracteres hexadecimais/);
    expect(() => carregarConfig({ ...valido, SESSION_SECRET: "curto" })).toThrow(/32 caracteres/);
  });

  it("em produção exige APP_URL", () => {
    expect(() => carregarConfig({ ...valido, NODE_ENV: "production" })).toThrow(/APP_URL/);
    const c = carregarConfig({ ...valido, NODE_ENV: "production", APP_URL: "https://app.exemplo.com/" });
    expect(c.appUrl).toBe("https://app.exemplo.com");
    expect(c.crmChave).toHaveLength(32);
  });
});

describe("logs", () => {
  it("nunca registram o token dos links", async () => {
    const { ocultarTokens } = await import("./app.js");
    expect(ocultarTokens("/convite?token=abc123&x=1")).toBe("/convite?token=***&x=1");
    expect(ocultarTokens("/api/auth/convite?a=1&token=segredo")).toBe("/api/auth/convite?a=1&token=***");
  });
});
