// Rotas da tela /demonstracao (abertas, mas exigem o acesso pela chave do servidor; sem a chave, 404).
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { AcessoDemonstracaoEntrada, EmpresaDemonstracaoDto, EntrarDemonstracaoEntrada, Ok, PainelDemonstracaoDto, ParamId, ParamSegmentoDemonstracao } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { COOKIE_SESSAO, dispositivoDe, opcoesCookieSessao } from "../acesso/acesso.js";
import { criarServicoAuth } from "../auth/auth.servico.js";
import { COOKIE_DEMONSTRACAO, FILA_DEMONSTRACAO, VALIDADE_ACESSO_H, criarServicoDemonstracao } from "./demonstracao.servico.js";
import { gerarEmpresaDemonstracao } from "./gerador.js";
import type { SegmentoDemonstracao } from "./roteiros.js";

const tags = ["Demonstração"];

export const rotasDemonstracao =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const demo = criarServicoDemonstracao(s, (segmento) => gerarEmpresaDemonstracao(s, segmento));
    const auth = criarServicoAuth(s);
    await s.jobs.trabalhar<{ id: string; segmento: SegmentoDemonstracao }>(FILA_DEMONSTRACAO, (d) => demo.processar(d.id, d.segmento));

    const publica = { acesso: { publica: true as const } };
    const limitada = { ...publica, rateLimit: { max: Math.max(5, s.config.limiteLoginMinuto), timeWindow: "1 minute" } };
    const acesso = (req: { cookies: Record<string, string | undefined> }) => demo.exigirAcesso(req.cookies[COOKIE_DEMONSTRACAO]);

    app.post(
      "/api/demonstracao/acesso",
      { config: limitada, schema: { tags, summary: "Abrir a demonstração com a chave do servidor", body: AcessoDemonstracaoEntrada, response: { 200: Ok } } },
      async (req, reply) => {
        reply.setCookie(COOKIE_DEMONSTRACAO, demo.emitirAcesso(req.body.chave), {
          ...opcoesCookieSessao(s.config),
          path: "/api/demonstracao",
          maxAge: VALIDADE_ACESSO_H * 3600,
        });
        return { ok: true as const };
      },
    );
    app.get(
      "/api/demonstracao",
      { config: publica, schema: { tags, summary: "Segmentos e empresas de exemplo", response: { 200: PainelDemonstracaoDto } } },
      async (req) => {
        acesso(req);
        return demo.painel();
      },
    );
    app.post(
      "/api/demonstracao/segmentos/:segmento",
      { config: publica, schema: { tags, summary: "Gerar (ou recriar) a empresa de exemplo do segmento", params: ParamSegmentoDemonstracao, response: { 202: EmpresaDemonstracaoDto } } },
      async (req, reply) => {
        acesso(req);
        return reply.status(202).send(await demo.pedir(req.params.segmento));
      },
    );
    app.post(
      "/api/demonstracao/:id/arquivar",
      { config: publica, schema: { tags, summary: "Arquivar a empresa de exemplo", params: ParamId, response: { 200: Ok } } },
      async (req) => {
        acesso(req);
        await demo.arquivar(req.params.id);
        return { ok: true as const };
      },
    );
    app.post(
      "/api/demonstracao/:id/entrar",
      { config: limitada, schema: { tags, summary: "Entrar na empresa de exemplo como dono, gestor, vendedor ou financeiro", params: ParamId, body: EntrarDemonstracaoEntrada, response: { 200: Ok } } },
      async (req, reply) => {
        acesso(req);
        const p = await demo.pessoaPara(req.params.id, req.body.papel);
        const { token } = await auth.entrarComo({ ip: req.ip ?? null, dispositivo: dispositivoDe(req), tokenAtual: req.cookies[COOKIE_SESSAO] }, p.usuarioId, p.empresaId);
        reply.setCookie(COOKIE_SESSAO, token, opcoesCookieSessao(s.config));
        return { ok: true as const };
      },
    );
  };
