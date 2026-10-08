import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Servicos } from "../app.js";
import { comEmpresa } from "../db/banco.js";
import { notificacao } from "../db/esquema.js";
import { exigirEmpresa } from "../nucleo/acesso.js";
import { naoEncontrado } from "../nucleo/erros.js";
import { condicaoCursor, esquemaPaginacao, lerCursor, montarPagina } from "../nucleo/paginacao.js";

// Notificações são sempre pessoais: cada um vê só as suas, em qualquer perfil.
export const rotasNotificacoes =
  (s: Servicos): FastifyPluginAsync =>
  async (app) => {
    const autenticada = { config: { acesso: { autenticada: true as const } } };

    app.get("/api/notificacoes", autenticada, async (req) => {
      const ctx = exigirEmpresa(req);
      const { cursor, limite } = esquemaPaginacao.parse(req.query);
      return comEmpresa(s.banco, ctx.empresaId, async (tx) => {
        const minhas = eq(notificacao.usuarioId, ctx.usuarioId);
        const linhas = await tx.db
          .select()
          .from(notificacao)
          .where(and(minhas, condicaoCursor(notificacao.criadoEm, notificacao.id, lerCursor(cursor))))
          .orderBy(desc(notificacao.criadoEm), desc(notificacao.id))
          .limit(limite + 1);
        const [{ total }] = await tx.db
          .select({ total: count() })
          .from(notificacao)
          .where(and(minhas, isNull(notificacao.lidaEm)));
        return { ...montarPagina(linhas, limite), naoLidas: total };
      });
    });

    app.post("/api/notificacoes/:id/lida", autenticada, async (req) => {
      const ctx = exigirEmpresa(req);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      await comEmpresa(s.banco, ctx.empresaId, async (tx) => {
        const lidas = await tx.db
          .update(notificacao)
          .set({ lidaEm: new Date() })
          .where(and(eq(notificacao.id, id), eq(notificacao.usuarioId, ctx.usuarioId)))
          .returning({ id: notificacao.id });
        if (!lidas.length) throw naoEncontrado("Notificação");
      });
      return { ok: true };
    });

    app.post("/api/notificacoes/lidas", autenticada, async (req) => {
      const ctx = exigirEmpresa(req);
      await comEmpresa(s.banco, ctx.empresaId, (tx) =>
        tx.db
          .update(notificacao)
          .set({ lidaEm: new Date() })
          .where(and(eq(notificacao.usuarioId, ctx.usuarioId), isNull(notificacao.lidaEm))),
      );
      return { ok: true };
    });
  };
