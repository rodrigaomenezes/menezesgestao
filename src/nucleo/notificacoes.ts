import { randomUUID } from "node:crypto";
import { notificacao } from "../db/esquema.js";
import type { Tx } from "../db/banco.js";
import { publicar, type Origem } from "./registro.js";

export interface NovaNotificacao {
  usuarioId: string;
  titulo: string;
  texto?: string;
  link?: string;
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
  });
  await publicar(tx, origem, {
    tipo: "notificacao.criada",
    entidade: "notificacao",
    entidadeId: id,
    paraUsuarioId: n.usuarioId,
  });
}
