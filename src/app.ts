import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import type { Banco } from "./db/banco.js";
import type { Config } from "./config.js";
import type { Jobs } from "./jobs/jobs.js";
import { registrarAcesso, type RotaRegistrada } from "./nucleo/acesso.js";
import { ErroHttp } from "./nucleo/erros.js";
import type { TempoReal } from "./nucleo/tempo-real.js";
import { rotasAuth } from "./rotas/auth.js";
import { rotasEmpresa } from "./rotas/empresa.js";
import { rotasUsuarios } from "./rotas/usuarios.js";
import { rotasPerfis } from "./rotas/perfis.js";
import { rotasAuditoria } from "./rotas/auditoria.js";
import { rotasNotificacoes } from "./rotas/notificacoes.js";
import { rotasSistema } from "./rotas/sistema.js";
import { MARCA_PADRAO } from "./compartilhado/marca.js";

z.config(z.locales.pt());

export interface Servicos {
  config: Config;
  banco: Banco;
  jobs: Jobs;
  tempoReal: TempoReal;
}

// Devolvido dentro de um objeto: a instância do Fastify é "thenable" e seria desembrulhada pelo await.
export interface AppMontado {
  app: FastifyInstance;
  rotas: RotaRegistrada[];
}

const PASTA_WEB = fileURLToPath(new URL("../dist/web/", import.meta.url));
const LIMITE_JSON = 1024 * 1024; // 1 MB: arquivos vão por upload próprio.

export function ocultarTokens(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, "$1***");
}

function mensagemZod(erro: z.ZodError): string {
  const primeiro = erro.issues[0];
  const campo = primeiro?.path.join(".");
  return campo ? `${campo}: ${primeiro.message}` : (primeiro?.message ?? "Dados inválidos.");
}

// Monta o app sem abrir porta, para os testes usarem app.inject().
export async function criarApp(servicos: Servicos): Promise<AppMontado> {
  const { config } = servicos;
  const app = Fastify({
    logger: config.teste
      ? process.env.LOG_TESTE === "1" && { level: "error" }
      : {
          level: config.producao ? "info" : "debug",
          // Links de convite e de senha levam o token na URL: nunca vão para o log.
          serializers: {
            req: (req) => ({ method: req.method, url: ocultarTokens(req.url), remoteAddress: req.ip }),
          },
        },
    bodyLimit: LIMITE_JSON,
    // Em produção há exatamente um proxy na frente (Railway): confia só nele para descobrir o IP real.
    trustProxy: config.producao ? (_endereco: string, salto: number) => salto === 0 : false,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.producao ? [] : null,
      },
    },
    hsts: config.producao ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, {
    max: config.limiteReqMinuto,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, ctx) =>
      new ErroHttp(429, `Muitas requisições seguidas. Espere ${Math.ceil(ctx.ttl / 1000)} segundos e tente de novo.`),
  });

  const rotas = registrarAcesso(app, servicos.banco, config);

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ErroHttp) return reply.status(erro.status).send({ erro: erro.message });
    if (erro instanceof z.ZodError) return reply.status(400).send({ erro: mensagemZod(erro) });
    const status = (erro as { statusCode?: number }).statusCode;
    if (status === 413) return reply.status(413).send({ erro: "O envio passou de 1 MB. Para arquivos, use o envio de arquivos." });
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ erro: "Não foi possível entender o pedido. Confira os dados e tente de novo." });
    }
    req.log.error({ err: erro }, "erro inesperado");
    return reply.status(500).send({ erro: "Algo deu errado do nosso lado. Tente de novo em instantes." });
  });

  await app.register(rotasSistema(servicos));
  await app.register(rotasAuth(servicos));
  await app.register(rotasEmpresa(servicos));
  await app.register(rotasUsuarios(servicos));
  await app.register(rotasPerfis(servicos));
  await app.register(rotasAuditoria(servicos));
  await app.register(rotasNotificacoes(servicos));

  // Manifesto do PWA com o nome do produto da configuração (marca por domínio chega na fase 6).
  app.get("/manifest.webmanifest", async (_req, reply) => {
    reply.type("application/manifest+json");
    return {
      name: config.produtoNome,
      short_name: config.produtoNome,
      lang: "pt-BR",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: MARCA_PADRAO.corPrimaria,
      icons: [
        { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icones/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
  });

  const temFront = existsSync(PASTA_WEB + "index.html");
  if (temFront) {
    await app.register(fastifyStatic, { root: PASTA_WEB, wildcard: false, index: false });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.method !== "GET" || !temFront) {
      return reply.status(404).send({ erro: "Endereço não encontrado." });
    }
    // Rotas do front (SPA): devolve o index.html, que nunca vai para cache.
    reply.header("cache-control", "no-cache");
    return reply.sendFile("index.html");
  });

  return { app, rotas };
}
