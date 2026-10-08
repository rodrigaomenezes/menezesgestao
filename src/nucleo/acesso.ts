// Controle de acesso no servidor. Toda rota /api declara o que exige em `config.acesso`:
//   { publica: true }                 — sem login (ex.: entrar, saúde)
//   { autenticada: true }             — qualquer pessoa logada
//   { modulo, acao }                  — permissão do perfil na empresa ativa (com escopo)
// Rota sem declaração impede o servidor de subir.
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  limparPermissoes,
  moduloAtivo,
  temPermissao,
  type Acao,
  type Escopo,
  type Modulo,
  type Permissoes,
} from "../compartilhado/catalogo.js";
import { lerMarca, type Marca } from "../compartilhado/marca.js";
import type { Banco } from "../db/banco.js";
import type { Config } from "../config.js";
import { hashToken, iguaisSeguro } from "../seguranca/cripto.js";
import { ErroHttp, semPermissao, sessaoExpirada } from "./erros.js";
import type { Origem } from "./registro.js";

export type Acesso = { publica: true } | { autenticada: true } | { modulo: Modulo; acao: Acao };

export interface Contexto {
  sessaoId: string;
  usuarioId: string;
  nome: string;
  email: string;
  empresaId: string | null;
  empresaNome: string | null;
  marca: Marca | null;
  plano: string | null;
  modulos: string[];
  vinculoId: string | null;
  perfilId: string | null;
  perfilNome: string | null;
  unidadeId: string | null;
  equipeId: string | null;
  permissoes: Permissoes;
}

export type ContextoEmpresa = Contexto & { empresaId: string; vinculoId: string };

declare module "fastify" {
  interface FastifyContextConfig {
    acesso?: Acesso;
  }
  interface FastifyRequest {
    ctx: Contexto | null;
    /** Escopo concedido pela permissão exigida na rota. */
    escopo: Escopo | null;
  }
}

export const COOKIE_SESSAO = "mg_sessao";
export const COOKIE_CSRF = "mg_csrf";
export const CABECALHO_CSRF = "x-csrf-token";
export const DURACAO_SESSAO_DIAS = 30;

export function opcoesCookieSessao(config: Config) {
  return {
    path: "/",
    httpOnly: true,
    secure: config.appUrl.startsWith("https://"),
    sameSite: "lax" as const,
    maxAge: DURACAO_SESSAO_DIAS * 24 * 60 * 60,
  };
}

interface LinhaContexto {
  sessao_id: string;
  usuario_id: string;
  nome: string;
  email: string;
  ultimo_uso: Date;
  empresa_id: string | null;
  empresa_nome: string | null;
  marca: unknown;
  plano: string | null;
  modulos: string[] | null;
  vinculo_id: string | null;
  perfil_id: string | null;
  perfil_nome: string | null;
  unidade_id: string | null;
  equipe_id: string | null;
  permissoes: unknown;
}

async function carregarContexto(banco: Banco, config: Config, token: string): Promise<Contexto | null> {
  const { rows } = await banco.pool.query<LinhaContexto>(
    `SELECT s.id AS sessao_id, s.usuario_id, u.nome, u.email, s.ultimo_uso,
            e.id AS empresa_id, e.nome AS empresa_nome, e.marca, e.plano, e.modulos,
            v.id AS vinculo_id, p.id AS perfil_id, p.nome AS perfil_nome, v.unidade_id, v.equipe_id, p.permissoes
       FROM sessao s
       JOIN usuario u ON u.id = s.usuario_id
       LEFT JOIN vinculo v ON v.usuario_id = s.usuario_id AND v.empresa_id = s.empresa_id
                          AND v.status = 'ativo' AND v.arquivado_em IS NULL
       LEFT JOIN empresa e ON e.id = v.empresa_id AND e.arquivado_em IS NULL
       LEFT JOIN perfil p ON p.id = v.perfil_id
      WHERE s.token_hash = $1 AND s.encerrada_em IS NULL AND s.expira_em > now()`,
    [hashToken(config.sessionSecret, token)],
  );
  const l = rows[0];
  if (!l) return null;
  if (Date.now() - l.ultimo_uso.getTime() > 5 * 60_000) {
    await banco.pool.query("UPDATE sessao SET ultimo_uso = now() WHERE id = $1", [l.sessao_id]);
  }
  const temEmpresa = Boolean(l.empresa_id && l.vinculo_id);
  return {
    sessaoId: l.sessao_id,
    usuarioId: l.usuario_id,
    nome: l.nome,
    email: l.email,
    empresaId: temEmpresa ? l.empresa_id : null,
    empresaNome: temEmpresa ? l.empresa_nome : null,
    marca: temEmpresa ? lerMarca(l.marca) : null,
    plano: temEmpresa ? l.plano : null,
    modulos: temEmpresa ? (l.modulos ?? []) : [],
    vinculoId: temEmpresa ? l.vinculo_id : null,
    perfilId: temEmpresa ? l.perfil_id : null,
    perfilNome: temEmpresa ? l.perfil_nome : null,
    unidadeId: temEmpresa ? l.unidade_id : null,
    equipeId: temEmpresa ? l.equipe_id : null,
    permissoes: temEmpresa ? limparPermissoes(l.permissoes) : {},
  };
}

