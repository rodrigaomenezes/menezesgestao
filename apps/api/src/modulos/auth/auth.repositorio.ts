// Consultas de autenticação. Caminho do sistema (sem RLS): ainda não há empresa no contexto.
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../infra/banco.js";
import { empresa, sessao, tokenAcesso, usuario, vinculo } from "../../infra/esquema.js";
import { condicaoCursor, lerCursor } from "../../infra/paginacao.js";

export function buscarUsuarioPorEmail(tx: Tx, email: string) {
  return tx.db
    .select()
    .from(usuario)
    .where(sql`lower(${usuario.email}) = lower(${email})`)
    .then((r) => r[0] ?? null);
}

export function registrarFalhaLogin(tx: Tx, usuarioId: string, tentativas: number, bloqueadoAte: Date | null) {
  return tx.db.update(usuario).set({ tentativasFalhas: tentativas, bloqueadoAte }).where(eq(usuario.id, usuarioId));
}

export function zerarFalhasLogin(tx: Tx, usuarioId: string) {
  return tx.db.update(usuario).set({ tentativasFalhas: 0, bloqueadoAte: null }).where(eq(usuario.id, usuarioId));
}

/** Empresas em que a pessoa tem vínculo ativo. */
export function empresasDoUsuario(tx: Tx, usuarioId: string) {
  return tx.db
    .select({ id: empresa.id, nome: empresa.nome })
    .from(vinculo)
    .innerJoin(empresa, eq(empresa.id, vinculo.empresaId))
    .where(
      and(eq(vinculo.usuarioId, usuarioId), eq(vinculo.status, "ativo"), isNull(vinculo.arquivadoEm), isNull(empresa.arquivadoEm)),
    )
    .orderBy(vinculo.criadoEm)
    .limit(100);
}

export function inserirSessao(
  tx: Tx,
  dados: { tokenHash: string; usuarioId: string; empresaId: string; ip: string | null; dispositivo: string | null; expiraEm: Date },
) {
  return tx.db.insert(sessao).values(dados);
}

export function encerrarSessaoPorHash(tx: Tx, tokenHash: string) {
  return tx.db
    .update(sessao)
    .set({ encerradaEm: new Date() })
    .where(and(eq(sessao.tokenHash, tokenHash), isNull(sessao.encerradaEm)));
}

export function encerrarSessao(tx: Tx, sessaoId: string, usuarioId: string) {
  return tx.db
    .update(sessao)
    .set({ encerradaEm: new Date() })
    .where(and(eq(sessao.id, sessaoId), eq(sessao.usuarioId, usuarioId), isNull(sessao.encerradaEm)))
    .returning({ id: sessao.id });
}

export function encerrarTodasAsSessoes(tx: Tx, usuarioId: string) {
  return tx.db
    .update(sessao)
    .set({ encerradaEm: new Date() })
    .where(and(eq(sessao.usuarioId, usuarioId), isNull(sessao.encerradaEm)));
}

export function trocarEmpresaDaSessao(tx: Tx, sessaoId: string, empresaId: string) {
  return tx.db.update(sessao).set({ empresaId }).where(eq(sessao.id, sessaoId));
}

export function listarSessoesAtivas(tx: Tx, usuarioId: string, cursor: string | undefined, limite: number) {
  return tx.db
    .select({ id: sessao.id, dispositivo: sessao.dispositivo, ip: sessao.ip, criadoEm: sessao.criadoEm, ultimoUso: sessao.ultimoUso })
    .from(sessao)
    .where(
      and(
        eq(sessao.usuarioId, usuarioId),
        isNull(sessao.encerradaEm),
        gt(sessao.expiraEm, new Date()),
        condicaoCursor(sessao.criadoEm, sessao.id, lerCursor(cursor)),
      ),
    )
    .orderBy(desc(sessao.criadoEm), desc(sessao.id))
    .limit(limite + 1);
}

export function inserirToken(
  tx: Tx,
  dados: { tipo: "convite" | "recuperacao"; tokenHash: string; usuarioId: string; empresaId?: string | null; expiraEm: Date },
) {
  return tx.db.insert(tokenAcesso).values(dados);
}

/** Token válido (não usado, não vencido), travado até o fim da transação. */
export function buscarTokenValido(tx: Tx, tipo: "convite" | "recuperacao", tokenHash: string) {
  return tx.db
    .select()
    .from(tokenAcesso)
    .where(
      and(
        eq(tokenAcesso.tokenHash, tokenHash),
        eq(tokenAcesso.tipo, tipo),
        isNull(tokenAcesso.usadoEm),
        gt(tokenAcesso.expiraEm, new Date()),
      ),
    )
    .for("update")
    .then((r) => r[0] ?? null);
}

export function marcarTokenUsado(tx: Tx, tokenId: string) {
  return tx.db.update(tokenAcesso).set({ usadoEm: new Date() }).where(eq(tokenAcesso.id, tokenId));
}

export function definirSenha(tx: Tx, usuarioId: string, senhaHash: string, nome?: string) {
  return tx.db
    .update(usuario)
    .set({ senhaHash, tentativasFalhas: 0, bloqueadoAte: null, atualizadoEm: new Date(), ...(nome ? { nome } : {}) })
    .where(eq(usuario.id, usuarioId));
}

/** Convite pendente ligado ao token: vínculo "convidado", empresa ativa. */
export function buscarConvitePendente(tx: Tx, empresaId: string, usuarioId: string) {
  return tx.db
    .select({
      vinculoId: vinculo.id,
      convidadoPor: vinculo.convidadoPor,
      empresaNome: empresa.nome,
      email: usuario.email,
      nome: usuario.nome,
      senhaHash: usuario.senhaHash,
    })
    .from(vinculo)
    .innerJoin(empresa, eq(empresa.id, vinculo.empresaId))
    .innerJoin(usuario, eq(usuario.id, vinculo.usuarioId))
    .where(
      and(
        eq(vinculo.empresaId, empresaId),
        eq(vinculo.usuarioId, usuarioId),
        eq(vinculo.status, "convidado"),
        isNull(vinculo.arquivadoEm),
        isNull(empresa.arquivadoEm),
      ),
    )
    .then((r) => r[0] ?? null);
}

export function ativarVinculo(tx: Tx, vinculoId: string) {
  return tx.db.update(vinculo).set({ status: "ativo", atualizadoEm: new Date() }).where(eq(vinculo.id, vinculoId));
}
