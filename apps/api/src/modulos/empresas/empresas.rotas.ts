import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { AtualizarEmpresaEntrada, EmpresaDto, FiltroLista, Ok, ParamId, UnidadeDto, UnidadeEntrada, pagina } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, origemDe } from "../acesso/acesso.js";
import { criarServicoEmpresas } from "./empresas.servico.js";

export const rotasEmpresas =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const empresas = criarServicoEmpresas(s);
    const acesso = (acao: "ver" | "criar" | "editar" | "arquivar") => ({ acesso: { modulo: "configuracoes" as const, acao } });

    app.get(
      "/api/empresa",
      { config: acesso("ver"), schema: { tags: ["Empresa"], summary: "Dados da empresa ativa", response: { 200: EmpresaDto } } },
      async (req) => empresas.obter(exigirEmpresa(req)),
    );

    app.patch(
      "/api/empresa",
      {
        config: acesso("editar"),
        schema: { tags: ["Empresa"], summary: "Alterar nome, identificador, fuso ou marca", body: AtualizarEmpresaEntrada, response: { 200: EmpresaDto } },
      },
      async (req) => empresas.atualizar(exigirEmpresa(req), origemDe(req), req.body),
    );

    const tags = ["Unidades"];

    app.get(
      "/api/unidades",
      { config: acesso("ver"), schema: { tags, summary: "Listar unidades", querystring: FiltroLista, response: { 200: pagina(UnidadeDto) } } },
      async (req) => empresas.listarUnidades(exigirEmpresa(req), req.query),
    );

    app.post(
      "/api/unidades",
      { config: acesso("criar"), schema: { tags, summary: "Criar unidade", body: UnidadeEntrada, response: { 201: UnidadeDto } } },
      async (req, reply) => reply.status(201).send(await empresas.criarUnidade(exigirEmpresa(req), origemDe(req), req.body)),
    );

    app.patch(
      "/api/unidades/:id",
      { config: acesso("editar"), schema: { tags, summary: "Alterar unidade", params: ParamId, body: UnidadeEntrada.partial(), response: { 200: UnidadeDto } } },
      async (req) => empresas.atualizarUnidade(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/unidades/:id/${rota}`,
        { config: acesso("arquivar"), schema: { tags, summary: arquivar ? "Arquivar unidade" : "Restaurar unidade", params: ParamId, response: { 200: Ok } } },
        async (req) => {
          await empresas.alternarArquivoUnidade(exigirEmpresa(req), origemDe(req), req.params.id, arquivar);
          return { ok: true as const };
        },
      );
    }
  };
