import { describe, expect, it } from "vitest";
import { preencherVariaveis } from "./dto-conversas.js";

describe("preencherVariaveis", () => {
  it("troca as variáveis conhecidas", () => {
    expect(preencherVariaveis("Oi {nome}, aqui é {vendedor} da {empresa}.", { nome: "Ana", vendedor: "Bia", empresa: "Escola" })).toBe(
      "Oi Ana, aqui é Bia da Escola.",
    );
  });
  it("variável sem valor some sem deixar espaço duplo; desconhecida fica como está", () => {
    expect(preencherVariaveis("Oi {nome} tudo bem? {outra}", {})).toBe("Oi tudo bem? {outra}");
  });
});
