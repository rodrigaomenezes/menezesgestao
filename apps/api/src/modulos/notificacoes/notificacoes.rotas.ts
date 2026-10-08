import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { Ok, Paginacao, PaginaNotificacoes, ParamId } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comEmpresa } from "../../infra/banco.js";
import { notificacao } from "../../infra/esquema.js";
import { naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import { exigirEmpresa } from "../acesso/acesso.js";

// Notificações são sempre pessoais: cada um vê só as suas, em qualquer perfil.
export const rotasNotificacoes =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const config = { acesso: { autenticada: true as const } };
    const tags = ["Notificações"];

    app.get(
      "/api/notificacoes",
      { config, schema: { tags, summary: "Minhas notificações", querystring: Paginacao, response: { 200: PaginaNotificacoes } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        const { cursor, limite } = req.query;
        return comEmpresa(s.banco, ctx.empresaId, async (tx) => {
          const minhas = eq(notificacao.usuarioId, ctx.usuarioId);
          const linhas = await tx.db
            .select()
            .from(notificacao)
            .where(and(minhas, condicaoCursor(notificacao.criadoEm, notificacao.id, lerCursor(cursor))))
            .orderBy(desc(notificacao.criadoEm), desc(notificacao.id))
            .limit(limite + 1);
          const [{ total }] = await tx.db.select({ total: count() }).from(notificacao).where(and(minhas, isNull(notificacao.lidaEm)));
          const paginaDto = montarPagina(linhas, limite, (n) => ({
            id: n.id,
            titulo: n.titulo,
            texto: n.texto,
            link: n.link,
            lidaEm: iso(n.lidaEm),
            criadoEm: iso(n.criadoEm),
          }));
          return { ...paginaDto, naoLidas: total };
        });
      },
    );

    app.post(
      "/api/notificacoes/:id/lida",
      { config, schema: { tags, summary: "Marcar como lida", params: ParamId, response: { 200: Ok } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        await comEmpresa(s.banco, ctx.empresaId, async (tx) => {
          const lidas = await tx.db
            .update(notificacao)
            .set({ lidaEm: new Date() })
            .where(and(eq(notificacao.id, req.params.id), eq(notificacao.usuarioId, ctx.usuarioId)))
            .returning({ id: notificacao.id });
          if (!lidas.length) throw naoEncontrado("Notificação");
        });
        return { ok: true as const };
      },
    );

    app.post(
      "/api/notificacoes/lidas",
      { config, schema: { tags, summary: "Marcar todas como lidas", response: { 200: Ok } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        await comEmpresa(s.banco, ctx.empresaId, (tx) =>
          tx.db
            .update(notificacao)
            .set({ lidaEm: new Date() })
            .where(and(eq(notificacao.usuarioId, ctx.usuarioId), isNull(notificacao.lidaEm))),
        );
        return { ok: true as const };
      },
    );
  };
