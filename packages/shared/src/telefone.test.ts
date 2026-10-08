import { describe, expect, it } from "vitest";
import { formatarTelefone, normalizarTelefone, variantesTelefone } from "./telefone.js";

describe("normalizarTelefone", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["11987654321", "+5511987654321"],
    ["+55 11 98765-4321", "+5511987654321"],
    ["5511987654321", "+5511987654321"],
    ["0055 11 98765 4321", "+5511987654321"],
    ["011 98765-4321", "+5511987654321"],
    ["0 15 11 98765-4321", "+5511987654321"],
    // Celular antigo sem o nono dígito ganha o 9.
    ["(11) 8765-4321", "+5511987654321"],
    ["+55 11 8765-4321", "+5511987654321"],
    ["551187654321", "+5511987654321"],
    // Fixo continua com 8 dígitos.
    ["(11) 3456-7890", "+551134567890"],
    ["+55 21 2345-6789", "+552123456789"],
    // Outros países.
    ["+1 (415) 555-2671", "+14155552671"],
    ["+351 912 345 678", "+351912345678"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarTelefone(entrada)).toBe(esperado);
  });

  it.each(["", "abc", "123", "(11) 1234-5678", "(00) 98765-4321", "987654321", "11 88765-4321", "+0 123"])("recusa %j", (entrada) => {
    expect(normalizarTelefone(entrada)).toBeNull();
  });

  it("a mesma pessoa digitada de jeitos diferentes vira a mesma chave", () => {
    const formas = ["(11) 98765-4321", "11 8765-4321", "+55 (11) 9 8765 4321", "011987654321"];
    expect(new Set(formas.map((f) => normalizarTelefone(f))).size).toBe(1);
  });
});

describe("variantes e exibição", () => {
  it("celular brasileiro tem a forma com e sem o nono dígito", () => {
    expect(variantesTelefone("+5511987654321")).toEqual(["+5511987654321", "+551187654321"]);
    expect(variantesTelefone("+551134567890")).toEqual(["+551134567890"]);
  });

  it("formata para exibição", () => {
    expect(formatarTelefone("+5511987654321")).toBe("(11) 98765-4321");
    expect(formatarTelefone("+551134567890")).toBe("(11) 3456-7890");
    expect(formatarTelefone("+14155552671")).toBe("+14155552671");
  });
});
