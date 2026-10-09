import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AceitarConviteEntrada,
  CodigosRecuperacaoDto,
  ConfirmarCodigoEntrada,
  DuasEtapasDto,
  EntrarResposta,
  IniciarDuasEtapasDto,
  IniciarDuasEtapasEntrada,
  SegurancaEmpresaDto,
  SegurancaEmpresaEntrada,
  SenhaAtualEntrada,
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
import { COOKIE_SESSAO, dispositivoDe, exigirContexto, exigirEmpresa, opcoesCookieSessao, origemDe } from "../acesso/acesso.js";
import { criarServicoAuth, type Cliente } from "./auth.servico.js";
import { COOKIE_DESAFIO, VALIDADE_DESAFIO_MIN, criarServicoDuasEtapas } from "./duas-etapas.servico.js";
import { resolvedorDominio } from "../marca/dominio.js";

const tags = ["Acesso"];

export const rotasAuth =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const auth = criarServicoAuth(s);
    const duasEtapas = criarServicoDuasEtapas(s);
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
      { config: publicaLimitada, schema: { tags, summary: "Entrar com e-mail e senha", body: EntrarEntrada, response: { 200: EntrarResposta } } },
      async (req, reply) => {
        // No endereço da empresa (subdomínio ou domínio próprio), entra direto nela.
        const doEndereco = req.body.empresaId ? null : await resolvedorDominio(s).porHost(req.headers.host);
        const r = await auth.entrar(cliente(req), { ...req.body, empresaId: req.body.empresaId ?? doEndereco?.id });
        if ("desafio" in r) {
          // Falta o código: o desafio vai num cookie próprio, que só as rotas de duas etapas leem.
          reply.setCookie(COOKIE_DESAFIO, r.desafio.token, { ...opcoesCookieSessao(s.config), path: "/api/auth", maxAge: VALIDADE_DESAFIO_MIN * 60 });
          return { ok: true as const, duasEtapas: { metodo: r.desafio.metodo, destino: r.desafio.destino } };
        }
        gravarSessao(reply, r.token);
        return { ok: true as const };
      },
    );

    app.post(
      "/api/auth/duas-etapas",
      { config: publicaLimitada, schema: { tags, summary: "Segunda etapa do login: código do app, do e-mail ou de recuperação", body: ConfirmarCodigoEntrada, response: { 200: Ok } } },
      async (req, reply) => {
        const { token } = await auth.confirmarDuasEtapas(cliente(req), req.cookies[COOKIE_DESAFIO], req.body.codigo);
        reply.clearCookie(COOKIE_DESAFIO, { path: "/api/auth" });
        gravarSessao(reply, token);
        return { ok: true as const };
      },
    );

    app.post(
      "/api/auth/duas-etapas/reenviar",
      { config: publicaLimitada, schema: { tags, summary: "Mandar outro código por e-mail", response: { 200: Ok } } },
      async (req) => {
        await auth.reenviarCodigo(req.cookies[COOKIE_DESAFIO]);
        return { ok: true as const };
      },
    );

    // Segurança da conta (vale em todas as empresas da pessoa) ---------------------------------------------
    app.get(
      "/api/conta/duas-etapas",
      { config: autenticada, schema: { tags, summary: "Situação do login em duas etapas", response: { 200: DuasEtapasDto } } },
      async (req) => duasEtapas.estado(exigirContexto(req)),
    );

    app.post(
      "/api/conta/duas-etapas/iniciar",
      { config: { ...autenticada, rateLimit: limiteLogin }, schema: { tags, summary: "Começar a configurar (app ou e-mail)", body: IniciarDuasEtapasEntrada, response: { 200: IniciarDuasEtapasDto } } },
      async (req) => duasEtapas.iniciarConfiguracao(exigirContexto(req), req.body.metodo),
    );

    app.post(
      "/api/conta/duas-etapas/confirmar",
      { config: { ...autenticada, rateLimit: limiteLogin }, schema: { tags, summary: "Confirmar o primeiro código e ligar", body: ConfirmarCodigoEntrada, response: { 200: CodigosRecuperacaoDto } } },
      async (req) => duasEtapas.confirmarConfiguracao(exigirContexto(req), origemDe(req), req.body.codigo),
    );

    app.post(
      "/api/conta/duas-etapas/desligar",
      { config: { ...autenticada, rateLimit: limiteLogin }, schema: { tags, summary: "Desligar (pede a senha)", body: SenhaAtualEntrada, response: { 200: Ok } } },
      async (req) => {
        await duasEtapas.desligar(exigirContexto(req), origemDe(req), req.body.senha);
        return { ok: true as const };
      },
    );

    app.post(
      "/api/conta/duas-etapas/novos-codigos",
      { config: { ...autenticada, rateLimit: limiteLogin }, schema: { tags, summary: "Gerar novos códigos de recuperação (pede a senha)", body: SenhaAtualEntrada, response: { 200: CodigosRecuperacaoDto } } },
      async (req) => duasEtapas.novosCodigos(exigirContexto(req), origemDe(req), req.body.senha),
    );

    app.get(
      "/api/empresa/seguranca",
      { config: { acesso: { modulo: "configuracoes", acao: "ver" } }, schema: { tags, summary: "Regras de segurança da empresa", response: { 200: SegurancaEmpresaDto } } },
      async (req) => duasEtapas.exigenciaDaEmpresa(exigirEmpresa(req)),
    );

    app.put(
      "/api/empresa/seguranca",
      { config: { acesso: { modulo: "configuracoes", acao: "administrar" } }, schema: { tags, summary: "Exigir duas etapas de administradores ou de todos", body: SegurancaEmpresaEntrada, response: { 200: SegurancaEmpresaDto } } },
      async (req) => duasEtapas.definirExigencia(exigirEmpresa(req), origemDe(req), req.body.exigirDuasEtapas),
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
