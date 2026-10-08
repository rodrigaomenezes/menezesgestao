import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gte, like, lt } from "drizzle-orm";
import { z } from "zod";
import type { Servicos } from "../app.js";
import { comEmpresa } from "../db/banco.js";
import { auditoria, usuario } from "../db/esquema.js";
import { exigirEmpresa, exigirEscopo } from "../nucleo/acesso.js";
import { filtroUsuariosVisiveis } from "../nucleo/escopo.js";
import { condicaoCursor, esquemaPaginacao, lerCursor, montarPagina } from "../nucleo/paginacao.js";

export const rotasAuditoria =
  (s: Servicos): FastifyPluginAsync =>
  async (app) => {
    app.get("/api/auditoria", { config: { acesso: { modulo: "auditoria", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const escopo = exigirEscopo(req);
      const { cursor, limite } = esquemaPaginacao.parse(req.query);
      const filtro = z
        .object({
          atorId: z.uuid().optional(),
          entidade: z.string().max(40).optional(),
          acao: z.string().max(60).optional(),
          de: z.coerce.date().optional(),
          ate: z.coerce.date().optional(),
        })
        .parse(req.query);

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
              filtro.atorId ? eq(auditoria.atorId, filtro.atorId) : undefined,
              filtro.entidade ? eq(auditoria.entidade, filtro.entidade) : undefined,
              filtro.acao ? like(auditoria.acao, `${filtro.acao.replace(/[%_]/g, "")}%`) : undefined,
              filtro.de ? gte(auditoria.criadoEm, filtro.de) : undefined,
              filtro.ate ? lt(auditoria.criadoEm, filtro.ate) : undefined,
              condicaoCursor(auditoria.criadoEm, auditoria.id, lerCursor(cursor)),
            ),
          )
          .orderBy(desc(auditoria.criadoEm), desc(auditoria.id))
          .limit(limite + 1);
        return montarPagina(linhas, limite);
      });
    });
  };
