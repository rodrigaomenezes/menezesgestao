import { randomUUID } from "node:crypto";
import { notificacao } from "../../infra/esquema.js";
import type { Tx } from "../../infra/banco.js";
import type { Origem } from "../auditoria/registro.js";
import { publicar } from "../eventos/publicar.js";

export interface NovaNotificacao {
  usuarioId: string;
  titulo: string;
  texto?: string;
  link?: string;
  /** Aviso de ligação: no push, vai só para celulares (no computador não adianta). */
  soCelular?: boolean;
}

/** Notificação no sino + aviso em tempo real só para a pessoa. */
export async function notificar(tx: Tx, origem: Origem, n: NovaNotificacao): Promise<void> {
  if (!origem.empresaId) throw new Error("Notificação precisa de empresa");
  const id = randomUUID();
  await tx.db.insert(notificacao).values({
    id,
    empresaId: origem.empresaId,
    usuarioId: n.usuarioId,
    titulo: n.titulo,
    texto: n.texto ?? null,
    link: n.link ?? null,
    soCelular: n.soCelular ?? false,
  });
  await publicar(tx, origem, {
    tipo: "notificacao.criada",
    entidade: "notificacao",
    entidadeId: id,
    paraUsuarioId: n.usuarioId,
  });
}
