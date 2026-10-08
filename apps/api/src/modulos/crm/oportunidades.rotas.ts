import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AtualizarOportunidadeEntrada,
  FiltroKanban,
  FiltroOportunidades,
  KanbanDto,
  MoverEtapaEntrada,
  Ok,
  OportunidadeDto,
  OportunidadeEntrada,
  ParamId,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoOportunidades } from "./oportunidades.servico.js";

export const rotasOportunidades =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const ops = criarServicoOportunidades(s);
    const acesso = (acao: "ver" | "criar" | "editar" | "arquivar") => ({ acesso: { modulo: "crm" as const, acao } });
    const tags = ["CRM — oportunidades"];

    app.get(
      "/api/funis/:id/kanban",
      { config: acesso("ver"), schema: { tags, summary: "Quadro kanban do funil", params: ParamId, querystring: FiltroKanban, response: { 200: KanbanDto } } },
      async (req) => ops.kanban(exigirEmpresa(req), exigirEscopo(req), req.params.id, req.query),
    );

    app.get(
      "/api/oportunidades",
      { config: acesso("ver"), schema: { tags, summary: "Listar oportunidades", querystring: FiltroOportunidades, response: { 200: pagina(OportunidadeDto) } } },
      async (req) => ops.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    app.get(
      "/api/oportunidades/:id",
      { config: acesso("ver"), schema: { tags, summary: "Ver oportunidade", params: ParamId, response: { 200: OportunidadeDto } } },
      async (req) => ops.obter(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );

    app.post(
      "/api/oportunidades",
      { config: acesso("criar"), schema: { tags, summary: "Criar oportunidade", body: OportunidadeEntrada, response: { 201: OportunidadeDto } } },
      async (req, reply) => reply.status(201).send(await ops.criar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );

    app.patch(
      "/api/oportunidades/:id",
      { config: acesso("editar"), schema: { tags, summary: "Alterar oportunidade", params: ParamId, body: AtualizarOportunidadeEntrada, response: { 200: OportunidadeDto } } },
      async (req) => ops.atualizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );

    app.post(
      "/api/oportunidades/:id/etapa",
      { config: acesso("editar"), schema: { tags, summary: "Mover de etapa (kanban)", params: ParamId, body: MoverEtapaEntrada, response: { 200: OportunidadeDto } } },
      async (req) => ops.moverEtapa(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/oportunidades/:id/${rota}`,
        { config: acesso("arquivar"), schema: { tags, summary: arquivar ? "Arquivar oportunidade" : "Restaurar oportunidade", params: ParamId, response: { 200: Ok } } },
        async (req) => {
          await ops.alternarArquivo(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, arquivar);
          return { ok: true as const };
        },
      );
    }
  };
