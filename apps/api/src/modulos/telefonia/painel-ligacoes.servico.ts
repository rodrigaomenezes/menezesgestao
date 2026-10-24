// Painel de ligações (do todo ao micro): feitas, atendidas, taxa de atendimento e tempo falado no período, por dia,
// por resultado e por pessoa. Escopo pela pessoa que ligou.
import { sql, type SQL } from "drizzle-orm";
import type { Escopo, PainelLigacoesDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { fusoDe, hojeNoFuso, instantesDoPeriodo, intervaloDoPainel } from "../operacao/comum.js";

interface Filtro {
  inicio: string;
  fim: string;
  usuarioId?: string;
}

const num = (v: unknown) => Number(v ?? 0);

export function criarServicoPainelLigacoes(s: Servicos) {
  const { banco } = s;

  /** Ligações da empresa começadas no intervalo, que quem pede enxerga (e da pessoa, se filtrada). */
  function base(ctx: ContextoEmpresa, escopo: Escopo, de: SQL, ate: SQL, usuarioId?: string): SQL {
    return sql`l.empresa_id = ${ctx.empresaId} AND l.iniciada_em >= ${de} AND l.iniciada_em < ${ate}
      AND ${filtroUsuariosVisiveis(ctx, escopo, sql`l.usuario_id`)}
      ${usuarioId ? sql`AND l.usuario_id = ${usuarioId}::uuid` : sql``}`;
  }

  async function totais(tx: Tx, onde: SQL) {
    const { rows } = await tx.db.execute<Record<string, string>>(sql`
      SELECT count(*) AS feitas, count(*) FILTER (WHERE l.atendida_em IS NOT NULL) AS atendidas,
             coalesce(sum(l.duracao_segundos) FILTER (WHERE l.atendida_em IS NOT NULL), 0) AS segundos
      FROM ligacao l WHERE ${onde}`);
    const feitas = num(rows[0].feitas);
    const atendidas = num(rows[0].atendidas);
    const segundos = num(rows[0].segundos);
    return {
      feitas,
      atendidas,
      taxaAtendimento: feitas ? Math.round((atendidas / feitas) * 1000) / 10 : null,
      segundosFalados: segundos,
      duracaoMediaSegundos: atendidas ? Math.round(segundos / atendidas) : null,
    };
  }

  async function painel(ctx: ContextoEmpresa, escopo: Escopo, f: Filtro): Promise<PainelLigacoesDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const fuso = fusoDe(ctx);
      const { inicio, fim, anterior } = intervaloDoPainel({ periodo: "dia", inicio: f.inicio, fim: f.fim }, hojeNoFuso(fuso));
      const atual = instantesDoPeriodo(inicio, fim, fuso);
      const antes = instantesDoPeriodo(anterior.inicio, anterior.fim, fuso);
      const onde = base(ctx, escopo, atual.de, atual.ate, f.usuarioId);

      const porDia = await tx.db.execute<{ dia: string; feitas: string; atendidas: string }>(sql`
        SELECT to_char((l.iniciada_em AT TIME ZONE ${fuso})::date, 'YYYY-MM-DD') AS dia,
               count(*) AS feitas, count(*) FILTER (WHERE l.atendida_em IS NOT NULL) AS atendidas
        FROM ligacao l WHERE ${onde} GROUP BY 1`);
      const mapa = new Map(porDia.rows.map((r) => [r.dia, r]));
      const serie: PainelLigacoesDto["serie"] = [];
      for (let d = inicio; d <= fim; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
        serie.push({ dia: d, feitas: num(mapa.get(d)?.feitas), atendidas: num(mapa.get(d)?.atendidas) });
      }
      const resultados = await tx.db.execute<{ resultado_id: string | null; nome: string | null; quantidade: string }>(sql`
        SELECT l.resultado_id, r.nome, count(*) AS quantidade
        FROM ligacao l LEFT JOIN resultado_ligacao r ON r.id = l.resultado_id
        WHERE ${onde} AND l.estado = 'encerrada'
        GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT 20`);
      // O ranking de pessoas ignora o filtro de pessoa, para a escolhida aparecer no contexto.
      const pessoas = await tx.db.execute<{ usuario_id: string; nome: string; feitas: string; atendidas: string; segundos: string }>(sql`
        SELECT l.usuario_id, u.nome, count(*) AS feitas, count(*) FILTER (WHERE l.atendida_em IS NOT NULL) AS atendidas,
               coalesce(sum(l.duracao_segundos) FILTER (WHERE l.atendida_em IS NOT NULL), 0) AS segundos
        FROM ligacao l JOIN usuario u ON u.id = l.usuario_id
        WHERE ${base(ctx, escopo, atual.de, atual.ate)}
        GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT 20`);
      return {
        inicio,
        fim,
        anterior,
        totais: await totais(tx, onde),
        totaisAnteriores: await totais(tx, base(ctx, escopo, antes.de, antes.ate, f.usuarioId)),
        serie,
        resultados: resultados.rows.map((r) => ({ resultadoId: r.resultado_id, nome: r.nome ?? "Sem resultado registrado", quantidade: num(r.quantidade) })),
        pessoas: pessoas.rows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, feitas: num(r.feitas), atendidas: num(r.atendidas), segundosFalados: num(r.segundos) })),
      };
    });
  }

  return { painel };
}
