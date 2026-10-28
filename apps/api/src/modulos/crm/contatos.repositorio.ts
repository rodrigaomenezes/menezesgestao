// Consultas de contatos (sempre dentro de comEmpresa, com o filtro de escopo pela carteira).
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Escopo } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { contato, contatoEtiqueta, etiqueta, evento, usuario } from "../../infra/esquema.js";
import { condicaoCursor, lerCursor } from "../../infra/paginacao.js";
import { filtroUsuariosVisiveis, type QuemVe } from "../acesso/escopo.js";
import { temTelefone } from "./telefones.js";

const responsavel = alias(usuario, "responsavel");
const organizacao = alias(contato, "organizacao");

const colunas = {
  id: contato.id,
  tipo: contato.tipo,
  nome: contato.nome,
  telefone: contato.telefone,
  email: contato.email,
  organizacaoId: contato.organizacaoId,
  organizacaoNome: organizacao.nome,
  responsavelId: contato.responsavelId,
  responsavelNome: responsavel.nome,
  origem: contato.origem,
  campos: contato.campos,
  naoContatar: contato.naoContatar,
  consentimentoEm: contato.consentimentoEm,
  // Do documento, só o tipo e o final (para a máscara); o cifrado e o hash nunca saem daqui.
  documentoTipo: contato.documentoTipo,
  documentoFinal: contato.documentoFinal,
  criadoEm: contato.criadoEm,
  atualizadoEm: contato.atualizadoEm,
  arquivadoEm: contato.arquivadoEm,
  anonimizadoEm: contato.anonimizadoEm,
};

function consulta(tx: Tx) {
  return tx.db
    .select(colunas)
    .from(contato)
    .leftJoin(responsavel, eq(responsavel.id, contato.responsavelId))
    .leftJoin(organizacao, eq(organizacao.id, contato.organizacaoId));
}

export type LinhaContato = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];

export const visivel = (quem: QuemVe, escopo: Escopo) => filtroUsuariosVisiveis(quem, escopo, contato.responsavelId);

export interface FiltroContatos {
  arquivados: "sim" | "nao";
  busca?: string;
  etiquetaId?: string;
  responsavelId?: string;
  tipo?: "pessoa" | "empresa";
  /** Hash do documento quando a busca é um CPF/CNPJ válido (calculado no serviço, que tem a chave). */
  documentoHash?: string;
  cursor?: string;
  limite: number;
}

/** Filtros da lista (e da exportação, que usa os mesmos): empresa, carteira, arquivados, busca, tipo, responsável, etiqueta. */
function condicoes(empresaId: string, quem: QuemVe, escopo: Escopo, f: Omit<FiltroContatos, "cursor" | "limite">) {
  const digitos = f.busca?.replace(/\D/g, "") ?? "";
  return and(
    eq(contato.empresaId, empresaId),
    visivel(quem, escopo),
    f.arquivados === "sim" ? isNotNull(contato.arquivadoEm) : isNull(contato.arquivadoEm),
    f.busca
      ? or(
          ilike(contato.nome, `%${f.busca}%`),
          ilike(contato.email, `%${f.busca}%`),
          digitos.length >= 4 ? ilike(contato.telefone, `%${digitos}%`) : undefined,
          // Telefones e e-mails extras também acham o contato.
          sql`EXISTS (SELECT 1 FROM contato_canal cc WHERE cc.contato_id = ${contato.id} AND cc.arquivado_em IS NULL AND (
            (cc.tipo = 'email' AND cc.valor ILIKE ${`%${f.busca}%`})${digitos.length >= 4 ? sql` OR (cc.tipo = 'telefone' AND cc.valor LIKE ${`%${digitos}%`})` : sql``}))`,
          f.documentoHash ? eq(contato.documentoHash, f.documentoHash) : undefined,
        )
      : undefined,
    f.tipo ? eq(contato.tipo, f.tipo) : undefined,
    f.responsavelId ? eq(contato.responsavelId, f.responsavelId) : undefined,
    f.etiquetaId ? sql`EXISTS (SELECT 1 FROM contato_etiqueta ce WHERE ce.contato_id = ${contato.id} AND ce.etiqueta_id = ${f.etiquetaId})` : undefined,
  );
}

export function listar(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, f: FiltroContatos) {
  return consulta(tx)
    .where(and(condicoes(empresaId, quem, escopo, f), condicaoCursor(contato.criadoEm, contato.id, lerCursor(f.cursor))))
    .orderBy(desc(contato.criadoEm), desc(contato.id))
    .limit(f.limite + 1);
}

