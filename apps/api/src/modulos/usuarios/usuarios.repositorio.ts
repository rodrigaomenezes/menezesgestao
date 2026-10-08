// Consultas de usuários (vínculos) e equipes, sempre dentro de comEmpresa (RLS ativo).
import { and, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Escopo } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { equipe, perfil, unidade, usuario, vinculo } from "../../infra/esquema.js";
import { condicaoCursor, lerCursor } from "../../infra/paginacao.js";
import { filtroUsuariosVisiveis, type QuemVe } from "../acesso/escopo.js";

const equipeDoVinculo = alias(equipe, "equipe_do_vinculo");
const gestor = alias(usuario, "gestor");

const colunasUsuario = {
  id: vinculo.id,
  usuarioId: usuario.id,
  nome: usuario.nome,
  email: usuario.email,
  status: vinculo.status,
  perfilId: vinculo.perfilId,
  perfilNome: perfil.nome,
  unidadeId: vinculo.unidadeId,
  unidadeNome: unidade.nome,
  equipeId: vinculo.equipeId,
  equipeNome: equipeDoVinculo.nome,
  criadoEm: vinculo.criadoEm,
  arquivadoEm: vinculo.arquivadoEm,
};

function consultaUsuarios(tx: Tx) {
  return tx.db
    .select(colunasUsuario)
    .from(vinculo)
    .innerJoin(usuario, eq(usuario.id, vinculo.usuarioId))
    .innerJoin(perfil, eq(perfil.id, vinculo.perfilId))
    .leftJoin(unidade, eq(unidade.id, vinculo.unidadeId))
    .leftJoin(equipeDoVinculo, eq(equipeDoVinculo.id, vinculo.equipeId));
}

export type LinhaUsuario = Awaited<ReturnType<ReturnType<typeof consultaUsuarios>["execute"]>>[number];

export interface FiltroLista {
  arquivados: "sim" | "nao";
  busca?: string;
  cursor?: string;
  limite: number;
}

export function listarUsuarios(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, f: FiltroLista) {
  return consultaUsuarios(tx)
    .where(
      and(
        eq(vinculo.empresaId, empresaId),
        filtroUsuariosVisiveis(quem, escopo, vinculo.usuarioId),
        f.arquivados === "sim" ? isNotNull(vinculo.arquivadoEm) : isNull(vinculo.arquivadoEm),
        f.busca ? or(ilike(usuario.nome, `%${f.busca}%`), ilike(usuario.email, `%${f.busca}%`)) : undefined,
        condicaoCursor(vinculo.criadoEm, vinculo.id, lerCursor(f.cursor)),
      ),
    )
    .orderBy(desc(vinculo.criadoEm), desc(vinculo.id))
    .limit(f.limite + 1);
}

/** Vínculo que a pessoa pode ver (empresa + escopo). */
export function buscarUsuarioVisivel(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, vinculoId: string) {
  return consultaUsuarios(tx)
    .where(and(eq(vinculo.id, vinculoId), eq(vinculo.empresaId, empresaId), filtroUsuariosVisiveis(quem, escopo, vinculo.usuarioId)))
    .then((r) => r[0] ?? null);
}

export function atualizarVinculo(
  tx: Tx,
  empresaId: string,
  vinculoId: string,
  dados: { perfilId?: string; unidadeId?: string | null; equipeId?: string | null; arquivadoEm?: Date | null },
) {
  return tx.db
    .update(vinculo)
    .set({ ...dados, atualizadoEm: new Date() })
    .where(and(eq(vinculo.id, vinculoId), eq(vinculo.empresaId, empresaId)));
}

export function perfilEhProtegido(tx: Tx, perfilId: string) {
  return tx.db
    .select({ protegido: perfil.protegido })
    .from(perfil)
    .where(eq(perfil.id, perfilId))
    .then((r) => r[0]?.protegido ?? false);
}

export function contarDonosAtivosExceto(tx: Tx, empresaId: string, vinculoId: string) {
  return tx.db
    .select({ total: count() })
    .from(vinculo)
    .innerJoin(perfil, eq(perfil.id, vinculo.perfilId))
    .where(
      and(
        eq(vinculo.empresaId, empresaId),
        eq(perfil.protegido, true),
        eq(vinculo.status, "ativo"),
        isNull(vinculo.arquivadoEm),
        ne(vinculo.id, vinculoId),
      ),
    )
    .then((r) => r[0].total);
}

