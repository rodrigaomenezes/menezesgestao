// Painel de vendas (do todo ao micro): o que foi confirmado no período (valor, quantidade, ticket médio), por dia,
// por oferta e por vendedor; aguardando pagamento e canceladas aparecem à parte. Escopo pelo vendedor da venda.
import { sql, type SQL } from "drizzle-orm";
import type { Escopo, PainelVendasDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { fusoDe, hojeNoFuso, intervaloDoPainel } from "../operacao/comum.js";

interface Filtro {
  inicio: string;
  fim: string;
  vendedorId?: string;
  ofertaId?: string;
}

const num = (v: unknown) => Number(v ?? 0);

export function criarServicoPainelVendas(s: Servicos) {
  const { banco } = s;

  /** Vendas da empresa no intervalo de datas, que quem pede enxerga; os filtros de vendedor e oferta são opcionais. */
  function base(ctx: ContextoEmpresa, escopo: Escopo, inicio: string, fim: string, f: { vendedorId?: string; ofertaId?: string }): SQL {
    return sql`v.empresa_id = ${ctx.empresaId} AND v.data_venda BETWEEN ${inicio}::date AND ${fim}::date
      AND ${filtroUsuariosVisiveis(ctx, escopo, sql`v.vendedor_id`)}
      ${f.vendedorId ? sql`AND v.vendedor_id = ${f.vendedorId}::uuid` : sql``}
      ${f.ofertaId ? sql`AND v.oferta_id = ${f.ofertaId}::uuid` : sql``}`;
  }

  async function totais(tx: Tx, onde: SQL) {
    const { rows } = await tx.db.execute<Record<string, string>>(sql`
      SELECT count(*) FILTER (WHERE v.status = 'confirmada') AS quantidade,
             coalesce(sum(v.valor_centavos) FILTER (WHERE v.status = 'confirmada'), 0) AS valor,
             count(*) FILTER (WHERE v.status = 'pendente') AS aguardando,
             count(*) FILTER (WHERE v.status = 'cancelada') AS canceladas
      FROM venda v WHERE ${onde}`);
    const r = rows[0];
    const quantidade = num(r.quantidade);
    const valor = num(r.valor);
    return { quantidade, valorCentavos: valor, ticketMedioCentavos: quantidade ? Math.round(valor / quantidade) : null, aguardando: num(r.aguardando), canceladas: num(r.canceladas) };
  }

  async function painel(ctx: ContextoEmpresa, escopo: Escopo, f: Filtro): Promise<PainelVendasDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { inicio, fim, anterior } = intervaloDoPainel({ periodo: "dia", inicio: f.inicio, fim: f.fim }, hojeNoFuso(fusoDe(ctx)));
      const onde = base(ctx, escopo, inicio, fim, f);
      const porDia = await tx.db.execute<{ dia: string; valor: string }>(sql`
        SELECT to_char(v.data_venda, 'YYYY-MM-DD') AS dia, sum(v.valor_centavos) AS valor
        FROM venda v WHERE ${onde} AND v.status = 'confirmada' GROUP BY 1`);
      const mapa = new Map(porDia.rows.map((r) => [r.dia, num(r.valor) / 100]));
      const serie: { dia: string; valor: number }[] = [];
      for (let d = inicio; d <= fim; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) serie.push({ dia: d, valor: mapa.get(d) ?? 0 });
      // Cada ranking ignora o próprio filtro (para a escolhida aparecer no contexto) e respeita o outro.
      const ofertas = await tx.db.execute<{ oferta_id: string; nome: string; quantidade: string; valor: string }>(sql`
        SELECT v.oferta_id, o.nome, count(*) AS quantidade, sum(v.valor_centavos) AS valor
        FROM venda v JOIN oferta o ON o.id = v.oferta_id
        WHERE ${base(ctx, escopo, inicio, fim, { vendedorId: f.vendedorId })} AND v.status = 'confirmada'
        GROUP BY 1, 2 ORDER BY 4 DESC, 2 LIMIT 20`);
      const vendedores = await tx.db.execute<{ usuario_id: string; nome: string; quantidade: string; valor: string }>(sql`
        SELECT v.vendedor_id AS usuario_id, u.nome, count(*) AS quantidade, sum(v.valor_centavos) AS valor
        FROM venda v JOIN usuario u ON u.id = v.vendedor_id
        WHERE ${base(ctx, escopo, inicio, fim, { ofertaId: f.ofertaId })} AND v.status = 'confirmada'
        GROUP BY 1, 2 ORDER BY 4 DESC, 2 LIMIT 20`);
      return {
        inicio,
        fim,
        anterior,
        totais: await totais(tx, onde),
        totaisAnteriores: await totais(tx, base(ctx, escopo, anterior.inicio, anterior.fim, f)),
        serie,
        ofertas: ofertas.rows.map((r) => ({ ofertaId: r.oferta_id, nome: r.nome, quantidade: num(r.quantidade), valorCentavos: num(r.valor) })),
        vendedores: vendedores.rows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, quantidade: num(r.quantidade), valorCentavos: num(r.valor) })),
      };
    });
  }

  return { painel };
}
