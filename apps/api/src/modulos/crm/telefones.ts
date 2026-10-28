// Telefone → contato. Um telefone ativo é de um contato só, seja o principal (contato.telefone) ou um extra
// (contato_canal). Esta é a regra de deduplicação por telefone, usada pelo CRM, pela entrada do WhatsApp, pela
// importação e pela telefonia — quem precisa dela importa daqui (leve), não o serviço de contatos.
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "../../infra/banco.js";
import { contato } from "../../infra/esquema.js";

/** Condição "o contato tem um destes telefones" (principal ou extra ativo), pelos índices das duas tabelas. */
export function temTelefone(empresaId: string, telefones: string[]): SQL {
  if (!telefones.length) return sql`false`;
  const lista = sql.join(telefones.map((t) => sql`${t}`), sql`, `);
  return sql`${contato.id} IN (
    SELECT c.id FROM contato c WHERE c.empresa_id = ${empresaId} AND c.telefone IN (${lista})
    UNION ALL
    SELECT cc.contato_id FROM contato_canal cc
     WHERE cc.empresa_id = ${empresaId} AND cc.tipo = 'telefone' AND cc.arquivado_em IS NULL AND cc.valor IN (${lista}))`;
}

/**
 * Trava curta (até o fim da transação) por empresa + telefone: quem grava um telefone como principal ou extra
 * espera a outra gravação do mesmo número terminar, e então confere de novo — os índices únicos de cada tabela
 * sozinhos não enxergam a outra.
 */
export async function travarTelefone(tx: Tx, empresaId: string, telefone: string): Promise<void> {
  await tx.cliente.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`telefone:${empresaId}:${telefone}`]);
}

/** De quem é este telefone (exato, E.164), e se está como principal ou extra. Inclui contato arquivado. */
export async function donoDoTelefone(tx: Tx, empresaId: string, telefone: string): Promise<{ contatoId: string; extra: boolean } | null> {
  const { rows } = await tx.cliente.query<{ contatoId: string; extra: boolean }>(
    `SELECT id AS "contatoId", false AS extra FROM contato WHERE empresa_id = $1 AND telefone = $2
     UNION ALL
     SELECT contato_id, true FROM contato_canal WHERE empresa_id = $1 AND tipo = 'telefone' AND arquivado_em IS NULL AND valor = $2
     LIMIT 1`,
    [empresaId, telefone],
  );
  return rows[0] ?? null;
}