/** Todos os que o filtro da lista mostra, até `maximo` + 1 (o + 1 diz que passou do limite). */
export function paraExportar(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, f: Omit<FiltroContatos, "cursor" | "limite">, maximo: number) {
  return consulta(tx)
    .where(condicoes(empresaId, quem, escopo, f))
    .orderBy(asc(contato.nome), asc(contato.id))
    .limit(maximo + 1);
}

export function buscarPorDocumento(tx: Tx, empresaId: string, hash: string) {
  return tx.db
    .select({ id: contato.id })
    .from(contato)
    .where(and(eq(contato.empresaId, empresaId), eq(contato.documentoHash, hash)))
    .then((r) => r[0] ?? null);
}

/** O documento cifrado (só para quem pode revelar ou para o pedido do titular). */
export function documentoCifrado(tx: Tx, empresaId: string, id: string) {
  return tx.db
    .select({ tipo: contato.documentoTipo, cifrado: contato.documentoCifrado })
    .from(contato)
    .where(and(eq(contato.empresaId, empresaId), eq(contato.id, id)))
    .then((r) => r[0] ?? null);
}

export function buscarVisivel(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, id: string) {
  return consulta(tx)
    .where(and(eq(contato.id, id), eq(contato.empresaId, empresaId), visivel(quem, escopo)))
    .then((r) => r[0] ?? null);
}

/** Visíveis entre os ids pedidos (ações em massa). */
export function idsVisiveis(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, ids: string[]) {
  return tx.db
    .select({ id: contato.id, responsavelId: contato.responsavelId, arquivadoEm: contato.arquivadoEm })
    .from(contato)
    .where(and(eq(contato.empresaId, empresaId), inArray(contato.id, ids), visivel(quem, escopo)));
}

/** Contato com o mesmo telefone (normalizado), como principal ou extra — inclusive arquivado. */
export function buscarPorTelefone(tx: Tx, empresaId: string, telefone: string) {
  return tx.db
    .select({ id: contato.id, responsavelId: contato.responsavelId })
    .from(contato)
    .where(and(eq(contato.empresaId, empresaId), temTelefone(empresaId, [telefone])))
    .then((r) => r[0] ?? null);
}

export async function etiquetasDe(tx: Tx, contatoIds: string[]) {
  const mapa = new Map<string, { id: string; nome: string; cor: string }[]>(contatoIds.map((id) => [id, []]));
  if (!contatoIds.length) return mapa;
  const linhas = await tx.db
    .select({ contatoId: contatoEtiqueta.contatoId, id: etiqueta.id, nome: etiqueta.nome, cor: etiqueta.cor })
    .from(contatoEtiqueta)
    .innerJoin(etiqueta, eq(etiqueta.id, contatoEtiqueta.etiquetaId))
    .where(and(inArray(contatoEtiqueta.contatoId, contatoIds), isNull(etiqueta.arquivadoEm)))
    .orderBy(asc(etiqueta.nome));
  for (const l of linhas) mapa.get(l.contatoId)?.push({ id: l.id, nome: l.nome, cor: l.cor });
  return mapa;
}

/** Etiquetas ativas da empresa entre os ids pedidos. */
export function etiquetasValidas(tx: Tx, empresaId: string, ids: string[]) {
  if (!ids.length) return Promise.resolve([] as { id: string }[]);
  return tx.db
    .select({ id: etiqueta.id })
    .from(etiqueta)
    .where(and(eq(etiqueta.empresaId, empresaId), inArray(etiqueta.id, ids), isNull(etiqueta.arquivadoEm)));
}

export async function trocarEtiquetas(tx: Tx, empresaId: string, contatoId: string, etiquetaIds: string[]) {
  await tx.db.delete(contatoEtiqueta).where(eq(contatoEtiqueta.contatoId, contatoId));
  if (etiquetaIds.length) {
    await tx.db.insert(contatoEtiqueta).values(etiquetaIds.map((etiquetaId) => ({ empresaId, contatoId, etiquetaId })));
  }
}

export function historico(tx: Tx, empresaId: string, contatoId: string, cursor: string | undefined, limite: number) {
  const ator = alias(usuario, "ator");
  return tx.db
    .select({
      id: evento.id,
      tipo: evento.tipo,
      entidade: evento.entidade,
      entidadeId: evento.entidadeId,
      atorNome: ator.nome,
      dados: evento.dados,
      criadoEm: evento.criadoEm,
    })
    .from(evento)
    .leftJoin(ator, eq(ator.id, evento.atorId))
    .where(and(eq(evento.empresaId, empresaId), eq(evento.contatoId, contatoId), condicaoCursor(evento.criadoEm, evento.id, lerCursor(cursor))))
    .orderBy(desc(evento.criadoEm), desc(evento.id))
    .limit(limite + 1);
}
