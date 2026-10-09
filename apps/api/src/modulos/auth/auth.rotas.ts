import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AceitarConviteEntrada,
  ConviteConsulta,
  ConviteInfoDto,
  EntrarEntrada,
  EsqueciEntrada,
  EuDto,
  Ok,
  Paginacao,
  ParamId,
  RedefinirEntrada,
  SessaoDto,
  TrocarEmpresaEntrada,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { COOKIE_SESSAO, dispositivoDe, exigirContexto, opcoesCookieSessao } from "../acesso/acesso.js";
import { criarServicoAuth, type Cliente } from "./auth.servico.js";
import { resolvedorDominio } from "../marca/dominio.js";

const tags = ["Acesso"];

export const rotasAuth =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const auth = criarServicoAuth(s);
    const limiteLogin = { max: s.config.limiteLoginMinuto, timeWindow: "1 minute" };
    const publica = { acesso: { publica: true as const } };
    const publicaLimitada = { ...publica, rateLimit: limiteLogin };
    const autenticada = { acesso: { autenticada: true as const } };

    const cliente = (req: FastifyRequest): Cliente => ({
      ip: req.ip ?? null,
      dispositivo: dispositivoDe(req),
      tokenAtual: req.cookies[COOKIE_SESSAO],
    });
    const gravarSessao = (reply: FastifyReply, token: string) =>
      reply.setCookie(COOKIE_SESSAO, token, opcoesCookieSessao(s.config));

    app.post(
      "/api/auth/entrar",
      { config: publicaLimitada, schema: { tags, summary: "Entrar com e-mail e senha", body: EntrarEntrada, response: { 200: Ok } } },
      async (req, reply) => {
        // No endereço da empresa (subdomínio ou domínio próprio), entra direto nela.
        const doEndereco = req.body.empresaId ? null : await resolvedorDominio(s).porHost(req.headers.host);
        gravarSessao(reply, (await auth.entrar(cliente(req), { ...req.body, empresaId: req.body.empresaId ?? doEndereco?.id })).token);
        return { ok: true as const };
      },
    );

    app.get(
      "/api/auth/eu",
      { config: autenticada, schema: { tags, summary: "Quem está logado, empresa ativa e permissões", response: { 200: EuDto } } },
      async (req) => auth.eu(exigirContexto(req)),
    );

    app.post(
      "/api/auth/sair",
      { config: autenticada, schema: { tags, summary: "Sair (encerra a sessão)", response: { 200: Ok } } },
      async (req, reply) => {
        await auth.sair(cliente(req), exigirContexto(req));
        reply.clearCookie(COOKIE_SESSAO, { path: "/" });
        return { ok: true as const };
      },
    );

    app.post(
      "/api/auth/empresa-ativa",
      { config: autenticada, schema: { tags, summary: "Trocar de empresa sem sair", body: TrocarEmpresaEntrada, response: { 200: Ok } } },
      async (req) => {
        await auth.trocarEmpresa(cliente(req), exigirContexto(req), req.body.empresaId);
        return { ok: true as const };
      },
    );

    app.get(
      "/api/auth/sessoes",
      { config: autenticada, schema: { tags, summary: "Dispositivos conectados", querystring: Paginacao, response: { 200: pagina(SessaoDto) } } },
      async (req) => auth.listarSessoes(exigirContexto(req), req.query.cursor, req.query.limite),
    );

    app.delete(
      "/api/auth/sessoes/:id",
      { config: autenticada, schema: { tags, summary: "Encerrar um dispositivo", params: ParamId, response: { 200: Ok } } },
      async (req) => {
        await auth.encerrarSessao(cliente(req), exigirContexto(req), req.params.id);
        return { ok: true as const };
      },
    );

    app.post(
      "/api/auth/esqueci",
      { config: publicaLimitada, schema: { tags, summary: "Pedir link para nova senha", body: EsqueciEntrada, response: { 200: Ok } } },
      async (req) => {
        await auth.esqueciSenha(cliente(req), req.body.email);
        return { ok: true as const };
      },
    );

    app.post(
      "/api/auth/redefinir",
      { config: publicaLimitada, schema: { tags, summary: "Criar nova senha pelo link", body: RedefinirEntrada, response: { 200: Ok } } },
      async (req) => {
        await auth.redefinirSenha(cliente(req), req.body.token, req.body.senha);
        return { ok: true as const };
      },
    );

    app.get(
      "/api/auth/convite",
      { config: publica, schema: { tags, summary: "Dados do convite", querystring: ConviteConsulta, response: { 200: ConviteInfoDto } } },
      async (req) => auth.consultarConvite(req.query.token),
    );

    app.post(
      "/api/auth/aceitar-convite",
      { config: publicaLimitada, schema: { tags, summary: "Aceitar convite e entrar", body: AceitarConviteEntrada, response: { 200: Ok } } },
      async (req, reply) => {
        gravarSessao(reply, (await auth.aceitarConvite(cliente(req), req.body)).token);
        return { ok: true as const };
      },
    );
  };
