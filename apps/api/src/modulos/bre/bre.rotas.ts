// Rotas do Motor BRE (fase 8.1). Módulo "bre" por plano; permissão checada em toda rota.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AnaliseBreDto,
  AtualizarMotivoBreakEntrada,
  AtualizarReentradaEntrada,
  BreakDto,
  ConfigBreDto,
  ConfigBreEntrada,
  EncerramentoBreEntrada,
  FiltroBreaks,
  FiltroReentradas,
  ItemFilaBreDto,
  MotivoBreakDto,
  MotivoBreakEntrada,
  Ok,
  Paginacao,
  ParamId,
  ReentradaDto,
  ReentradaEntrada,
  RegistroBreDto,
  RegistroBreEntrada,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoBre } from "./bre.servico.js";

export const FILA_BRE_DIARIA = "bre.classificar";
export const FILA_BRE_HORARIA = "bre.silencio";

export const rotasBre =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const bre = criarServicoBre(s);
    const tags = ["Motor BRE"];
    const acesso = (acao: "ver" | "criar" | "editar" | "administrar") => ({ acesso: { modulo: "bre" as const, acao } });

    app.get("/api/bre/config", { config: acesso("ver"), schema: { tags, summary: "Limites do motor BRE da empresa", response: { 200: ConfigBreDto } } }, async (req) =>
      bre.config(exigirEmpresa(req)),
    );
    app.put(
      "/api/bre/config",
      { config: acesso("administrar"), schema: { tags, summary: "Ajustar os limites do motor BRE (nova versão)", body: ConfigBreEntrada, response: { 200: ConfigBreDto } } },
      async (req) => bre.salvarConfig(exigirEmpresa(req), origemDe(req), req.body),
    );

    app.get(
      "/api/bre/motivos",
      { config: acesso("ver"), schema: { tags, summary: "Motivos de Break por categoria", response: { 200: z.object({ itens: z.array(MotivoBreakDto) }) } } },
      async (req) => bre.motivos(exigirEmpresa(req)),
    );
    app.post(
      "/api/bre/motivos",
      { config: acesso("administrar"), schema: { tags, summary: "Criar motivo de Break", body: MotivoBreakEntrada, response: { 201: Ok } } },
      async (req, reply) => reply.status(201).send(await bre.salvarMotivo(exigirEmpresa(req), origemDe(req), null, req.body)),
    );
    app.patch(
      "/api/bre/motivos/:id",
      { config: acesso("administrar"), schema: { tags, summary: "Renomear ou arquivar motivo de Break", params: ParamId, body: AtualizarMotivoBreakEntrada, response: { 200: Ok } } },
      async (req) => bre.salvarMotivo(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.post(
      "/api/bre/registros",
      { config: acesso("criar"), schema: { tags, summary: "Registrar a conversa (8 campos, Break e próximo passo)", body: RegistroBreEntrada, response: { 201: RegistroBreDto } } },
      async (req, reply) => reply.status(201).send(await bre.registrarConversa(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );
    app.post(
      "/api/bre/conversas/:id/analisar",
      { config: acesso("criar"), schema: { tags, summary: "Analisar a conversa com a IA (sugere; a pessoa confirma no registro)", params: ParamId, response: { 200: AnaliseBreDto } } },
      async (req) => bre.analisarConversa(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id),
    );
    app.get(
      "/api/bre/breaks",
      { config: acesso("ver"), schema: { tags, summary: "Breaks registrados", querystring: FiltroBreaks, response: { 200: pagina(BreakDto) } } },
      async (req) => bre.breaks(exigirEmpresa(req), exigirEscopo(req), req.query),
    );
    app.get(
      "/api/bre/fila-do-dia",
      { config: acesso("ver"), schema: { tags, summary: "Quem pode ser contatado hoje, já respeitando os limites", querystring: Paginacao, response: { 200: pagina(ItemFilaBreDto) } } },
      async (req) => bre.filaDoDia(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    app.get(
      "/api/bre/reentradas",
      { config: acesso("ver"), schema: { tags, summary: "Reentradas programadas", querystring: FiltroReentradas, response: { 200: pagina(ReentradaDto) } } },
      async (req) => bre.reentradas(exigirEmpresa(req), exigirEscopo(req), req.query),
    );
    app.post(
      "/api/bre/reentradas",
      { config: acesso("criar"), schema: { tags, summary: "Programar reentrada", body: ReentradaEntrada, response: { 201: z.object({ id: z.uuid() }) } } },
      async (req, reply) => reply.status(201).send(await bre.programarReentrada(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );
    app.patch(
      "/api/bre/reentradas/:id",
      { config: acesso("editar"), schema: { tags, summary: "Marcar reentrada como feita ou cancelada", params: ParamId, body: AtualizarReentradaEntrada, response: { 200: Ok } } },
      async (req) => bre.concluirReentrada(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.status),
    );

    app.post(
      "/api/bre/oportunidades/:id/encerrar",
      {
        config: acesso("editar"),
        schema: { tags, summary: "Encerramento guiado (critério + checklist)", params: ParamId, body: EncerramentoBreEntrada, response: { 200: z.object({ ok: z.literal(true), reentradaId: z.uuid().nullable() }) } },
      },
      async (req) => bre.encerrar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );
  };
