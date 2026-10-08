import { describe, expect, it } from "vitest";
import {
  ACOES,
  IDS_MODULOS,
  PLANOS,
  limparPermissoes,
  moduloAtivo,
  permissoesDoPerfilBase,
} from "./catalogo.js";
import { contraste, corDoTextoSobre, lerMarca } from "./marca.js";

describe("matriz padrão de perfis", () => {
  it("dono administra todos os módulos na empresa toda", () => {
    const p = permissoesDoPerfilBase("dono");
    for (const m of IDS_MODULOS) for (const a of ACOES) expect(p[m]?.[a]).toBe("empresa");
  });

  it("vendedor só o próprio no CRM e sem acesso a usuários", () => {
    const p = permissoesDoPerfilBase("vendedor");
    expect(p.crm).toEqual({ ver: "proprio", criar: "proprio", editar: "proprio", arquivar: "proprio" });
    expect(p.usuarios).toBeUndefined();
    expect(p.scripts).toEqual({ ver: "empresa" });
  });

  it("gestor edita a equipe e só vê usuários da equipe", () => {
    const p = permissoesDoPerfilBase("gestor");
    expect(p.crm?.editar).toBe("equipe");
    expect(p.usuarios).toEqual({ ver: "equipe" });
    expect(p.configuracoes).toBeUndefined();
  });

  it("financeiro edita vendas na empresa toda e só vê o CRM", () => {
    const p = permissoesDoPerfilBase("financeiro");
    expect(p.vendas?.editar).toBe("empresa");
    expect(p.crm).toEqual({ ver: "empresa" });
    expect(p.auditoria).toEqual({ ver: "empresa" });
  });

  it("limpa permissões desconhecidas", () => {
    expect(limparPermissoes({ crm: { ver: "empresa", voar: "empresa" }, inexistente: { ver: "empresa" }, fila: { ver: "tudo" } }))
      .toEqual({ crm: { ver: "empresa" } });
  });
});

describe("módulos por plano", () => {
  it("núcleo sempre ativo; demais conforme o plano", () => {
    expect(moduloAtivo("usuarios", [])).toBe(true);
    expect(moduloAtivo("telefonia", PLANOS.comercial.modulos)).toBe(false);
    expect(moduloAtivo("telefonia", PLANOS.completo.modulos)).toBe(true);
  });
});

describe("marca", () => {
  it("escolhe a cor de texto com mais contraste", () => {
    expect(corDoTextoSobre("#1f5fbf")).toBe("#ffffff");
    expect(corDoTextoSobre("#f5e663")).toBe("#111111");
    expect(contraste("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });

  it("ignora cores inválidas", () => {
    expect(lerMarca({ corPrimaria: "red", corDestaque: "#123456" }).corPrimaria).toMatch(/^#/);
  });
});
