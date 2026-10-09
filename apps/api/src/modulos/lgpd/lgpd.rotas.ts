import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { AnonimizarEntrada, DadosTitularDto, Ok, ParamId, RetencaoDto } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoLgpd } from "./lgpd.servico.js";

const tags = ["LGPD"];

export const rotasLgpd =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const lgpd = criarServicoLgpd(s);

    app.get(
      "/api/contatos/:id/dados-pessoais",
      {
        config: { acesso: { modulo: "crm", acao: "exportar" } },
        schema: { tags, summary: "Exportar tudo o que a empresa guarda sobre o contato (pedido do titular)", params: ParamId, response: { 200: DadosTitularDto } },
      },
      async (req, reply) => {
        const dados = await lgpd.exportar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id);
        reply.header("content-disposition", `attachment; filename="dados-pessoais-${req.params.id.slice(0, 8)}.json"`);
        reply.header("cache-control", "no-store");
        return dados;
      },
    );

    app.post(
      "/api/contatos/:id/anonimizar",
      {
        config: { acesso: { modulo: "crm", acao: "administrar" } },
        schema: { tags, summary: "Anonimizar o contato (sem volta): tira os dados pessoais e mantém os fatos", params: ParamId, body: AnonimizarEntrada, response: { 200: Ok } },
      },
      async (req) => {
        await lgpd.anonimizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id);
        return { ok: true as const };
      },
    );

    app.get(
      "/api/empresa/retencao",
      { config: { acesso: { modulo: "configuracoes", acao: "ver" } }, schema: { tags, summary: "Prazos de retenção da empresa", response: { 200: RetencaoDto } } },
      async (req) => lgpd.lerRetencao(exigirEmpresa(req)),
    );

    app.put(
      "/api/empresa/retencao",
      { config: { acesso: { modulo: "configuracoes", acao: "administrar" } }, schema: { tags, summary: "Definir os prazos de retenção", body: RetencaoDto, response: { 200: RetencaoDto } } },
      async (req) => lgpd.definirRetencao(exigirEmpresa(req), origemDe(req), req.body),
    );
  };