/** Listas curtas para formulários (com teto). */
export async function opcoesDeFormulario(tx: Tx, empresaId: string) {
  const perfis = await tx.db
    .select({ id: perfil.id, nome: perfil.nome })
    .from(perfil)
    .where(and(eq(perfil.empresaId, empresaId), isNull(perfil.arquivadoEm)))
    .orderBy(perfil.nome)
    .limit(200);
  const unidades = await tx.db
    .select({ id: unidade.id, nome: unidade.nome })
    .from(unidade)
    .where(and(eq(unidade.empresaId, empresaId), isNull(unidade.arquivadoEm)))
    .orderBy(unidade.nome)
    .limit(200);
  const equipes = await tx.db
    .select({ id: equipe.id, nome: equipe.nome })
    .from(equipe)
    .where(and(eq(equipe.empresaId, empresaId), isNull(equipe.arquivadoEm)))
    .orderBy(equipe.nome)
    .limit(200);
  return { perfis, unidades, equipes };
}

// Equipes -----------------------------------------------------------------------------------------

const colunasEquipe = {
  id: equipe.id,
  nome: equipe.nome,
  unidadeId: equipe.unidadeId,
  unidadeNome: unidade.nome,
  gestorId: equipe.gestorId,
  gestorNome: gestor.nome,
  criadoEm: equipe.criadoEm,
  arquivadoEm: equipe.arquivadoEm,
};

function consultaEquipes(tx: Tx) {
  return tx.db
    .select(colunasEquipe)
    .from(equipe)
    .leftJoin(unidade, eq(unidade.id, equipe.unidadeId))
    .leftJoin(gestor, eq(gestor.id, equipe.gestorId));
}

export type LinhaEquipe = Awaited<ReturnType<ReturnType<typeof consultaEquipes>["execute"]>>[number];

/** Equipes visíveis conforme o escopo: as que a pessoa coordena ou integra, da unidade, ou todas. */
function filtroEquipesVisiveis(quem: QuemVe, escopo: Escopo) {
  const minha = quem.equipeId ? eq(equipe.id, quem.equipeId) : sql`false`;
  switch (escopo) {
    case "empresa":
      return sql`true`;
    case "unidade":
      return quem.unidadeId ? or(eq(equipe.unidadeId, quem.unidadeId), minha) : minha;
    case "equipe":
      return or(eq(equipe.gestorId, quem.usuarioId), minha);
    case "proprio":
      return minha;
  }
}

export function listarEquipes(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, f: FiltroLista) {
  return consultaEquipes(tx)
    .where(
      and(
        eq(equipe.empresaId, empresaId),
        filtroEquipesVisiveis(quem, escopo),
        f.arquivados === "sim" ? isNotNull(equipe.arquivadoEm) : isNull(equipe.arquivadoEm),
        f.busca ? ilike(equipe.nome, `%${f.busca}%`) : undefined,
        condicaoCursor(equipe.criadoEm, equipe.id, lerCursor(f.cursor)),
      ),
    )
    .orderBy(desc(equipe.criadoEm), desc(equipe.id))
    .limit(f.limite + 1);
}

export function buscarEquipeVisivel(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, id: string) {
  return consultaEquipes(tx)
    .where(and(eq(equipe.id, id), eq(equipe.empresaId, empresaId), filtroEquipesVisiveis(quem, escopo)))
    .then((r) => r[0] ?? null);
}

export function inserirEquipe(
  tx: Tx,
  dados: { empresaId: string; nome: string; unidadeId: string | null; gestorId: string | null; criadoPor: string },
) {
  return tx.db.insert(equipe).values(dados).returning({ id: equipe.id }).then((r) => r[0]);
}

export function atualizarEquipe(
  tx: Tx,
  empresaId: string,
  id: string,
  dados: { nome?: string; unidadeId?: string | null; gestorId?: string | null; arquivadoEm?: Date | null },
) {
  return tx.db
    .update(equipe)
    .set({ ...dados, atualizadoEm: new Date() })
    .where(and(eq(equipe.id, id), eq(equipe.empresaId, empresaId)));
}

/** O gestor precisa ter vínculo não arquivado nesta empresa. */
export function pessoaDaEmpresa(tx: Tx, empresaId: string, usuarioId: string) {
  return tx.db
    .select({ id: vinculo.id })
    .from(vinculo)
    .where(and(eq(vinculo.empresaId, empresaId), eq(vinculo.usuarioId, usuarioId), isNull(vinculo.arquivadoEm)))
    .then((r) => r.length > 0);
}
