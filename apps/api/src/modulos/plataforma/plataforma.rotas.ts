// Rotas do painel da plataforma: só para a equipe em PLATAFORMA_ADMINS (checado em toda rota).
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { EmpresaPlataformaDto, EstenderTesteEntrada, FiltroEmpresasPlataforma, ParamId, PlanoPlataformaEntrada, SuspenderEntrada, pagina } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirPlataforma } from "../acesso/acesso.js";
import { criarServicoPlataforma } from "./plataforma.servico.js";

const autenticada = { acesso: { autenticada: true as const } };
const tags = ["Plataforma"];

export const rotasPlataforma =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const p = criarServicoPlataforma(s);
    app.get(
      "/api/plataforma/empresas",
      { config: autenticada, schema: { tags, summary: "Todas as empresas: assinatura, uso, atividade e saúde", querystring: FiltroEmpresasPlataforma, response: { 200: pagina(EmpresaPlataformaDto) } } },
      async (req) => {
        exigirPlataforma(req, s.config);
        return p.listar(req.query);
      },
    );
    app.post(
      "/api/plataforma/empresas/:id/estender-teste",
      { config: autenticada, schema: { tags, summary: "Estender o período de teste", params: ParamId, body: EstenderTesteEntrada, response: { 200: EmpresaPlataformaDto } } },
      async (req) => p.estenderTeste(exigirPlataforma(req, s.config), req.params.id, req.body.dias),
    );
    app.put(
      "/api/plataforma/empresas/:id/plano",
      { config: autenticada, schema: { tags, summary: "Trocar o plano da empresa", params: ParamId, body: PlanoPlataformaEntrada, response: { 200: EmpresaPlataformaDto } } },
      async (req) => p.trocarPlano(exigirPlataforma(req, s.config), req.params.id, req.body.plano),
    );
    app.post(
      "/api/plataforma/empresas/:id/suspender",
      { config: autenticada, schema: { tags, summary: "Suspender (fica só para consulta; nada é apagado)", params: ParamId, body: SuspenderEntrada, response: { 200: EmpresaPlataformaDto } } },
      async (req) => p.suspender(exigirPlataforma(req, s.config), req.params.id, req.body.motivo),
    );
    app.post(
      "/api/plataforma/empresas/:id/reativar",
      { config: autenticada, schema: { tags, summary: "Reativar empresa suspensa", params: ParamId, response: { 200: EmpresaPlataformaDto } } },
      async (req) => p.reativar(exigirPlataforma(req, s.config), req.params.id),
    );
  };
