// Consultas dos telefones, e-mails e endereços extras de um contato (sempre dentro de comEmpresa).
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../infra/banco.js";
import { contatoCanal, contatoEndereco } from "../../infra/esquema.js";

const colunasCanal = { id: contatoCanal.id, tipo: contatoCanal.tipo, valor: contatoCanal.valor, rotulo: contatoCanal.rotulo, criadoEm: contatoCanal.criadoEm };

/** Ativos do contato (no máximo MAX_CANAIS_POR_CONTATO): telefones antes, na ordem em que entraram. */
export function canaisDe(tx: Tx, empresaId: string, contatoId: string) {
  return tx.db
    .select(colunasCanal)
    .from(contatoCanal)
    .where(and(eq(contatoCanal.empresaId, empresaId), eq(contatoCanal.contatoId, contatoId), isNull(contatoCanal.arquivadoEm)))
    .orderBy(desc(contatoCanal.tipo), asc(contatoCanal.criadoEm), asc(contatoCanal.id));
}

export function canal(tx: Tx, empresaId: string, contatoId: string, id: string) {
  return tx.db
    .select(colunasCanal)
    .from(contatoCanal)
    .where(and(eq(contatoCanal.empresaId, empresaId), eq(contatoCanal.contatoId, contatoId), eq(contatoCanal.id, id), isNull(contatoCanal.arquivadoEm)))
    .then((r) => r[0] ?? null);
}

export async function quantosCanais(tx: Tx, empresaId: string, contatoId: string) {
  const [r] = await tx.db
    .select({ n: count() })
    .from(contatoCanal)
    .where(and(eq(contatoCanal.empresaId, empresaId), eq(contatoCanal.contatoId, contatoId), isNull(contatoCanal.arquivadoEm)));
  return r?.n ?? 0;
}

const colunasEndereco = {
  id: contatoEndereco.id,
  rotulo: contatoEndereco.rotulo,
  cep: contatoEndereco.cep,
  logradouro: contatoEndereco.logradouro,
  numero: contatoEndereco.numero,
  complemento: contatoEndereco.complemento,
  bairro: contatoEndereco.bairro,
  cidade: contatoEndereco.cidade,
  uf: contatoEndereco.uf,
  principal: contatoEndereco.principal,
  criadoEm: contatoEndereco.criadoEm,
  atualizadoEm: contatoEndereco.atualizadoEm,
};
export type LinhaEndereco = Awaited<ReturnType<typeof enderecosDe>>[number];

/** Ativos do contato (no máximo MAX_ENDERECOS_POR_CONTATO): o principal primeiro. */
export function enderecosDe(tx: Tx, empresaId: string, contatoId: string) {
  return tx.db
    .select(colunasEndereco)
    .from(contatoEndereco)
    .where(and(eq(contatoEndereco.empresaId, empresaId), eq(contatoEndereco.contatoId, contatoId), isNull(contatoEndereco.arquivadoEm)))
    .orderBy(desc(contatoEndereco.principal), asc(contatoEndereco.criadoEm), asc(contatoEndereco.id));
}

export function endereco(tx: Tx, empresaId: string, contatoId: string, id: string) {
  return tx.db
    .select(colunasEndereco)
    .from(contatoEndereco)
    .where(and(eq(contatoEndereco.empresaId, empresaId), eq(contatoEndereco.contatoId, contatoId), eq(contatoEndereco.id, id), isNull(contatoEndereco.arquivadoEm)))
    .then((r) => r[0] ?? null);
}

/** Tira o "principal" dos outros endereços ativos do contato (antes de marcar um novo). */
export function desmarcarPrincipal(tx: Tx, empresaId: string, contatoId: string) {
  return tx.db
    .update(contatoEndereco)
    .set({ principal: false, atualizadoEm: new Date() })
    .where(and(eq(contatoEndereco.empresaId, empresaId), eq(contatoEndereco.contatoId, contatoId), eq(contatoEndereco.principal, true), isNull(contatoEndereco.arquivadoEm)));
}

/** Extras ativos de vários contatos de uma vez (exportação): contatoId → telefones e e-mails. */
export async function canaisDeVarios(tx: Tx, empresaId: string, contatoIds: string[]) {
  const mapa = new Map<string, { telefones: string[]; emails: string[] }>();
  if (!contatoIds.length) return mapa;
  const linhas = await tx.db
    .select({ contatoId: contatoCanal.contatoId, tipo: contatoCanal.tipo, valor: contatoCanal.valor })
    .from(contatoCanal)
    .where(and(eq(contatoCanal.empresaId, empresaId), inArray(contatoCanal.contatoId, contatoIds), isNull(contatoCanal.arquivadoEm)))
    .orderBy(asc(contatoCanal.criadoEm), asc(contatoCanal.id));
  for (const l of linhas) {
    const item = mapa.get(l.contatoId) ?? { telefones: [], emails: [] };
    (l.tipo === "telefone" ? item.telefones : item.emails).push(l.valor);
    mapa.set(l.contatoId, item);
  }
  return mapa;
}
