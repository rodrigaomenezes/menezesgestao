// Painel de Breaks (do todo ao micro): quantos Breaks e clientes no período, por dia, por categoria, por motivo e
// por quem registrou. Escopo pela carteira do contato (o mesmo da lista de Breaks).
import { sql, type SQL } from "drizzle-orm";
import type { CategoriaBreak, Escopo, PainelBreaksDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { fusoDe, hojeNoFuso, instantesDoPeriodo, intervaloDoPainel } from "../operacao/comum.js";

interface Filtro {
  inicio: string;
  fim: string;
  categoria?: CategoriaBreak;
  autorId?: string;
}

const num = (v: unknown) => Number(v ?? 0);

export function criarServicoPainelBreaks(s: Servicos) {
  const { banco } = s;

  /** Breaks da empresa no intervalo, de contatos que quem pede enxerga; categoria e pessoa são opcionais. */
  function base(ctx: ContextoEmpresa, escopo: Escopo, de: SQL, ate: SQL, f: { categoria?: CategoriaBreak; autorId?: string }): SQL {
    return sql`b.empresa_id = ${ctx.empresaId} AND b.criado_em >= ${de} AND b.criado_em < ${ate}
      AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("c.responsavel_id"))})
      ${f.categoria ? sql`AND b.categoria = ${f.categoria}` : sql``}
      ${f.autorId ? sql`AND b.autor_id = ${f.autorId}::uuid` : sql``}`;
  }

  async function totais(tx: Tx, onde: SQL) {
    const { rows } = await tx.db.execute<Record<string, string>>(sql`
      SELECT count(*) AS breaks, count(DISTINCT b.contato_id) AS contatos
      FROM break_bre b JOIN contato c ON c.id = b.contato_id WHERE ${onde}`);
    return { breaks: num(rows[0].breaks), contatos: num(rows[0].contatos) };
  }

  async function painel(ctx: ContextoEmpresa, escopo: Escopo, f: Filtro): Promise<PainelBreaksDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const fuso = fusoDe(ctx);
      const { inicio, fim, anterior } = intervaloDoPainel({ periodo: "dia", inicio: f.inicio, fim: f.fim }, hojeNoFuso(fuso));
      const atual = instantesDoPeriodo(inicio, fim, fuso);
      const antes = instantesDoPeriodo(anterior.inicio, anterior.fim, fuso);
      const onde = base(ctx, escopo, atual.de, atual.ate, f);

      const porDia = await tx.db.execute<{ dia: string; valor: string }>(sql`
        SELECT to_char((b.criado_em AT TIME ZONE ${fuso})::date, 'YYYY-MM-DD') AS dia, count(*) AS valor
        FROM break_bre b JOIN contato c ON c.id = b.contato_id WHERE ${onde} GROUP BY 1`);
      const mapa = new Map(porDia.rows.map((r) => [r.dia, num(r.valor)]));
      const serie: PainelBreaksDto["serie"] = [];
      for (let d = inicio; d <= fim; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) serie.push({ dia: d, valor: mapa.get(d) ?? 0 });

      // Cada ranking ignora o próprio filtro (o escolhido continua visível no contexto) e respeita o outro.
      const categorias = await tx.db.execute<{ categoria: CategoriaBreak; quantidade: string }>(sql`
        SELECT b.categoria, count(*) AS quantidade
        FROM break_bre b JOIN contato c ON c.id = b.contato_id
        WHERE ${base(ctx, escopo, atual.de, atual.ate, { autorId: f.autorId })}
        GROUP BY 1 ORDER BY 2 DESC, 1`);
      const motivos = await tx.db.execute<{ motivo_id: string; nome: string; categoria: CategoriaBreak; quantidade: string }>(sql`
        SELECT b.motivo_id, m.nome, b.categoria, count(*) AS quantidade
        FROM break_bre b JOIN contato c ON c.id = b.contato_id JOIN motivo_break m ON m.id = b.motivo_id
        WHERE ${onde}
        GROUP BY 1, 2, 3 ORDER BY 4 DESC, 2 LIMIT 20`);
      const autores = await tx.db.execute<{ usuario_id: string; nome: string; quantidade: string }>(sql`
        SELECT b.autor_id AS usuario_id, u.nome, count(*) AS quantidade
        FROM break_bre b JOIN contato c ON c.id = b.contato_id JOIN usuario u ON u.id = b.autor_id
        WHERE ${base(ctx, escopo, atual.de, atual.ate, { categoria: f.categoria })}
        GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT 20`);
      return {
        inicio,
        fim,
        anterior,
        totais: await totais(tx, onde),
        totaisAnteriores: await totais(tx, base(ctx, escopo, antes.de, antes.ate, f)),
        serie,
        categorias: categorias.rows.map((r) => ({ categoria: r.categoria, quantidade: num(r.quantidade) })),
        motivos: motivos.rows.map((r) => ({ motivoId: r.motivo_id, nome: r.nome, categoria: r.categoria, quantidade: num(r.quantidade) })),
        autores: autores.rows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, quantidade: num(r.quantidade) })),
      };
    });
  }

  return { painel };
}
