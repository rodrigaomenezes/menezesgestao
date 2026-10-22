// Regras puras do motor BRE: estado do cliente (D-01), transições (D-02), ação do Break (D-03), faixas do SQ-BRE
// e o BPI com os pesos do livro (AT-025: fórmulas batem com o cálculo à mão).
import { describe, expect, it } from "vitest";
import { CONFIG_BRE_PADRAO, SaidaIaBre, mascararDadosPessoais, acaoPadraoBreak, calcularBpi, contraMeta, estadoCliente, faixaBpi, faixaSq, somaSq, transicaoPermitida } from "./dto-bre.js";

describe("estado do cliente (D-01)", () => {
  it("segue os limites padrão nas bordas", () => {
    expect(estadoCliente(0, null)).toBeNull();
    expect(estadoCliente(1, 45)).toBe("RECENT");
    expect(estadoCliente(1, 46)).toBe("ABOUT_TO_SLEEP");
    expect(estadoCliente(2, 60)).toBe("ACTIVE");
    expect(estadoCliente(2, 61)).toBe("ABOUT_TO_SLEEP");
    expect(estadoCliente(5, 120)).toBe("ABOUT_TO_SLEEP");
    expect(estadoCliente(5, 121)).toBe("INACTIVE");
  });
  it("respeita os limites da empresa", () => {
    expect(estadoCliente(1, 20, { ...CONFIG_BRE_PADRAO, recenteAte: 15 })).toBe("ABOUT_TO_SLEEP");
  });
});

describe("transições do pipeline (D-02)", () => {
  it("permite as da doutrina e ficar parado; recusa pular etapas", () => {
    expect(transicaoPermitida("LEAD_IDENTIFIED", "DIAGNOSIS")).toBe(true);
    expect(transicaoPermitida("LEAD_IDENTIFIED", "SALE")).toBe(false);
    expect(transicaoPermitida("NEGOTIATION", "PROPOSAL")).toBe(true);
    expect(transicaoPermitida("SALE", "SALE")).toBe(true);
    expect(transicaoPermitida("SALE", "DIAGNOSIS")).toBe(false);
  });
});

describe("Break (D-03)", () => {
  it("cada categoria tem a ação padrão do livro", () => {
    expect(acaoPadraoBreak("A_TIME").reentrada).toEqual({ tipo: "TIME", dias: 30, condicao: null });
    expect(acaoPadraoBreak("C_FINANCIAL").reentrada).toEqual({ tipo: "EVENT", dias: null, condicao: "Próxima campanha" });
    expect(acaoPadraoBreak("B_PRODUCT").reentrada).toBeNull();
  });
});

describe("SQ-BRE (D-05, D-06)", () => {
  it("soma os 5 pilares e classifica pelas faixas", () => {
    expect(somaSq({ H: 20, D: 20, I: 20, V: 20, P: 15 })).toBe(95);
    expect(faixaSq(95)).toBe("Excelência");
    expect(faixaSq(94)).toBe("Muito bom");
    expect(faixaSq(70)).toBe("Bom");
    expect(faixaSq(50)).toBe("Regular");
    expect(faixaSq(49)).toBe("Requer reciclagem");
  });
});

describe("BPI (AT-025)", () => {
  it("usa os pesos 30/20/20/20/10", () => {
    // 0,3×100 + 0,2×50 + 0,2×80 + 0,2×70 + 0,1×40 = 30 + 10 + 16 + 14 + 4 = 74
    expect(calcularBpi({ receita: 100, pipeline: 50, inteligencia: 80, qualidade: 70, relacionamento: 40 })).toBe(74);
  });
  it("pilar sem dados sai e os pesos dos outros são redistribuídos", () => {
    // sem receita: (20×50 + 20×80 + 20×70 + 10×40) / 70 = 4400 / 70 = 62,86 → 62,9
    expect(calcularBpi({ receita: null, pipeline: 50, inteligencia: 80, qualidade: 70, relacionamento: 40 })).toBe(62.9);
    expect(calcularBpi({ receita: null, pipeline: null, inteligencia: null, qualidade: null, relacionamento: null })).toBeNull();
  });
  it("meta: acima de 100% não passa de 100", () => {
    expect(contraMeta(21_000, 42_000)).toBe(50);
    expect(contraMeta(84_000, 42_000)).toBe(100);
  });
  it("faixas do livro", () => {
    expect(faixaBpi(95)).toBe("Elite");
    expect(faixaBpi(90)).toBe("Excelente");
    expect(faixaBpi(80)).toBe("Muito bom");
    expect(faixaBpi(70)).toBe("Adequado");
    expect(faixaBpi(69.9)).toBe("Plano de desenvolvimento");
  });
});

describe("contrato da IA (AT-018)", () => {
  const valida = {
    resumo: "ok",
    resultado: "ADVANCED",
    temperatura: "HOT",
    estadoEmocional: null,
    sins: [],
    break: null,
    proximaAcao: "CALL_BACK",
    retornoEmDias: 3,
    sugereOferta: false,
    sugereDesconto: false,
    escalonamento: null,
    sqBre: { H: 10, D: 10, I: 10, V: 10, P: 20 },
    incertezas: [],
  };
  it("aceita a saída dentro das listas e recusa código inventado ou nota fora da escala", () => {
    expect(SaidaIaBre.safeParse(valida).success).toBe(true);
    expect(SaidaIaBre.safeParse({ ...valida, temperatura: "SCORCHING" }).success).toBe(false);
    expect(SaidaIaBre.safeParse({ ...valida, break: { categoria: "H_WEATHER", comentario: "x" } }).success).toBe(false);
    expect(SaidaIaBre.safeParse({ ...valida, sqBre: { ...valida.sqBre, P: 25 } }).success).toBe(false);
  });
});

describe("mascaramento para a IA (DEC-009)", () => {
  it("troca dados pessoais por marcadores e deixa o resto da conversa", () => {
    expect(mascararDadosPessoais("Meu e-mail é ana.souza+promo@gmail.com e o CPF 123.456.789-09")).toBe("Meu e-mail é [e-mail] e o CPF [CPF]");
    expect(mascararDadosPessoais("Liga no (11) 98765-4321 ou +55 11 98765 4321")).toBe("Liga no [telefone] ou [telefone]");
    expect(mascararDadosPessoais("CEP 01310-100, empresa 12.345.678/0001-95")).toBe("CEP [CEP], empresa [CNPJ]");
    expect(mascararDadosPessoais("Quero 2 frascos de 100 ml até dia 15")).toBe("Quero 2 frascos de 100 ml até dia 15");
  });
  it("também esconde o nome do cliente e endereços", () => {
    expect(mascararDadosPessoais("Oi, aqui é a Ana Lúcia. Entrega na Rua das Flores, 123, por favor", ["Ana Lúcia Souza"])).toBe(
      "Oi, aqui é a [nome] [nome]. Entrega na [endereço], por favor",
    );
    expect(mascararDadosPessoais("Mariana gostou", ["Ana"])).toBe("Mariana gostou");
    expect(mascararDadosPessoais("Fica na Av. Paulista, nº 1000 — perto do metrô")).toBe("Fica na [endereço] — perto do metrô");
  });
  it("vem desligado no padrão (primeiros testes)", () => expect(CONFIG_BRE_PADRAO.mascararDadosIa).toBe(false));
});

describe("mascaramento: e-mail com o nome do cliente", () => {
  it("não deixa o domínio vazar quando o e-mail começa com o nome", () => {
    expect(mascararDadosPessoais("Meu e-mail é ana@empresa.com.br", ["Ana Souza"])).toBe("Meu e-mail é [e-mail]");
  });
});
