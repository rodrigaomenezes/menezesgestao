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
    expect(ocultarTokens("/api/webhooks/whatsapp/c1?hub.mode=subscribe&hub.verify_token=segredo&hub.challenge=9")).toBe(
      "/api/webhooks/whatsapp/c1?hub.mode=subscribe&hub.verify_token=***&hub.challenge=9",
    );
    expect(ocultarTokens("/api/gravacoes/segredo123")).toBe("/api/gravacoes/***");
    expect(ocultarTokens("/p/segredo?x=1")).toBe("/p/***?x=1");
    expect(ocultarTokens("/api/crm/p/1")).toBe("/api/crm/p/1");
    expect(ocultarTokens("/api/publico/pesquisas/segredo/respostas")).toBe("/api/publico/pesquisas/***/respostas");
    // CPF e CNPJ na busca (dado pessoal) também não vão para o log; telefone e outros números continuam.
    expect(ocultarTokens("/api/contatos?busca=529.982.247-25")).toBe("/api/contatos?busca=***");
    expect(ocultarTokens("/api/contatos?busca=52998224725&limite=30")).toBe("/api/contatos?busca=***&limite=30");
    expect(ocultarTokens("/api/contatos?busca=11.222.333%2F0001-81")).toBe("/api/contatos?busca=***");
    expect(ocultarTokens("/api/contatos?limite=30&cursor=abc")).toBe("/api/contatos?limite=30&cursor=abc");
  });
});
