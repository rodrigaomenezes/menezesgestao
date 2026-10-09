// Rotas do monitoramento de qualidade e das pesquisas (com as rotas públicas da pesquisa).
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AtualizarCriterioEntrada,
  AtualizarPesquisaEntrada,
  AvaliacaoDto,
  AvaliacaoEntrada,
  CriterioDto,
  CriterioEntrada,
  FiltroAvaliacoes,
  FiltroLista,
  Ok,
  ParamId,
  ParamToken,
  PesquisaDto,
  PesquisaEntrada,
  PesquisaPublicaDto,
  RespostaPublicaEntrada,
  ResultadoPesquisaDto,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoPesquisa } from "../pesquisa/pesquisa.servico.js";
import { criarServicoQualidade } from "./qualidade.servico.js";

export const rotasQualidade =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const qualidade = criarServicoQualidade(s);
    const pesquisas = criarServicoPesquisa(s);

    {
      const tags = ["Qualidade"];
      const acesso = (acao: "ver" | "criar" | "editar" | "administrar") => ({ acesso: { modulo: "qualidade" as const, acao } });
      app.get("/api/qualidade/criterios", { config: acesso("ver"), schema: { tags, summary: "Critérios ativos", response: { 200: z.object({ itens: z.array(CriterioDto) }) } } }, async (req) =>
        qualidade.criterios(exigirEmpresa(req)),
      );
      app.post(
        "/api/qualidade/criterios",
        { config: acesso("administrar"), schema: { tags, summary: "Criar critério", body: CriterioEntrada, response: { 201: Ok } } },
        async (req, reply) => reply.status(201).send(await qualidade.salvarCriterio(exigirEmpresa(req), origemDe(req), null, req.body)),
      );
      app.patch(
        "/api/qualidade/criterios/:id",
        { config: acesso("administrar"), schema: { tags, summary: "Alterar ou arquivar critério", params: ParamId, body: AtualizarCriterioEntrada, response: { 200: Ok } } },
        async (req) => qualidade.salvarCriterio(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
      );
      app.get(
        "/api/avaliacoes",
        { config: acesso("ver"), schema: { tags, summary: "Avaliações (as minhas ou as da equipe)", querystring: FiltroAvaliacoes, response: { 200: pagina(AvaliacaoDto) } } },
        async (req) => qualidade.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.post(
        "/api/avaliacoes",
        { config: acesso("criar"), schema: { tags, summary: "Avaliar conversa ou ligação", body: AvaliacaoEntrada, response: { 201: AvaliacaoDto } } },
        async (req, reply) => reply.status(201).send(await qualidade.avaliar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
      );
      app.post(
        "/api/avaliacoes/:id/lida",
        { config: acesso("ver"), schema: { tags, summary: "Marcar o feedback como lido (pessoa avaliada)", params: ParamId, response: { 200: Ok } } },
        async (req) => qualidade.marcarLida(exigirEmpresa(req), origemDe(req), req.params.id),
      );
    }

    {
      const tags = ["Pesquisas"];
      const acesso = (acao: "ver" | "criar" | "editar") => ({ acesso: { modulo: "pesquisa" as const, acao } });
      app.get(
        "/api/pesquisas",
        { config: acesso("ver"), schema: { tags, summary: "Pesquisas", querystring: FiltroLista, response: { 200: pagina(PesquisaDto) } } },
        async (req) => pesquisas.listar(exigirEmpresa(req), req.query),
      );
      app.get(
        "/api/pesquisas/:id",
        { config: acesso("ver"), schema: { tags, summary: "Ver pesquisa", params: ParamId, response: { 200: PesquisaDto } } },
        async (req) => pesquisas.obter(exigirEmpresa(req), req.params.id),
      );
      app.post(
        "/api/pesquisas",
        { config: acesso("criar"), schema: { tags, summary: "Criar pesquisa (gera o link público)", body: PesquisaEntrada, response: { 201: PesquisaDto } } },
        async (req, reply) => reply.status(201).send(await pesquisas.criar(exigirEmpresa(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/pesquisas/:id",
        { config: acesso("editar"), schema: { tags, summary: "Alterar, encerrar ou arquivar pesquisa", params: ParamId, body: AtualizarPesquisaEntrada, response: { 200: PesquisaDto } } },
        async (req) => pesquisas.atualizar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
      );
      app.get(
        "/api/pesquisas/:id/resultados",
        { config: acesso("ver"), schema: { tags, summary: "Resultados agregados", params: ParamId, response: { 200: ResultadoPesquisaDto } } },
        async (req) => pesquisas.resultados(exigirEmpresa(req), req.params.id),
      );

      // Público: quem tem o link responde (sem login). Respostas não guardam IP nem identificam a pessoa.
      const publica = { acesso: { publica: true as const } };
      app.get(
        "/api/publico/pesquisas/:token",
        { config: publica, schema: { tags, summary: "Pesquisa pelo link público", params: ParamToken, response: { 200: PesquisaPublicaDto } } },
        async (req) => pesquisas.publica(req.params.token),
      );
      app.post(
        "/api/publico/pesquisas/:token/respostas",
        { config: publica, schema: { tags, summary: "Responder pesquisa pelo link público", params: ParamToken, body: RespostaPublicaEntrada, response: { 201: Ok } } },
        async (req, reply) => reply.status(201).send(await pesquisas.responder(req.params.token, req.body.respostas)),
      );
    }
  };
