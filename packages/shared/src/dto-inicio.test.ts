import { describe, expect, it } from "vitest";
import { IDS_MODULOS, permissoesDoPerfilBase } from "./catalogo.js";
import { InicioEntrada, blocoPermitido, inicioPadrao } from "./dto-inicio.js";

const todos = IDS_MODULOS as readonly string[];

describe("Início padrão por perfil", () => {
  it("cada perfil-base começa com uma ordem pensada para ele, só com blocos permitidos", () => {
    const dono = inicioPadrao(permissoesDoPerfilBase("dono"), todos);
    const gestor = inicioPadrao(permissoesDoPerfilBase("gestor"), todos);
    const vendedor = inicioPadrao(permissoesDoPerfilBase("vendedor"), todos);
    const operacao = inicioPadrao(permissoesDoPerfilBase("operacao"), todos);
    const financeiro = inicioPadrao(permissoesDoPerfilBase("financeiro"), todos);
    expect(dono.slice(0, 2)).toEqual(["atalhos", "ranking"]);
    expect(gestor).toContain("ranking");
    expect(vendedor.slice(0, 3)).toEqual(["atalhos", "conversas", "metas"]);
    expect(operacao).not.toContain("conversas");
    expect(financeiro.slice(0, 2)).toEqual(["atalhos", "comissao"]);
    for (const [perfil, blocos] of Object.entries({ dono, gestor, vendedor, operacao, financeiro })) {
      for (const b of blocos) expect(blocoPermitido(b, permissoesDoPerfilBase(perfil as "dono"), todos), `${perfil}.${b}`).toBe(true);
    }
  });

  it("módulo fora do plano tira o bloco, mesmo com permissão", () => {
    const semVendas = todos.filter((m) => m !== "vendas");
    expect(blocoPermitido("comissao", permissoesDoPerfilBase("dono"), semVendas)).toBe(false);
    expect(inicioPadrao(permissoesDoPerfilBase("financeiro"), semVendas)).not.toContain("comissao");
  });

  it("a entrada recusa bloco desconhecido e repetido", () => {
    expect(InicioEntrada.safeParse({ blocos: ["atalhos", "metas"] }).success).toBe(true);
    expect(InicioEntrada.safeParse({ blocos: ["atalhos", "atalhos"] }).success).toBe(false);
    expect(InicioEntrada.safeParse({ blocos: ["foguete"] }).success).toBe(false);
  });
});
