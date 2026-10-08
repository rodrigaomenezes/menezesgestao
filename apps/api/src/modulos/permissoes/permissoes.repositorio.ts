// Permissões do perfil na tabela permissao (perfil × módulo × ação × escopo).
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Permissoes } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { perfil, permissao, vinculo } from "../../infra/esquema.js";
import { condicaoCursor, lerCursor } from "../../infra/paginacao.js";
import { permissoesDeLinhas } from "../acesso/acesso.js";

export async function lerPermissoes(tx: Tx, perfilIds: string[]): Promise<Map<string, Permissoes>> {
  const mapa = new Map<string, Permissoes>(perfilIds.map((id) => [id, {}]));
  if (!perfilIds.length) return mapa;
  const linhas = await tx.db
    .select({ perfilId: permissao.perfilId, modulo: permissao.modulo, acao: permissao.acao, escopo: permissao.escopo })
    .from(permissao)
    .where(inArray(permissao.perfilId, perfilIds));
  const porPerfil = new Map<string, typeof linhas>();
  for (const l of linhas) porPerfil.set(l.perfilId, [...(porPerfil.get(l.perfilId) ?? []), l]);
  for (const [id, ls] of porPerfil) mapa.set(id, permissoesDeLinhas(ls));
  return mapa;
}

/** Substitui todas as permissões do perfil (o antes/depois vai para a auditoria de quem chamou). */
export async function gravarPermissoes(tx: Tx, empresaId: string, perfilId: string, p: Permissoes): Promise<void> {
  await tx.db.delete(permissao).where(and(eq(permissao.perfilId, perfilId), eq(permissao.empresaId, empresaId)));
  const linhas = Object.entries(p).flatMap(([modulo, acoes]) =>
    Object.entries(acoes ?? {}).map(([acao, escopo]) => ({ empresaId, perfilId, modulo, acao, escopo: escopo as string })),
  );
  if (linhas.length) await tx.db.insert(permissao).values(linhas);
}

export const colunasPerfil = {
  id: perfil.id,
  nome: perfil.nome,
  base: perfil.base,
  protegido: perfil.protegido,
  criadoEm: perfil.criadoEm,
  arquivadoEm: perfil.arquivadoEm,
};

export function buscarPerfil(tx: Tx, empresaId: string, id: string, somenteAtivo = false) {
  return tx.db
    .select(colunasPerfil)
    .from(perfil)
    .where(and(eq(perfil.id, id), eq(perfil.empresaId, empresaId), somenteAtivo ? isNull(perfil.arquivadoEm) : undefined))
    .then((r) => r[0] ?? null);
}

export function listarPerfis(
  tx: Tx,
  empresaId: string,
  f: { arquivados: "sim" | "nao"; busca?: string; cursor?: string; limite: number },
) {
  return tx.db
    .select(colunasPerfil)
    .from(perfil)
    .where(
      and(
        eq(perfil.empresaId, empresaId),
        f.arquivados === "sim" ? isNotNull(perfil.arquivadoEm) : isNull(perfil.arquivadoEm),
        f.busca ? ilike(perfil.nome, `%${f.busca}%`) : undefined,
        condicaoCursor(perfil.criadoEm, perfil.id, lerCursor(f.cursor)),
      ),
    )
    .orderBy(desc(perfil.criadoEm), desc(perfil.id))
    .limit(f.limite + 1);
}

export function inserirPerfil(
  tx: Tx,
  dados: { id?: string; empresaId: string; nome: string; base: string | null; protegido?: boolean; criadoPor: string | null },
) {
  return tx.db.insert(perfil).values(dados).returning(colunasPerfil).then((r) => r[0]);
}

export function atualizarPerfil(tx: Tx, empresaId: string, id: string, dados: { nome?: string; arquivadoEm?: Date | null }) {
  return tx.db
    .update(perfil)
    .set({ ...dados, atualizadoEm: new Date() })
    .where(and(eq(perfil.id, id), eq(perfil.empresaId, empresaId)));
}

export function contarVinculosAtivosDoPerfil(tx: Tx, perfilId: string) {
  return tx.db
    .select({ total: count() })
    .from(vinculo)
    .where(and(eq(vinculo.perfilId, perfilId), isNull(vinculo.arquivadoEm)))
    .then((r) => r[0].total);
}
