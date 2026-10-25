// Até onde uma oportunidade chegou no funil: a maior ordem de etapa aberta por onde ela passou (a atual e as dos
// eventos "oportunidade.etapa_alterada", de onde saiu e para onde foi). Ganhar conta como passar por todas. Sem
// histórico nenhum (ex.: criada já fechada), vale a primeira etapa aberta do funil. Usado pelo painel do funil e pela
// lista "pararam nesta etapa", para os dois contarem igual.
import { sql, type SQL } from "drizzle-orm";

/** Ordem que representa "ganhou" (passou de todas as etapas abertas). */
export const ALCANCE_GANHA = 2_147_483_647;

export function alcanceNoFunil(o: { id: SQL; status: SQL; etapaId: SQL; funilId: SQL; empresaId: SQL }): SQL {
  return sql`(CASE WHEN ${o.status} = 'ganha' THEN ${ALCANCE_GANHA} ELSE coalesce(
    (SELECT max(e.ordem) FROM etapa e
      WHERE e.tipo = 'aberta' AND e.funil_id = ${o.funilId}
        AND (e.id = ${o.etapaId} OR e.id IN (
          SELECT (ev.dados->>x.chave)::uuid
          FROM evento ev CROSS JOIN (VALUES ('etapaNovaId'), ('etapaAnteriorId')) AS x(chave)
          WHERE ev.empresa_id = ${o.empresaId} AND ev.entidade = 'oportunidade' AND ev.entidade_id = ${o.id}
            AND ev.tipo = 'oportunidade.etapa_alterada'))),
    (SELECT min(e.ordem) FROM etapa e WHERE e.tipo = 'aberta' AND e.funil_id = ${o.funilId})) END)`;
}
