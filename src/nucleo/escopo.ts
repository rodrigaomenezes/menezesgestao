// Escopo de dados: só o próprio, da equipe, da unidade ou de toda a empresa.
// Vira uma condição SQL sobre a coluna que guarda o "dono" do registro.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Escopo } from "../compartilhado/catalogo.js";
import type { Tx } from "../db/banco.js";

export interface QuemVe {
  usuarioId: string;
  unidadeId: string | null;
  equipeId: string | null;
}

/** Usuários da equipe que a pessoa integra e das equipes que ela coordena. */
function sqlUsuariosDaEquipe(q: QuemVe): SQL {
  const minhaEquipe = q.equipeId ? sql`OR v.equipe_id = ${q.equipeId}` : sql``;
  return sql`SELECT v.usuario_id FROM vinculo v WHERE v.equipe_id IN (
    SELECT e.id FROM equipe e WHERE e.gestor_id = ${q.usuarioId} AND e.arquivado_em IS NULL
  ) ${minhaEquipe}`;
}

export function filtroUsuariosVisiveis(q: QuemVe, escopo: Escopo, coluna: AnyColumn | SQL): SQL {
  switch (escopo) {
    case "empresa":
      return sql`true`;
    case "unidade":
      return q.unidadeId
        ? sql`(${coluna} = ${q.usuarioId} OR ${coluna} IN (SELECT usuario_id FROM vinculo WHERE unidade_id = ${q.unidadeId}))`
        : sql`${coluna} = ${q.usuarioId}`;
    case "equipe":
      return sql`(${coluna} = ${q.usuarioId} OR ${coluna} IN (${sqlUsuariosDaEquipe(q)}))`;
    case "proprio":
      return sql`${coluna} = ${q.usuarioId}`;
  }
}

/** Para o tempo real: conjunto de usuários visíveis, ou "todos". Roda dentro de comEmpresa. */
export async function usuariosVisiveis(tx: Tx, q: QuemVe, escopo: Escopo): Promise<Set<string> | "todos"> {
  if (escopo === "empresa") return "todos";
  if (escopo === "proprio") return new Set([q.usuarioId]);
  const condicao = filtroUsuariosVisiveis(q, escopo, sql.raw("vv.usuario_id"));
  const { rows } = await tx.db.execute<{ usuario_id: string }>(
    sql`SELECT vv.usuario_id FROM vinculo vv WHERE ${condicao}`,
  );
  return new Set([q.usuarioId, ...rows.map((r) => r.usuario_id)]);
}
