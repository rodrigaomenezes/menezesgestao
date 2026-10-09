import { describe, expect, it } from "vitest";
import { base32, codigoTotp, conferirTotp, deBase32, novosCodigosRecuperacao, PASSO_SEGUNDOS, uriTotp } from "./totp.js";

// Vetor da RFC 6238 (SHA-1): chave ASCII "12345678901234567890".
const SEGREDO = base32(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("bate com os vetores da RFC 6238", () => {
    expect(codigoTotp(SEGREDO, Math.floor(59 / PASSO_SEGUNDOS), 8)).toBe("94287082");
    expect(codigoTotp(SEGREDO, Math.floor(1111111109 / PASSO_SEGUNDOS), 8)).toBe("07081804");
    expect(codigoTotp(SEGREDO, Math.floor(20000000000 / PASSO_SEGUNDOS), 8)).toBe("65353130");
  });

  it("base32 vai e volta", () => {
    expect(deBase32(SEGREDO).toString()).toBe("12345678901234567890");
  });

  it("aceita um passo de folga e recusa código repetido", () => {
    const agora = 1_700_000_000_000;
    const passo = Math.floor(agora / 1000 / PASSO_SEGUNDOS);
    const anterior = codigoTotp(SEGREDO, passo - 1);
    expect(conferirTotp(SEGREDO, anterior, null, agora)).toBe(passo - 1);
    expect(conferirTotp(SEGREDO, anterior, passo - 1, agora)).toBeNull();
    expect(conferirTotp(SEGREDO, codigoTotp(SEGREDO, passo - 2), null, agora)).toBeNull();
    expect(conferirTotp(SEGREDO, "12345a", null, agora)).toBeNull();
  });

  it("monta o endereço do app e códigos de recuperação únicos", () => {
    expect(uriTotp("Produto X", "a@b.com", "ABC")).toBe(
      "otpauth://totp/Produto%20X%3Aa%40b.com?secret=ABC&issuer=Produto%20X&algorithm=SHA1&digits=6&period=30",
    );
    const codigos = novosCodigosRecuperacao(10);
    expect(new Set(codigos).size).toBe(10);
    for (const c of codigos) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
