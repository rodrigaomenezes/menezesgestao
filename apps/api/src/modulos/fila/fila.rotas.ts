// Rotas das filas de discagem ativa.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AdicionarItensEntrada,
  AtualizarFilaEntrada,
  FilaDto,
  FilaEntrada,
  FilaItemDto,
  FilaLoteDto,
  FiltroItensFila,
  Ok,
  ParamId,
  ProximoDto,
  RegistrarResultadoDto,
  RegistrarResultadoEntrada,
  ResultadoAdicionarDto,
  TipoBaseDto,
  TipoBaseEntrada,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoFila } from "./fila.servico.js";

export const rotasFila =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const filas = criarServicoFila(s);
    const acesso = (acao: "ver" | "criar" | "editar" | "administrar") => ({ acesso: { modulo: "fila" as const, acao } });
    const tags = ["Fila de ligações"];

    app.get(
      "/api/filas",
      { config: acesso("ver"), schema: { tags, summary: "Filas", querystring: z.object({ arquivadas: z.enum(["sim", "nao"]).default("nao") }), response: { 200: z.array(FilaDto) } } },
      async (req) => filas.listar(exigirEmpresa(req), req.query.arquivadas === "sim"),
    );
    app.get(
      "/api/filas/prontos",
      { config: acesso("ver"), schema: { tags, summary: "Quantos contatos estão prontos para ligar nas filas ativas", response: { 200: z.object({ prontos: z.number().int() }) } } },
      async (req) => ({ prontos: await filas.totalProntos(exigirEmpresa(req)) }),
    );
    app.post(
      "/api/filas",
      { config: acesso("administrar"), schema: { tags, summary: "Criar fila", body: FilaEntrada, response: { 201: FilaDto } } },
      async (req, reply) => reply.status(201).send(await filas.criar(exigirEmpresa(req), origemDe(req), req.body)),
    );
    app.get(
      "/api/filas/:id",
      { config: acesso("ver"), schema: { tags, summary: "Ver fila (com contagens)", params: ParamId, response: { 200: FilaDto } } },
      async (req) => filas.obter(exigirEmpresa(req), req.params.id),
    );
    app.patch(
      "/api/filas/:id",
      { config: acesso("administrar"), schema: { tags, summary: "Alterar, pausar, encerrar ou arquivar fila", params: ParamId, body: AtualizarFilaEntrada, response: { 200: FilaDto } } },
      async (req) => filas.atualizar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );
    app.get(
      "/api/filas/:id/itens",
      { config: acesso("ver"), schema: { tags, summary: "Contatos da fila", params: ParamId, querystring: FiltroItensFila, response: { 200: pagina(FilaItemDto) } } },
      async (req) => filas.itens(exigirEmpresa(req), exigirEscopo(req), req.params.id, req.query),
    );
    app.post(
      "/api/filas/:id/itens",
      { config: acesso("criar"), schema: { tags, summary: "Pôr contatos na fila", params: ParamId, body: AdicionarItensEntrada, response: { 200: ResultadoAdicionarDto } } },
      async (req) => filas.adicionar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.contatoIds),
    );
    app.get(
      "/api/filas/:id/lotes",
      { config: acesso("ver"), schema: { tags, summary: "Relatórios das importações que alimentaram a fila", params: ParamId, response: { 200: z.array(FilaLoteDto) } } },
      async (req) => filas.lotes(exigirEmpresa(req), req.params.id),
    );
    app.post(
      "/api/filas/:id/proximo",
      { config: acesso("editar"), schema: { tags, summary: "Pegar o próximo contato (reserva exclusiva)", params: ParamId, response: { 200: ProximoDto } } },
      async (req) => filas.proximo(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id),
    );
    app.post(
      "/api/fila-itens/:id/liberar",
      { config: acesso("editar"), schema: { tags, summary: "Devolver o contato reservado para a fila", params: ParamId, response: { 200: Ok } } },
      async (req) => {
        await filas.liberar(exigirEmpresa(req), origemDe(req), req.params.id);
        return { ok: true as const };
      },
    );
    app.post(
      "/api/fila-itens/:id/resultado",
      { config: acesso("editar"), schema: { tags, summary: "Registrar o resultado (reagenda, encerra, descarta ou converte)", params: ParamId, body: RegistrarResultadoEntrada, response: { 200: RegistrarResultadoDto } } },
      async (req) => filas.registrarResultado(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.get(
      "/api/tipos-base",
      { config: acesso("ver"), schema: { tags, summary: "Tipos de base", response: { 200: z.array(TipoBaseDto) } } },
      async (req) => filas.tiposBase(exigirEmpresa(req)),
    );
    app.post(
      "/api/tipos-base",
      { config: acesso("administrar"), schema: { tags, summary: "Criar tipo de base", body: TipoBaseEntrada, response: { 201: TipoBaseDto } } },
      async (req, reply) => reply.status(201).send(await filas.salvarTipoBase(exigirEmpresa(req), origemDe(req), null, req.body)),
    );
    app.patch(
      "/api/tipos-base/:id",
      { config: acesso("administrar"), schema: { tags, summary: "Renomear, arquivar ou restaurar tipo de base", params: ParamId, body: TipoBaseEntrada, response: { 200: TipoBaseDto } } },
      async (req) => filas.salvarTipoBase(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );
  };