export function exigirContexto(req: FastifyRequest): Contexto {
  if (!req.ctx) throw sessaoExpirada();
  return req.ctx;
}

export function exigirEmpresa(req: FastifyRequest): ContextoEmpresa {
  const ctx = exigirContexto(req);
  if (!ctx.empresaId || !ctx.vinculoId) {
    throw new ErroHttp(403, "Escolha uma empresa para continuar. Se nenhuma aparecer, fale com o administrador.");
  }
  return ctx as ContextoEmpresa;
}

/** Escopo concedido pela rota (só existe em rotas com { modulo, acao }). */
export function exigirEscopo(req: FastifyRequest): Escopo {
  if (!req.escopo) throw new Error("Rota sem permissão de módulo declarada");
  return req.escopo;
}

export function dispositivoDe(req: FastifyRequest): string | null {
  const ua = req.headers["user-agent"];
  return ua ? ua.slice(0, 200) : null;
}

export function origemDe(req: FastifyRequest, empresaId?: string | null): Origem {
  return {
    empresaId: empresaId !== undefined ? empresaId : (req.ctx?.empresaId ?? null),
    atorId: req.ctx?.usuarioId ?? null,
    ip: req.ip ?? null,
    dispositivo: dispositivoDe(req),
  };
}

export interface RotaRegistrada {
  metodo: string;
  url: string;
  acesso: Acesso;
}

const METODOS_SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

export function registrarAcesso(app: FastifyInstance, banco: Banco, config: Config): RotaRegistrada[] {
  const rotas: RotaRegistrada[] = [];
  app.decorateRequest("ctx", null);
  app.decorateRequest("escopo", null);

  app.addHook("onRoute", (rota) => {
    if (!rota.url.startsWith("/api")) return;
    const acesso = rota.config?.acesso;
    if (!acesso) {
      throw new Error(`Rota sem declaração de acesso: ${String(rota.method)} ${rota.url}`);
    }
    const metodos = Array.isArray(rota.method) ? rota.method : [rota.method];
    for (const metodo of metodos) {
      if (metodo !== "HEAD") rotas.push({ metodo, url: rota.url, acesso });
    }
  });

  // Cookie do CSRF (padrão "double submit"): o front lê e devolve no cabeçalho em toda escrita.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.cookies[COOKIE_CSRF]) {
      const valor = randomBytes(24).toString("base64url");
      req.cookies[COOKIE_CSRF] = valor;
      reply.setCookie(COOKIE_CSRF, valor, {
        path: "/",
        httpOnly: false,
        secure: config.appUrl.startsWith("https://"),
        sameSite: "strict",
      });
    }
  });

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const acesso = req.routeOptions.config?.acesso;
    if (!acesso) return; // fora de /api (arquivos do front)

    if (!METODOS_SEGUROS.has(req.method)) {
      const cabecalho = req.headers[CABECALHO_CSRF];
      const cookie = req.cookies[COOKIE_CSRF];
      if (typeof cabecalho !== "string" || !cookie || !iguaisSeguro(cabecalho, cookie)) {
        throw new ErroHttp(403, "Não foi possível confirmar o envio. Recarregue a página e tente de novo.");
      }
    }

    const token = req.cookies[COOKIE_SESSAO];
    req.ctx = token ? await carregarContexto(banco, config, token) : null;
    if (token && !req.ctx) reply.clearCookie(COOKIE_SESSAO, { path: "/" });

    if ("publica" in acesso) return;
    const ctx = exigirContexto(req);
    if ("autenticada" in acesso) return;

    if (!ctx.empresaId) exigirEmpresa(req);
    if (!moduloAtivo(acesso.modulo, ctx.modulos)) {
      throw new ErroHttp(403, "Este módulo não está ativo no plano da empresa. Fale com o administrador.");
    }
    const escopo = temPermissao(ctx.permissoes, acesso.modulo, acesso.acao);
    if (!escopo) throw semPermissao();
    req.escopo = escopo;
  });

  return rotas;
}
