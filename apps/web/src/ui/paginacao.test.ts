import { describe, expect, it } from "vitest";
import { enderecoDaPagina } from "./paginacao";

describe("endereço da página da lista", () => {
  it("acrescenta o cursor sem perder os filtros", () => {
    expect(enderecoDaPagina("/ligacoes?inicio=2026-10-01&fim=2026-10-07&limite=30", { cursor: "abc=" })).toBe("/ligacoes?inicio=2026-10-01&fim=2026-10-07&limite=30&cursor=abc%3D");
    expect(enderecoDaPagina("/contatos", { cursor: "x" })).toBe("/contatos?cursor=x");
    expect(enderecoDaPagina("/contatos")).toBe("/contatos");
  });

  it("ao recarregar, pede tudo o que já estava na tela, até 100", () => {
    expect(enderecoDaPagina("/ligacoes?limite=30", { quantos: 90 })).toBe("/ligacoes?limite=90");
    expect(enderecoDaPagina("/ligacoes?limite=30", { quantos: 10 })).toBe("/ligacoes?limite=30");
    expect(enderecoDaPagina("/ligacoes?limite=30", { quantos: 250 })).toBe("/ligacoes?limite=100");
    expect(enderecoDaPagina("/contatos?busca=ana", { quantos: 70 })).toBe("/contatos?busca=ana&limite=70");
  });
});
