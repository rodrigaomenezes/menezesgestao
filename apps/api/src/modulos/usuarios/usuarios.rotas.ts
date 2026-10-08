import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AtualizarUsuarioEntrada,
  ConvidarEntrada,
  ConviteCriadoDto,
  EquipeDto,
  EquipeEntrada,
  FiltroLista,
  Ok,
  OpcoesUsuarioDto,
  ParamId,
  UsuarioDto,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoUsuarios } from "./usuarios.servico.js";

export const rotasUsuarios =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const usuarios = criarServicoUsuarios(s);
    const acesso = (acao: "ver" | "criar" | "editar" | "arquivar") => ({ acesso: { modulo: "usuarios" as const, acao } });
    const tags = ["Usuários"];

    app.get(
      "/api/usuarios",
      { config: acesso("ver"), schema: { tags, summary: "Listar pessoas (conforme o escopo)", querystring: FiltroLista, response: { 200: pagina(UsuarioDto) } } },
      async (req) => usuarios.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    app.get(
      "/api/usuarios/opcoes",
      { config: acesso("ver"), schema: { tags, summary: "Perfis, unidades e equipes para formulários", response: { 200: OpcoesUsuarioDto } } },
      async (req) => usuarios.opcoes(exigirEmpresa(req)),
    );

    app.get(
      "/api/usuarios/:id",
      { config: acesso("ver"), schema: { tags, summary: "Ver uma pessoa", params: ParamId, response: { 200: UsuarioDto } } },
      async (req) => usuarios.obter(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );

    app.post(
      "/api/convites",
      { config: acesso("criar"), schema: { tags, summary: "Convidar pessoa por e-mail", body: ConvidarEntrada, response: { 201: ConviteCriadoDto } } },
      async (req, reply) => reply.status(201).send(await usuarios.convidarPessoa(exigirEmpresa(req), origemDe(req), req.body)),
    );

    app.patch(
      "/api/usuarios/:id",
      { config: acesso("editar"), schema: { tags, summary: "Trocar perfil, unidade ou equipe", params: ParamId, body: AtualizarUsuarioEntrada, response: { 200: UsuarioDto } } },
      async (req) => usuarios.atualizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/usuarios/:id/${rota}`,
        { config: acesso("arquivar"), schema: { tags, summary: arquivar ? "Arquivar pessoa" : "Restaurar pessoa", params: ParamId, response: { 200: Ok } } },
        async (req) => {
          await usuarios.alternarArquivo(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, arquivar);
          return { ok: true as const };
        },
      );
    }

    const tagsEquipe = ["Equipes"];

    app.get(
      "/api/equipes",
      { config: acesso("ver"), schema: { tags: tagsEquipe, summary: "Listar equipes", querystring: FiltroLista, response: { 200: pagina(EquipeDto) } } },
      async (req) => usuarios.listarEquipes(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    app.post(
      "/api/equipes",
      { config: acesso("criar"), schema: { tags: tagsEquipe, summary: "Criar equipe", body: EquipeEntrada, response: { 201: EquipeDto } } },
      async (req, reply) => reply.status(201).send(await usuarios.criarEquipe(exigirEmpresa(req), origemDe(req), req.body)),
    );

    app.patch(
      "/api/equipes/:id",
      { config: acesso("editar"), schema: { tags: tagsEquipe, summary: "Alterar equipe", params: ParamId, body: EquipeEntrada.partial(), response: { 200: EquipeDto } } },
      async (req) => usuarios.atualizarEquipe(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/equipes/:id/${rota}`,
        { config: acesso("arquivar"), schema: { tags: tagsEquipe, summary: arquivar ? "Arquivar equipe" : "Restaurar equipe", params: ParamId, response: { 200: Ok } } },
        async (req) => {
          await usuarios.alternarArquivoEquipe(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, arquivar);
          return { ok: true as const };
        },
      );
    }
  };
