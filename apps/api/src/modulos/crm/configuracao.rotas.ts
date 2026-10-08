import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AtualizarCampoEntrada,
  AtualizarEtapaEntrada,
  CampoPersonalizadoDto,
  CampoPersonalizadoEntrada,
  ConfiguracaoCrmDto,
  EtapaDto,
  EtapaEntrada,
  EtiquetaDto,
  EtiquetaEntrada,
  FunilDto,
  FunilEntrada,
  MotivoPerdaDto,
  MotivoPerdaEntrada,
  Ok,
  ParamId,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, origemDe } from "../acesso/acesso.js";
import { criarServicoConfiguracaoCrm } from "./configuracao.servico.js";

const Arquivar = z.object({ arquivado: z.boolean().optional() });

export const rotasConfiguracaoCrm =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const cfg = criarServicoConfiguracaoCrm(s);
    const ver = { acesso: { modulo: "crm" as const, acao: "ver" as const } };
    const administrar = { acesso: { modulo: "crm" as const, acao: "administrar" as const } };
    const tags = ["CRM — configuração"];

    app.get(
      "/api/crm/configuracao",
      { config: ver, schema: { tags, summary: "Funis, etapas, motivos, etiquetas, campos e responsáveis para os formulários", response: { 200: ConfiguracaoCrmDto } } },
      async (req) => cfg.obter(exigirEmpresa(req)),
    );

    app.get(
      "/api/crm/funis",
      { config: ver, schema: { tags, summary: "Funis e etapas (inclui arquivados)", response: { 200: z.array(FunilDto) } } },
      async (req) => cfg.listarFunis(exigirEmpresa(req)),
    );
    app.post(
      "/api/crm/funis",
      { config: administrar, schema: { tags, summary: "Criar funil", body: FunilEntrada, response: { 201: FunilDto } } },
      async (req, reply) => reply.status(201).send(await cfg.criarFunil(exigirEmpresa(req), origemDe(req), req.body)),
    );
    app.patch(
      "/api/crm/funis/:id",
      { config: administrar, schema: { tags, summary: "Alterar, arquivar ou restaurar funil", params: ParamId, body: FunilEntrada.partial().merge(Arquivar), response: { 200: Ok } } },
      async (req) => {
        await cfg.atualizarFunil(exigirEmpresa(req), origemDe(req), req.params.id, req.body);
        return { ok: true as const };
      },
    );

    app.post(
      "/api/crm/etapas",
      { config: administrar, schema: { tags, summary: "Criar etapa", body: EtapaEntrada, response: { 201: EtapaDto } } },
      async (req, reply) => reply.status(201).send(await cfg.criarEtapa(exigirEmpresa(req), origemDe(req), req.body)),
    );
    app.patch(
      "/api/crm/etapas/:id",
      { config: administrar, schema: { tags, summary: "Alterar, arquivar ou restaurar etapa", params: ParamId, body: AtualizarEtapaEntrada.merge(Arquivar), response: { 200: EtapaDto } } },
      async (req) => cfg.atualizarEtapa(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.get(
      "/api/crm/listas",
      {
        config: ver,
        schema: { tags, summary: "Etiquetas e motivos de perda (inclui arquivados)", response: { 200: z.object({ etiquetas: z.array(EtiquetaDto), motivosPerda: z.array(MotivoPerdaDto) }) } },
      },
      async (req) => cfg.listarEtiquetasEMotivos(exigirEmpresa(req)),
    );
    app.post(
      "/api/crm/etiquetas",
      { config: administrar, schema: { tags, summary: "Criar etiqueta", body: EtiquetaEntrada, response: { 201: EtiquetaDto } } },
      async (req, reply) => reply.status(201).send(await cfg.salvarEtiqueta(exigirEmpresa(req), origemDe(req), null, req.body)),
    );
    app.patch(
      "/api/crm/etiquetas/:id",
      { config: administrar, schema: { tags, summary: "Alterar, arquivar ou restaurar etiqueta", params: ParamId, body: EtiquetaEntrada.partial().merge(Arquivar), response: { 200: EtiquetaDto } } },
      async (req) => cfg.salvarEtiqueta(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );
    app.post(
      "/api/crm/motivos-perda",
      { config: administrar, schema: { tags, summary: "Criar motivo de perda", body: MotivoPerdaEntrada, response: { 201: MotivoPerdaDto } } },
      async (req, reply) => reply.status(201).send(await cfg.salvarMotivo(exigirEmpresa(req), origemDe(req), null, req.body)),
    );
    app.patch(
      "/api/crm/motivos-perda/:id",
      { config: administrar, schema: { tags, summary: "Alterar, arquivar ou restaurar motivo", params: ParamId, body: MotivoPerdaEntrada.partial().merge(Arquivar), response: { 200: MotivoPerdaDto } } },
      async (req) => cfg.salvarMotivo(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.get(
      "/api/crm/campos",
      { config: ver, schema: { tags, summary: "Campos personalizados (inclui arquivados)", response: { 200: z.array(CampoPersonalizadoDto) } } },
      async (req) => cfg.listarCampos(exigirEmpresa(req)),
    );
    app.post(
      "/api/crm/campos",
      { config: administrar, schema: { tags, summary: "Criar campo personalizado", body: CampoPersonalizadoEntrada, response: { 201: CampoPersonalizadoDto } } },
      async (req, reply) => reply.status(201).send(await cfg.criarCampo(exigirEmpresa(req), origemDe(req), req.body)),
    );
    app.patch(
      "/api/crm/campos/:id",
      { config: administrar, schema: { tags, summary: "Alterar, arquivar ou restaurar campo", params: ParamId, body: AtualizarCampoEntrada.merge(Arquivar), response: { 200: CampoPersonalizadoDto } } },
      async (req) => cfg.atualizarCampo(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );
  };
