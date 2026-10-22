import { describe, expect, it } from "vitest";
import { artigosPara } from "./ajuda.js";
import { ficaSomenteLeitura, limitesDoPlano } from "./dto-plataforma.js";

describe("situação da assinatura", () => {
  it("atraso só bloqueia depois de 7 dias; cancelada e suspensa sempre só consulta", () => {
    expect(ficaSomenteLeitura("atrasada", 7)).toBe(false);
    expect(ficaSomenteLeitura("atrasada", 8)).toBe(true);
    expect(ficaSomenteLeitura("teste", 30)).toBe(false);
    expect(ficaSomenteLeitura("cancelada", 0)).toBe(true);
    expect(ficaSomenteLeitura("suspensa", 0)).toBe(true);
  });
  it("sob medida não tem limite", () => {
    expect(limitesDoPlano("sob_medida")).toBeNull();
    expect(limitesDoPlano("essencial")).toMatchObject({ usuarios: 3, canais: 1 });
  });
});

describe("central de ajuda", () => {
  it("artigos da tela aberta vêm primeiro e a busca filtra", () => {
    expect(artigosPara("/vendas")[0]!.id).toBe("vendas");
    expect(artigosPara("/contatos/abc")[0]!.telas).toContain("/contatos");
    expect(artigosPara("/", "nono dígito")).toEqual([]);
    expect(artigosPara("/", "estoque").map((a) => a.id)).toEqual(expect.arrayContaining(["catalogo"]));
  });
});
