// Cálculo da comissão do mês (função pura, em centavos inteiros — o mesmo resultado de uma conta feita à mão).
//
// Regras:
// - Cada venda CONFIRMADA do mês cai em uma regra: a da oferta dela, se existir; senão, a regra geral; senão, nenhuma.
// - Por vendedor e regra, a base é a soma das vendas. Regra "percentual": base × percentual.
// - Regra "faixa": a faixa é escolhida pela base do vendedor naquela regra no mês (primeira faixa cujo teto
//   alcança a base; a última, sem teto) e o percentual dela vale para a base toda (escada, não progressiva).
// - Arredondamento: meio centavo para cima, uma vez por vendedor × regra.

export interface VendaParaComissao {
  vendedorId: string;
  ofertaId: string;
  valorCentavos: number;
}

export interface RegraParaComissao {
  id: string;
  nome: string;
  ofertaId: string | null;
  tipo: "percentual" | "faixa";
  percentual: number | null;
  faixas: { ateCentavos: number | null; percentual: number }[] | null;
}

export interface LinhaComissao {
  vendedorId: string;
  regraId: string;
  regraNome: string;
  vendas: number;
  baseCentavos: number;
  percentual: number;
  valorCentavos: number;
}

/** Percentual da faixa que a base alcança. */
export function percentualDaFaixa(faixas: { ateCentavos: number | null; percentual: number }[], base: number): number {
  const ordenadas = [...faixas].sort((a, b) => (a.ateCentavos ?? Infinity) - (b.ateCentavos ?? Infinity));
  const faixa = ordenadas.find((f) => f.ateCentavos === null || base <= f.ateCentavos) ?? ordenadas[ordenadas.length - 1];
  return faixa.percentual;
}

/** base × percentual (com duas casas), arredondando meio centavo para cima, sem erro de ponto flutuante. */
export function aplicarPercentual(baseCentavos: number, percentual: number): number {
  const centesimos = BigInt(Math.round(percentual * 100));
  return Number((BigInt(baseCentavos) * centesimos + 5000n) / 10000n);
}

export function calcularComissoes(vendas: VendaParaComissao[], regras: RegraParaComissao[]): { linhas: LinhaComissao[]; semRegra: number } {
  const porOferta = new Map(regras.filter((r) => r.ofertaId).map((r) => [r.ofertaId!, r]));
  const geral = regras.find((r) => !r.ofertaId) ?? null;
  const grupos = new Map<string, { regra: RegraParaComissao; vendedorId: string; vendas: number; base: number }>();
  let semRegra = 0;
  for (const v of vendas) {
    const regra = porOferta.get(v.ofertaId) ?? geral;
    if (!regra) {
      semRegra++;
      continue;
    }
    const chave = `${v.vendedorId}|${regra.id}`;
    const g = grupos.get(chave) ?? { regra, vendedorId: v.vendedorId, vendas: 0, base: 0 };
    g.vendas++;
    g.base += v.valorCentavos;
    grupos.set(chave, g);
  }
  const linhas = [...grupos.values()].map((g) => {
    const percentual = g.regra.tipo === "percentual" ? (g.regra.percentual ?? 0) : percentualDaFaixa(g.regra.faixas ?? [], g.base);
    return {
      vendedorId: g.vendedorId,
      regraId: g.regra.id,
      regraNome: g.regra.nome,
      vendas: g.vendas,
      baseCentavos: g.base,
      percentual,
      valorCentavos: aplicarPercentual(g.base, percentual),
    };
  });
  return { linhas, semRegra };
}
