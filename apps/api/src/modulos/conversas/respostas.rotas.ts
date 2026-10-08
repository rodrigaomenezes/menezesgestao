// Respostas rápidas (atalhos com variáveis) e mensagens automáticas (boas-vindas, fora do horário, follow-up).
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  AtualizarRespostaRapidaEntrada,
  AutomacaoDto,
  AutomacaoEntrada,
  ParamId,
  ParamTipoAutomacao,
  RespostaRapidaDto,
  RespostaRapidaEntrada,
  TIPOS_AUTOMACAO,
} from "@mg/shared";
import { comEmpresa } from "../../infra/banco.js";
import { automacao, respostaRapida } from "../../infra/esquema.js";
import { codigoPg, conflito, invalido, naoEncontrado } from "../../infra/erros.js";
import { iso } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, origemDe } from "../acesso/acesso.js";
import { registrar } from "../auditoria/registro.js";

const dtoResposta = (r: typeof respostaRapida.$inferSelect) => ({ id: r.id, atalho: r.atalho, texto: r.texto, arquivadoEm: iso(r.arquivadoEm) });

export const rotasRespostas =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const { banco } = s;
    const tags = ["Conversas — respostas e automações"];
    const ver = { acesso: { modulo: "conversas" as const, acao: "ver" as const } };
    const administrar = { acesso: { modulo: "conversas" as const, acao: "administrar" as const } };

    app.get(
      "/api/respostas-rapidas",
      { config: ver, schema: { tags, summary: "Respostas rápidas (ativas e arquivadas)", response: { 200: z.array(RespostaRapidaDto) } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        return comEmpresa(banco, ctx.empresaId, async (tx) =>
          (await tx.db.select().from(respostaRapida).where(eq(respostaRapida.empresaId, ctx.empresaId)).orderBy(asc(respostaRapida.atalho)).limit(500)).map(dtoResposta),
        );
      },
    );

    app.post(
      "/api/respostas-rapidas",
      { config: administrar, schema: { tags, summary: "Criar resposta rápida", body: RespostaRapidaEntrada, response: { 201: RespostaRapidaDto } } },
      async (req, reply) => {
        const ctx = exigirEmpresa(req);
        const r = await comEmpresa(banco, ctx.empresaId, async (tx) => {
          try {
            const [r] = await tx.db.insert(respostaRapida).values({ empresaId: ctx.empresaId, ...req.body, criadoPor: ctx.usuarioId }).returning();
            await registrar(tx, origemDe(req), { acao: "resposta_rapida.criada", entidade: "resposta_rapida", entidadeId: r.id, depois: req.body });
            return r;
          } catch (e) {
            if (codigoPg(e) === "23505") throw conflito(`Já existe uma resposta com o atalho /${req.body.atalho}.`);
            throw e;
          }
        });
        return reply.status(201).send(dtoResposta(r));
      },
    );

    app.patch(
      "/api/respostas-rapidas/:id",
      { config: administrar, schema: { tags, summary: "Alterar, arquivar ou restaurar resposta rápida", params: ParamId, body: AtualizarRespostaRapidaEntrada, response: { 200: RespostaRapidaDto } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        return comEmpresa(banco, ctx.empresaId, async (tx) => {
          const { arquivado, ...resto } = req.body;
          let r;
          try {
            [r] = await tx.db
              .update(respostaRapida)
              .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
              .where(and(eq(respostaRapida.id, req.params.id), eq(respostaRapida.empresaId, ctx.empresaId)))
              .returning();
          } catch (e) {
            if (codigoPg(e) === "23505") throw conflito("Já existe uma resposta ativa com este atalho.");
            throw e;
          }
          if (!r) throw naoEncontrado("Resposta rápida");
          await registrar(tx, origemDe(req), { acao: "resposta_rapida.atualizada", entidade: "resposta_rapida", entidadeId: r.id, depois: req.body });
          return dtoResposta(r);
        });
      },
    );

    app.get(
      "/api/automacoes",
      { config: administrar, schema: { tags, summary: "Mensagens automáticas", response: { 200: z.array(AutomacaoDto) } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        const linhas = await comEmpresa(banco, ctx.empresaId, (tx) => tx.db.select().from(automacao).where(eq(automacao.empresaId, ctx.empresaId)));
        return TIPOS_AUTOMACAO.map((tipo) => {
          const a = linhas.find((l) => l.tipo === tipo);
          return { tipo, texto: a?.texto ?? "", horas: a?.horas ?? null, ativa: a?.ativa ?? false, configurada: Boolean(a) };
        });
      },
    );

    app.put(
      "/api/automacoes/:tipo",
      { config: administrar, schema: { tags, summary: "Configurar mensagem automática", params: ParamTipoAutomacao, body: AutomacaoEntrada, response: { 200: AutomacaoDto } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        const { tipo } = req.params;
        if (tipo === "follow_up" && !req.body.horas) throw invalido("Diga depois de quantas horas sem resposta o follow-up é enviado.");
        return comEmpresa(banco, ctx.empresaId, async (tx) => {
          const horas = tipo === "follow_up" ? (req.body.horas ?? null) : null;
          const [a] = await tx.db
            .insert(automacao)
            .values({ empresaId: ctx.empresaId, tipo, texto: req.body.texto, horas, ativa: req.body.ativa, criadoPor: ctx.usuarioId })
            .onConflictDoUpdate({ target: [automacao.empresaId, automacao.tipo], set: { texto: req.body.texto, horas, ativa: req.body.ativa, atualizadoEm: new Date() } })
            .returning();
          await registrar(tx, origemDe(req), { acao: "automacao.configurada", entidade: "automacao", entidadeId: a.id, depois: { tipo, ativa: a.ativa, horas } });
          return { tipo, texto: a.texto, horas: a.horas, ativa: a.ativa, configurada: true };
        });
      },
    );

    // Lista curta para o atalho "/" no campo de mensagem (só ativas).
    app.get(
      "/api/respostas-rapidas/ativas",
      { config: ver, schema: { tags, summary: "Respostas rápidas ativas", response: { 200: z.array(RespostaRapidaDto) } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        return comEmpresa(banco, ctx.empresaId, async (tx) =>
          (
            await tx.db
              .select()
              .from(respostaRapida)
              .where(and(eq(respostaRapida.empresaId, ctx.empresaId), isNull(respostaRapida.arquivadoEm)))
              .orderBy(asc(respostaRapida.atalho))
              .limit(500)
          ).map(dtoResposta),
        );
      },
    );
  };
