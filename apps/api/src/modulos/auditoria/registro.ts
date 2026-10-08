// Registro automático: auditoria (quem fez o quê, antes/depois), somente inserção.
// registrar() grava a auditoria e publica o evento de mesmo nome na mesma transação.
import { randomUUID } from "node:crypto";
import { auditoria } from "../../infra/esquema.js";
import type { Tx } from "../../infra/banco.js";
import { publicar, type DadosEvento } from "../eventos/publicar.js";

/** Quem fez, em qual empresa, de onde. */
export interface Origem {
  empresaId: string | null;
  atorId: string | null;
  ip: string | null;
  dispositivo: string | null;
}

const CAMPOS_SENSIVEIS = new Set(["senhaHash", "senha_hash", "senha", "tokenHash", "token_hash", "token"]);

/** Remove campos sensíveis antes de gravar antes/depois na auditoria. */
export function semSegredos(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor)) return valor.map(semSegredos);
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([k]) => !CAMPOS_SENSIVEIS.has(k))
        .map(([k, v]) => [k, semSegredos(v)]),
    );
  }
  return valor;
}

export interface DadosAuditoria {
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  antes?: unknown;
  depois?: unknown;
}

export async function auditar(tx: Tx, origem: Origem, a: DadosAuditoria): Promise<void> {
  await tx.db.insert(auditoria).values({
    id: randomUUID(),
    empresaId: origem.empresaId,
    atorId: origem.atorId,
    acao: a.acao,
    entidade: a.entidade,
    entidadeId: a.entidadeId ?? null,
    antes: semSegredos(a.antes),
    depois: semSegredos(a.depois),
    ip: origem.ip,
    dispositivo: origem.dispositivo,
  });
}

/** Ação de negócio: grava auditoria e publica o evento de mesmo nome na mesma transação. */
export async function registrar(
  tx: Tx,
  origem: Origem,
  a: DadosAuditoria & Omit<DadosEvento, "tipo" | "entidade" | "entidadeId">,
): Promise<void> {
  await auditar(tx, origem, a);
  await publicar(tx, origem, {
    tipo: a.acao,
    entidade: a.entidade,
    entidadeId: a.entidadeId,
    responsavelId: a.responsavelId,
    paraUsuarioId: a.paraUsuarioId,
    contatoId: a.contatoId,
    silencioso: a.silencioso,
    dados: a.dados,
  });
}
