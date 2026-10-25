// Painel do funil (do todo ao micro): o que entrou, ganhou e perdeu no período, a conversão, o ciclo, onde estão as
// abertas agora, por que se perdeu e quem ganhou. Tudo no escopo de quem pede (carteira pelo responsável).
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Escopo, PainelFunilDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { funil } from "../../infra/esquema.js";
import { naoEncontrado } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { fusoDe, hojeNoFuso, instantesDoPeriodo, intervaloDoPainel } from "../operacao/comum.js";
import { alcanceNoFunil } from "./alcance-funil.js";

interface Filtro {
  funilId: string;
  inicio: string;
  fim: string;
  responsavelId?: string;
}

const num = (v: unknown) => Number(v ?? 0);

export function criarServicoPainelFunil(s: Servicos) {
  const { banco } = s;

  /** Oportunidades do funil, não arquivadas, que quem pede enxerga (e do responsável, se filtrado). */
  function base(ctx: ContextoEmpresa, escopo: Escopo, f: Filtro, comResponsavel = true): SQL {
    return sql`o.empresa_id = ${ctx.empresaId} AND o.funil_id = ${f.funilId} AND o.arquivado_em IS NULL
      AND ${filtroUsuariosVisiveis(ctx, escopo, sql`o.responsavel_id`)}
      ${comResponsavel && f.responsavelId ? sql`AND o.responsavel_id = ${f.responsavelId}::uuid` : sql``}`;
  }

  async function totais(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, f: Filtro, de: SQL, ate: SQL) {
    const noPeriodo = sql`o.fechada_em >= ${de} AND o.fechada_em < ${ate}`;
    const { rows } = await tx.db.execute<Record<string, string | null>>(sql`
      SELECT count(*) FILTER (WHERE o.criado_em >= ${de} AND o.criado_em < ${ate}) AS entraram,
             count(*) FILTER (WHERE o.status = 'ganha' AND ${noPeriodo}) AS ganhas,
             count(*) FILTER (WHERE o.status = 'perdida' AND ${noPeriodo}) AS perdidas,
             coalesce(sum(o.valor_centavos) FILTER (WHERE o.status = 'ganha' AND ${noPeriodo}), 0) AS valor,
             avg(extract(epoch FROM o.fechada_em - o.criado_em) / 86400) FILTER (WHERE o.status = 'ganha' AND ${noPeriodo}) AS ciclo
      FROM oportunidade o WHERE ${base(ctx, escopo, f)}`);
    const r = rows[0];
    const ganhas = num(r.ganhas);
    const perdidas = num(r.perdidas);
    return {
      entraram: num(r.entraram),
      ganhas,
      perdidas,
      valorGanhoCentavos: num(r.valor),
      conversao: ganhas + perdidas ? Math.round((ganhas / (ganhas + perdidas)) * 1000) / 10 : null,
      cicloMedioDias: r.ciclo === null ? null : Math.round(Number(r.ciclo) * 10) / 10,
    };
  }

  async function painel(ctx: ContextoEmpresa, escopo: Escopo, f: Filtro): Promise<PainelFunilDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [fn] = await tx.db.select({ id: funil.id }).from(funil).where(and(eq(funil.id, f.funilId), eq(funil.empresaId, ctx.empresaId), isNull(funil.arquivadoEm)));
      if (!fn) throw naoEncontrado("Funil");
      const fuso = fusoDe(ctx);
      const { inicio, fim, anterior } = intervaloDoPainel({ periodo: "dia", inicio: f.inicio, fim: f.fim }, hojeNoFuso(fuso));
      const atual = instantesDoPeriodo(inicio, fim, fuso);
      const antes = instantesDoPeriodo(anterior.inicio, anterior.fim, fuso);
      const ganhaNoPeriodo = sql`o.status = 'ganha' AND o.fechada_em >= ${atual.de} AND o.fechada_em < ${atual.ate}`;

      const etapas = await tx.db.execute<{ etapa_id: string; nome: string; quantidade: string; valor: string }>(sql`
        SELECT e.id AS etapa_id, e.nome, count(o.id) AS quantidade, coalesce(sum(o.valor_centavos), 0) AS valor
        FROM etapa e
        LEFT JOIN oportunidade o ON o.etapa_id = e.id AND o.status = 'aberta' AND ${base(ctx, escopo, f)}
        WHERE e.empresa_id = ${ctx.empresaId} AND e.funil_id = ${f.funilId} AND e.tipo = 'aberta' AND e.arquivado_em IS NULL
        GROUP BY e.id, e.nome, e.ordem
        ORDER BY e.ordem, e.nome`);
      const motivos = await tx.db.execute<{ motivo_perda_id: string | null; nome: string | null; quantidade: string }>(sql`
        SELECT o.motivo_perda_id, m.nome, count(*) AS quantidade
        FROM oportunidade o LEFT JOIN motivo_perda m ON m.id = o.motivo_perda_id
        WHERE ${base(ctx, escopo, f)} AND o.status = 'perdida' AND o.fechada_em >= ${atual.de} AND o.fechada_em < ${atual.ate}
        GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT 20`);
      const responsaveis = await tx.db.execute<{ usuario_id: string; nome: string; ganhas: string; valor: string }>(sql`
        SELECT o.responsavel_id AS usuario_id, u.nome, count(*) AS ganhas, coalesce(sum(o.valor_centavos), 0) AS valor
        FROM oportunidade o JOIN usuario u ON u.id = o.responsavel_id
        WHERE ${base(ctx, escopo, f, false)} AND ${ganhaNoPeriodo}
        GROUP BY 1, 2 ORDER BY 4 DESC, 3 DESC, 2 LIMIT 20`);
      const porDia = await tx.db.execute<{ dia: string; valor: string }>(sql`
        SELECT to_char((o.fechada_em AT TIME ZONE ${fuso})::date, 'YYYY-MM-DD') AS dia, count(*) AS valor
        FROM oportunidade o WHERE ${base(ctx, escopo, f)} AND ${ganhaNoPeriodo} GROUP BY 1`);
      const mapa = new Map(porDia.rows.map((r) => [r.dia, num(r.valor)]));
      const serie: { dia: string; valor: number }[] = [];
      for (let d = inicio; d <= fim; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) serie.push({ dia: d, valor: mapa.get(d) ?? 0 });

      // Conversão da coorte (quem entrou no período): até onde cada uma chegou → quantas chegaram a cada etapa.
      const alcance = alcanceNoFunil({ id: sql`o.id`, status: sql`o.status`, etapaId: sql`o.etapa_id`, funilId: sql`o.funil_id`, empresaId: sql`o.empresa_id` });
      const coorte = sql`SELECT o.id, o.status, ${alcance} AS alcance FROM oportunidade o
        WHERE ${base(ctx, escopo, f)} AND o.criado_em >= ${atual.de} AND o.criado_em < ${atual.ate}`;
      const chegaram = await tx.db.execute<{ etapa_id: string; nome: string; chegaram: string }>(sql`
        WITH coorte AS (${coorte})
        SELECT e.id AS etapa_id, e.nome, (SELECT count(*) FROM coorte c WHERE c.alcance >= e.ordem) AS chegaram
        FROM etapa e
        WHERE e.empresa_id = ${ctx.empresaId} AND e.funil_id = ${f.funilId} AND e.tipo = 'aberta' AND e.arquivado_em IS NULL
        ORDER BY e.ordem, e.nome`);
      const ganharam = num(
        (await tx.db.execute<{ n: string }>(sql`WITH coorte AS (${coorte}) SELECT count(*) FILTER (WHERE status = 'ganha') AS n FROM coorte`)).rows[0].n,
      );
      const etapasConversao = chegaram.rows.map((r, i, todas) => {
        const proxima = i + 1 < todas.length ? num(todas[i + 1].chegaram) : ganharam;
        return { etapaId: r.etapa_id, nome: r.nome, chegaram: num(r.chegaram), pararam: Math.max(0, num(r.chegaram) - proxima) };
      });

      return {
        inicio,
        fim,
        anterior,
        conversao: { etapas: etapasConversao, ganharam },
        totais: await totais(tx, ctx, escopo, f, atual.de, atual.ate),
        totaisAnteriores: await totais(tx, ctx, escopo, f, antes.de, antes.ate),
        etapas: etapas.rows.map((r) => ({ etapaId: r.etapa_id, nome: r.nome, quantidade: num(r.quantidade), valorCentavos: num(r.valor) })),
        motivos: motivos.rows.map((r) => ({ motivoPerdaId: r.motivo_perda_id, nome: r.nome ?? "Sem motivo informado", quantidade: num(r.quantidade) })),
        responsaveis: responsaveis.rows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, ganhas: num(r.ganhas), valorCentavos: num(r.valor) })),
        serie,
      };
    });
  }

  return { painel };
}
