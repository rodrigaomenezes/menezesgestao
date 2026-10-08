// Paginação por cursor (criado_em, id), da mais recente para a mais antiga. Toda listagem usa.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { invalido } from "./erros.js";

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 100;

export const esquemaPaginacao = z.object({
  cursor: z.string().max(200).optional(),
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_PADRAO),
});

interface Cursor {
  criadoEm: string;
  id: string;
}

export function lerCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const [criadoEm, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];
    if (Number.isNaN(Date.parse(criadoEm)) || !z.uuid().safeParse(id).success) throw new Error();
    return { criadoEm, id };
  } catch {
    throw invalido("O marcador de página é inválido. Volte ao início da lista.");
  }
}

export function condicaoCursor(colCriadoEm: AnyColumn, colId: AnyColumn, cursor: Cursor | null): SQL {
  if (!cursor) return sql`true`;
  return sql`(${colCriadoEm}, ${colId}) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)`;
}

export interface Pagina<T> {
  itens: T[];
  proximoCursor: string | null;
}

/** A consulta busca `limite + 1` linhas; a sobra indica que existe próxima página. */
export function montarPagina<T extends { criadoEm: Date; id: string }>(linhas: T[], limite: number): Pagina<T> {
  const temMais = linhas.length > limite;
  const itens = temMais ? linhas.slice(0, limite) : linhas;
  const ultimo = itens[itens.length - 1];
  return {
    itens,
    proximoCursor:
      temMais && ultimo
        ? Buffer.from(JSON.stringify([ultimo.criadoEm.toISOString(), ultimo.id])).toString("base64url")
        : null,
  };
}
