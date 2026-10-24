// Painel de qualidade (do todo ao micro): avaliações do período, nota média, por pessoa avaliada e por critério.
// Escopo pela pessoa avaliada (quem vê só o próprio vê só as próprias notas).
import { sql, type SQL } from "drizzle-orm";
import type { Escopo, PainelQualidadeDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { fusoDe, hojeNoFuso, instantesDoPeriodo, intervaloDoPainel } from "../operacao/comum.js";

interface Filtro {
  inicio: string;
  fim: string;
  avaliadoId?: string;
}

const num = (v: unknown) => Number(v ?? 0);
const duasCasas = (v: unknown) => Math.round(Number(v) * 100) / 100;

export function criarServicoPainelQualidade(s: Servicos) {
  const { banco } = s;

  /** Avaliações da empresa, não arquivadas, feitas no intervalo, que quem pede enxerga. */
  function base(ctx: ContextoEmpresa, escopo: Escopo, de: SQL, ate: SQL, avaliadoId?: string): SQL {
    return sql`a.empresa_id = ${ctx.empresaId} AND a.arquivado_em IS NULL AND a.criado_em >= ${de} AND a.criado_em < ${ate}
      AND ${filtroUsuariosVisiveis(ctx, escopo, sql`a.avaliado_id`)}
      ${avaliadoId ? sql`AND a.avaliado_id = ${avaliadoId}::uuid` : sql``}`;
  }

  async function totais(tx: Tx, onde: SQL) {
    const { rows } = await tx.db.execute<Record<string, string | null>>(sql`
      SELECT count(*) AS avaliacoes, avg(a.nota_final) AS media, count(*) FILTER (WHERE a.lida_em IS NULL) AS nao_lidas
      FROM avaliacao a WHERE ${onde}`);
    const r = rows[0];
    return { avaliacoes: num(r.avaliacoes), notaMedia: r.media === null ? null : duasCasas(r.media), naoLidas: num(r.nao_lidas) };
  }

  async function painel(ctx: ContextoEmpresa, escopo: Escopo, f: Filtro): Promise<PainelQualidadeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const fuso = fusoDe(ctx);
      const { inicio, fim, anterior } = intervaloDoPainel({ periodo: "dia", inicio: f.inicio, fim: f.fim }, hojeNoFuso(fuso));
      const atual = instantesDoPeriodo(inicio, fim, fuso);
      const antes = instantesDoPeriodo(anterior.inicio, anterior.fim, fuso);
      const onde = base(ctx, escopo, atual.de, atual.ate, f.avaliadoId);
      // O ranking de pessoas ignora o filtro de pessoa, para a escolhida aparecer no contexto.
      const pessoas = await tx.db.execute<{ usuario_id: string; nome: string; avaliacoes: string; media: string }>(sql`
        SELECT a.avaliado_id AS usuario_id, u.nome, count(*) AS avaliacoes, avg(a.nota_final) AS media
        FROM avaliacao a JOIN usuario u ON u.id = a.avaliado_id
        WHERE ${base(ctx, escopo, atual.de, atual.ate)}
        GROUP BY 1, 2 ORDER BY 4 DESC, 2 LIMIT 20`);
      // As notas por critério ficam guardadas na avaliação (o nome do critério na época, mesmo se ele mudou depois).
      const criterios = await tx.db.execute<{ criterio_id: string; nome: string; media: string; avaliacoes: string }>(sql`
        SELECT n->>'criterioId' AS criterio_id, max(n->>'nome') AS nome, avg((n->>'nota')::numeric) AS media, count(*) AS avaliacoes
        FROM avaliacao a CROSS JOIN LATERAL jsonb_array_elements(a.notas) n
        WHERE ${onde}
        GROUP BY 1 ORDER BY 3, 2 LIMIT 30`);
      return {
        inicio,
        fim,
        anterior,
        totais: await totais(tx, onde),
        totaisAnteriores: await totais(tx, base(ctx, escopo, antes.de, antes.ate, f.avaliadoId)),
        pessoas: pessoas.rows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, avaliacoes: num(r.avaliacoes), notaMedia: duasCasas(r.media) })),
        criterios: criterios.rows.map((r) => ({ criterioId: r.criterio_id, nome: r.nome, notaMedia: duasCasas(r.media), avaliacoes: num(r.avaliacoes) })),
      };
    });
  }

  return { painel };
}
