// Barramento de eventos: toda ação relevante publica um evento (tabela somente inserção).
// O evento avisa o tempo real por pg_notify, que o PostgreSQL só entrega depois do COMMIT:
// se a transação desfizer, ninguém recebe aviso de algo que não aconteceu.
import { randomUUID } from "node:crypto";
import { evento } from "../../infra/esquema.js";
import type { Tx } from "../../infra/banco.js";
import type { Origem } from "../auditoria/registro.js";

export const CANAL_EVENTOS = "mg_eventos";

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

