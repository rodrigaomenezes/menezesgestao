import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { MARCA_PADRAO, type CodigoErro } from "@mg/shared";
import type { Banco } from "./infra/banco.js";
import type { Config } from "./config.js";
import type { Jobs } from "./infra/jobs.js";
import { ErroApp } from "./infra/erros.js";
import type { ProvedorAvisos } from "./modulos/avisos/avisos.js";
import { registrarAcesso, type RotaRegistrada } from "./modulos/acesso/acesso.js";
import type { TempoReal } from "./modulos/eventos/tempo-real.js";
import { rotasAuth } from "./modulos/auth/auth.rotas.js";
import { rotasEmpresas } from "./modulos/empresas/empresas.rotas.js";
import { rotasUsuarios } from "./modulos/usuarios/usuarios.rotas.js";
import { rotasPerfis } from "./modulos/permissoes/perfis.rotas.js";
import { rotasAuditoria } from "./modulos/auditoria/auditoria.rotas.js";
import { rotasNotificacoes } from "./modulos/notificacoes/notificacoes.rotas.js";
import { rotasSistema } from "./modulos/sistema/sistema.rotas.js";
import { provedorArquivosBanco } from "./modulos/arquivos/armazenamento.js";
import { rotasConfiguracaoCrm } from "./modulos/crm/configuracao.rotas.js";
import { rotasContatos } from "./modulos/crm/contatos.rotas.js";
import { rotasOportunidades } from "./modulos/crm/oportunidades.rotas.js";
import { rotasTarefas } from "./modulos/crm/tarefas.rotas.js";
import { rotasImportacao } from "./modulos/crm/importacao.rotas.js";
import { FILA_IMPORTACAO, criarServicoImportacao } from "./modulos/crm/importacao.servico.js";
import { LIMITE_BYTES } from "./modulos/crm/planilha.js";
import { montarConversas } from "./modulos/conversas/modulo.js";
import { rotasFila } from "./modulos/fila/fila.rotas.js";
import { criarServicoTelefonia, rotasTelefonia } from "./modulos/telefonia/telefonia.rotas.js";

z.config(z.locales.pt());

export interface Servicos {
  config: Config;
  banco: Banco;
  jobs: Jobs;
  avisos: ProvedorAvisos;
  tempoReal: TempoReal;
}

// Devolvido dentro de um objeto: a instância do Fastify é "thenable" e seria desembrulhada pelo await.
export interface AppMontado {
  app: FastifyInstance;
  rotas: RotaRegistrada[];
}

const PASTA_WEB = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const LIMITE_JSON = 1024 * 1024; // 1 MB: arquivos vão por upload próprio.

export function ocultarTokens(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, "$1***");
}

function responderErro(reply: FastifyReply, status: number, code: CodigoErro, message: string, details?: Record<string, unknown>) {
  return reply.status(status).send({ error: { code, message, ...(details ? { details } : {}) } });
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
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  // Upload de arquivos (planilhas) fora do limite de 1 MB do JSON; um arquivo por envio.
  await app.register(multipart, { limits: { fileSize: Math.max(LIMITE_BYTES, 16 * 1024 * 1024), files: 1, fields: 5, parts: 6 } });
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
      new ErroApp(429, "LIMITE_EXCEDIDO", `Muitas requisições seguidas. Espere ${Math.ceil(ctx.ttl / 1000)} segundos e tente de novo.`),
  });
  // Documentação OpenAPI gerada dos mesmos esquemas que validam a API (/api/openapi.json).
  await app.register(swagger, {
    openapi: {
      info: { title: `${config.produtoNome} — API`, version: "0.1.0", description: "Contrato da API. Erros: { error: { code, message, details } }." },
    },
    transform: jsonSchemaTransform,
  });

  const rotas = registrarAcesso(app, servicos.banco, config);

  app.setErrorHandler((erro, req, reply) => {
    if (erro instanceof ErroApp) return responderErro(reply, erro.status, erro.codigo, erro.message, erro.detalhes);
    if (hasZodFastifySchemaValidationErrors(erro)) {
      const primeiro = erro.validation[0];
      const campo = primeiro?.instancePath.replace(/^\//, "").replaceAll("/", ".");
      return responderErro(reply, 400, "DADOS_INVALIDOS", campo ? `${campo}: ${primeiro.message}` : (primeiro?.message ?? "Dados inválidos."), {
        campos: erro.validation.map((v) => ({ campo: v.instancePath.replace(/^\//, ""), mensagem: v.message })),
      });
    }
    if (isResponseSerializationError(erro)) {
      req.log.error({ err: erro, url: ocultarTokens(req.url) }, "resposta fora do contrato (DTO)");
      return responderErro(reply, 500, "ERRO_INTERNO", "Algo deu errado do nosso lado. Tente de novo em instantes.");
    }
    const status = (erro as { statusCode?: number }).statusCode;
    if (status === 413) return responderErro(reply, 413, "CORPO_GRANDE", "O envio passou de 1 MB. Para arquivos, use o envio de arquivos.");
    if (status && status >= 400 && status < 500) {
      return responderErro(reply, status, "DADOS_INVALIDOS", "Não foi possível entender o pedido. Confira os dados e tente de novo.");
    }
    req.log.error({ err: erro }, "erro inesperado");
    return responderErro(reply, 500, "ERRO_INTERNO", "Algo deu errado do nosso lado. Tente de novo em instantes.");
  });

  await app.register(rotasSistema(servicos));
  await app.register(rotasAuth(servicos));
  await app.register(rotasEmpresas(servicos));
  await app.register(rotasUsuarios(servicos));
  await app.register(rotasPerfis(servicos));
  await app.register(rotasAuditoria(servicos));
  await app.register(rotasNotificacoes(servicos));

  const arquivos = provedorArquivosBanco(servicos.banco);
  await app.register(rotasConfiguracaoCrm(servicos));
  await app.register(rotasContatos(servicos));
  await app.register(rotasOportunidades(servicos));
  await app.register(rotasTarefas(servicos));
  await app.register(rotasImportacao(servicos, arquivos));

  await montarConversas(app, servicos, arquivos);
  await app.register(rotasFila(servicos));
  await app.register(rotasTelefonia(servicos, arquivos));
  // Retenção das gravações (LGPD): todo dia apaga o conteúdo das vencidas.
  const telefonia = criarServicoTelefonia(servicos, arquivos);
  await servicos.jobs.trabalhar("telefonia.retencao", async () => {
    await telefonia.aplicarRetencao();
  });
  await servicos.jobs.agendar("telefonia.retencao", "23 4 * * *");

  // Trabalhadores das filas dos módulos.
  const importacoes = criarServicoImportacao(servicos, arquivos);
  await servicos.jobs.trabalhar<{ empresaId: string; importacaoId: string }>(FILA_IMPORTACAO, (d) => importacoes.processar(d.empresaId, d.importacaoId));

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
      return responderErro(reply, 404, "NAO_ENCONTRADO", "Endereço não encontrado.");
    }
    // Rotas do front (SPA): devolve o index.html, que nunca vai para cache.
    reply.header("cache-control", "no-cache");
    return reply.sendFile("index.html");
  });

  return { app, rotas };
}
