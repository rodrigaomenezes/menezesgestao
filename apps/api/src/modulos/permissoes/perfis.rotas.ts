import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { AtualizarPerfilEntrada, CriarPerfilEntrada, FiltroLista, Ok, ParamId, PerfilDto, pagina } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, origemDe } from "../acesso/acesso.js";
import { criarServicoPerfis } from "./perfis.servico.js";

const tags = ["Perfis e permissões"];

export const rotasPerfis =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const perfis = criarServicoPerfis(s);
    const ver = { acesso: { modulo: "usuarios" as const, acao: "ver" as const } };
    const administrar = { acesso: { modulo: "usuarios" as const, acao: "administrar" as const } };

    app.get(
      "/api/perfis",
      { config: ver, schema: { tags, summary: "Listar perfis", querystring: FiltroLista, response: { 200: pagina(PerfilDto) } } },
      async (req) => perfis.listar(exigirEmpresa(req), req.query),
    );

    app.get(
      "/api/perfis/:id",
      { config: ver, schema: { tags, summary: "Ver um perfil", params: ParamId, response: { 200: PerfilDto } } },
      async (req) => perfis.obter(exigirEmpresa(req), req.params.id),
    );

    app.post(
      "/api/perfis",
      { config: administrar, schema: { tags, summary: "Criar perfil a partir de outro", body: CriarPerfilEntrada, response: { 201: PerfilDto } } },
      async (req, reply) => reply.status(201).send(await perfis.criar(exigirEmpresa(req), origemDe(req), req.body)),
    );

    app.patch(
      "/api/perfis/:id",
      { config: administrar, schema: { tags, summary: "Alterar nome ou permissões", params: ParamId, body: AtualizarPerfilEntrada, response: { 200: PerfilDto } } },
      async (req) => perfis.atualizar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/perfis/:id/${rota}`,
        { config: administrar, schema: { tags, summary: arquivar ? "Arquivar perfil" : "Restaurar perfil", params: ParamId, response: { 200: Ok } } },
        async (req) => {
          await perfis.alternarArquivo(exigirEmpresa(req), origemDe(req), req.params.id, arquivar);
          return { ok: true as const };
        },
      );
    }
  };
