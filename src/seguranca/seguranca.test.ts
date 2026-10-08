import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cifrar, decifrar, hashToken, novoToken } from "./cripto.js";
import { conferirSenha, gerarHashSenha, minutosDeBloqueio } from "./senha.js";

describe("criptografia AES-256-GCM", () => {
  const chave = randomBytes(32);

  it("cifra e decifra", () => {
    const valor = cifrar(chave, "credencial secreta");
    expect(valor).not.toContain("credencial");
    expect(decifrar(chave, valor)).toBe("credencial secreta");
    expect(cifrar(chave, "x")).not.toBe(cifrar(chave, "x"));
  });

  it("detecta adulteração e chave errada", () => {
    const valor = cifrar(chave, "abc");
    const bruto = Buffer.from(valor.slice(3), "base64");
    bruto[bruto.length - 1] ^= 1;
    expect(() => decifrar(chave, `v1:${bruto.toString("base64")}`)).toThrow();
    expect(() => decifrar(randomBytes(32), valor)).toThrow();
  });

  it("guarda só o HMAC do token", () => {
    const t = novoToken();
    expect(hashToken("segredo", t)).toHaveLength(64);
    expect(hashToken("segredo", t)).not.toBe(hashToken("outro", t));
  });
});

describe("senhas", () => {
  it("usa Argon2id e confere", async () => {
    const hash = await gerarHashSenha("uma senha longa");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await conferirSenha(hash, "uma senha longa")).toBe(true);
    expect(await conferirSenha(hash, "outra senha")).toBe(false);
    expect(await conferirSenha("lixo", "x")).toBe(false);
  });

  it("bloqueio progressivo a partir da 5ª falha, até 60 minutos", () => {
    expect(minutosDeBloqueio(4)).toBe(0);
    expect(minutosDeBloqueio(5)).toBe(1);
    expect(minutosDeBloqueio(7)).toBe(4);
    expect(minutosDeBloqueio(30)).toBe(60);
  });
});
