// Paginação por cursor (criado_em, id), da mais recente para a mais antiga. Toda listagem usa.
// Os parâmetros (cursor, limite com teto) são validados pelo esquema Paginacao de @mg/shared.
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Pagina } from "@mg/shared";
import { invalido } from "./erros.js";

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

/** A consulta busca `limite + 1` linhas; a sobra indica que existe próxima página. */
export function montarPagina<T extends { criadoEm: Date; id: string }, D>(
  linhas: T[],
  limite: number,
  paraDto: (linha: T) => D,
): Pagina<D> {
  const temMais = linhas.length > limite;
  const itens = temMais ? linhas.slice(0, limite) : linhas;
  const ultimo = itens[itens.length - 1];
  return {
    itens: itens.map(paraDto),
    proximoCursor:
      temMais && ultimo
        ? Buffer.from(JSON.stringify([ultimo.criadoEm.toISOString(), ultimo.id])).toString("base64url")
        : null,
  };
}

/** Datas saem da API sempre em ISO 8601 (UTC). */
export function iso(data: Date): string;
export function iso(data: Date | null): string | null;
export function iso(data: Date | null): string | null {
  return data ? data.toISOString() : null;
}
