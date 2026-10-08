// Registro automático: auditoria (quem fez o quê, antes/depois) e eventos (barramento interno).
// As duas tabelas são somente inserção. O evento avisa o tempo real por pg_notify, que o PostgreSQL
// só entrega depois do COMMIT: se a transação desfizer, ninguém recebe aviso de algo que não aconteceu.
import { randomUUID } from "node:crypto";
import { auditoria, evento } from "../db/esquema.js";
import type { Tx } from "../db/banco.js";

export const CANAL_EVENTOS = "mg_eventos";

export interface Origem {
  empresaId: string | null;
  atorId: string | null;
  ip: string | null;
  dispositivo: string | null;
}

export interface DadosEvento {
  tipo: string;
  entidade: string;
  entidadeId?: string | null;
  /** Dono do registro (ou a própria pessoa, para usuários): define quem pode receber o aviso em tempo real. */
  responsavelId?: string | null;
  /** Evento pessoal (ex.: notificação): só essa pessoa recebe. */
  paraUsuarioId?: string | null;
  dados?: Record<string, unknown>;
}

export interface AvisoEvento {
  id: string;
  empresaId: string;
  tipo: string;
  entidade: string;
  entidadeId: string | null;
  responsavelId: string | null;
  paraUsuarioId: string | null;
  atorId: string | null;
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

export async function publicar(tx: Tx, origem: Origem, e: DadosEvento): Promise<string> {
  const empresaId = origem.empresaId;
  if (!empresaId) throw new Error("Evento precisa de empresa");
  const id = randomUUID();
  await tx.db.insert(evento).values({
    id,
    empresaId,
    tipo: e.tipo,
    atorId: origem.atorId,
    entidade: e.entidade,
    entidadeId: e.entidadeId ?? null,
    responsavelId: e.responsavelId ?? null,
    paraUsuarioId: e.paraUsuarioId ?? null,
    dados: e.dados ?? {},
  });
  const aviso: AvisoEvento = {
    id,
    empresaId,
    tipo: e.tipo,
    entidade: e.entidade,
    entidadeId: e.entidadeId ?? null,
    responsavelId: e.responsavelId ?? null,
    paraUsuarioId: e.paraUsuarioId ?? null,
    atorId: origem.atorId,
  };
  await tx.cliente.query("SELECT pg_notify($1, $2)", [CANAL_EVENTOS, JSON.stringify(aviso)]);
  return id;
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
    dados: a.dados,
  });
}
