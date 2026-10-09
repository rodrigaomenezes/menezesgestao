// Critério de pronto da fase 5: a comissão do mês confere com o cálculo feito à mão.
import { describe, expect, it } from "vitest";
import { aplicarPercentual, calcularComissoes, percentualDaFaixa, type RegraParaComissao } from "./calculo-comissao.js";

const geral: RegraParaComissao = { id: "g", nome: "Geral 5%", ofertaId: null, tipo: "percentual", percentual: 5, faixas: null };
const curso: RegraParaComissao = {
  id: "c",
  nome: "Curso por faixa",
  ofertaId: "curso",
  tipo: "faixa",
  percentual: null,
  faixas: [
    { ateCentavos: 500_000, percentual: 3 },
    { ateCentavos: 1_000_000, percentual: 6 },
    { ateCentavos: null, percentual: 10 },
  ],
};

describe("cálculo da comissão", () => {
  it("confere com a conta feita à mão", () => {
    const vendas = [
      // Ana: dois cursos (R$ 3.000 + R$ 4.000 = R$ 7.000 → faixa de 6% = R$ 420,00) e um livro (R$ 99,90 × 5% = R$ 4,995 → R$ 5,00).
      { vendedorId: "ana", ofertaId: "curso", valorCentavos: 300_000 },
      { vendedorId: "ana", ofertaId: "curso", valorCentavos: 400_000 },
      { vendedorId: "ana", ofertaId: "livro", valorCentavos: 9_990 },
      // Bia: um curso de R$ 12.000,00 → acima de R$ 10.000 → 10% = R$ 1.200,00.
      { vendedorId: "bia", ofertaId: "curso", valorCentavos: 1_200_000 },
    ];
    const { linhas, semRegra } = calcularComissoes(vendas, [geral, curso]);
    expect(semRegra).toBe(0);
    const linha = (v: string, r: string) => linhas.find((l) => l.vendedorId === v && l.regraId === r);
    expect(linha("ana", "c")).toMatchObject({ vendas: 2, baseCentavos: 700_000, percentual: 6, valorCentavos: 42_000 });
    expect(linha("ana", "g")).toMatchObject({ vendas: 1, baseCentavos: 9_990, percentual: 5, valorCentavos: 500 });
    expect(linha("bia", "c")).toMatchObject({ baseCentavos: 1_200_000, percentual: 10, valorCentavos: 120_000 });
    expect(linhas.reduce((t, l) => t + l.valorCentavos, 0)).toBe(42_000 + 500 + 120_000);
  });

  it("sem regra geral, a venda de oferta sem regra fica de fora (e é contada)", () => {
    const { linhas, semRegra } = calcularComissoes([{ vendedorId: "ana", ofertaId: "livro", valorCentavos: 1000 }], [curso]);
    expect(linhas).toEqual([]);
    expect(semRegra).toBe(1);
  });

  it("faixa: o teto é inclusivo e a última faixa não tem teto", () => {
    expect(percentualDaFaixa(curso.faixas!, 500_000)).toBe(3);
    expect(percentualDaFaixa(curso.faixas!, 500_001)).toBe(6);
    expect(percentualDaFaixa(curso.faixas!, 99_000_000)).toBe(10);
  });

  it("percentual com casas decimais não sofre erro de ponto flutuante", () => {
    expect(aplicarPercentual(123_456, 2.5)).toBe(3086); // 3086,4 → 3086
    expect(aplicarPercentual(10, 15)).toBe(2); // 1,5 → 2 (meio para cima)
    expect(aplicarPercentual(999_999_999_999, 12.34)).toBe(123_400_000_000); // 123.399.999.999,8766 → para cima
  });
});
