import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, desc, eq, gte, like, lt } from "drizzle-orm";
import { AuditoriaDto, FiltroAuditoria, pagina, type Escopo } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comEmpresa } from "../../infra/banco.js";
import { auditoria, usuario } from "../../infra/esquema.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import { exigirEmpresa, exigirEscopo, type ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";

type Filtro = { atorId?: string; entidade?: string; acao?: string; de?: Date; ate?: Date; cursor?: string; limite: number };

/** Consulta da auditoria: só da empresa, só de quem o escopo deixa ver. */
async function listar(s: Servicos, ctx: ContextoEmpresa, escopo: Escopo, f: Filtro) {
  return comEmpresa(s.banco, ctx.empresaId, async (tx) => {
    const linhas = await tx.db
      .select({
        id: auditoria.id,
        acao: auditoria.acao,
        entidade: auditoria.entidade,
        entidadeId: auditoria.entidadeId,
        atorId: auditoria.atorId,
        atorNome: usuario.nome,
        antes: auditoria.antes,
        depois: auditoria.depois,
        ip: auditoria.ip,
        dispositivo: auditoria.dispositivo,
        criadoEm: auditoria.criadoEm,
      })
      .from(auditoria)
      .leftJoin(usuario, eq(usuario.id, auditoria.atorId))
      .where(
        and(
          eq(auditoria.empresaId, ctx.empresaId),
          filtroUsuariosVisiveis(ctx, escopo, auditoria.atorId),
          f.atorId ? eq(auditoria.atorId, f.atorId) : undefined,
          f.entidade ? eq(auditoria.entidade, f.entidade) : undefined,
          f.acao ? like(auditoria.acao, `${f.acao.replace(/[%_]/g, "")}%`) : undefined,
          f.de ? gte(auditoria.criadoEm, f.de) : undefined,
          f.ate ? lt(auditoria.criadoEm, f.ate) : undefined,
          condicaoCursor(auditoria.criadoEm, auditoria.id, lerCursor(f.cursor)),
        ),
      )
      .orderBy(desc(auditoria.criadoEm), desc(auditoria.id))
      .limit(f.limite + 1);
    return montarPagina(linhas, f.limite, (l) => ({ ...l, criadoEm: iso(l.criadoEm) }));
  });
}

export const rotasAuditoria =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/api/auditoria",
      {
        config: { acesso: { modulo: "auditoria", acao: "ver" } },
        schema: { tags: ["Auditoria"], summary: "Quem fez o quê, quando e de onde", querystring: FiltroAuditoria, response: { 200: pagina(AuditoriaDto) } },
      },
      async (req) => listar(s, exigirEmpresa(req), exigirEscopo(req), req.query),
    );
  };
