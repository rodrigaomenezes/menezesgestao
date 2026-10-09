// Rotas dos canais (administração), simulador do modo demonstração e webhook da API oficial.
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsyncZod, ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  AtualizarCanalEntrada,
  CanalDto,
  CanalEntrada,
  CanalResumoDto,
  ConexaoDto,
  CredenciaisCloudEntrada,
  Ok,
  ParamId,
  SimularEntrada,
  normalizarTelefone,
} from "@mg/shared";
import { comEmpresa, comoSistema } from "../../infra/banco.js";
import { canal } from "../../infra/esquema.js";
import { ErroApp, invalido, naoEncontrado } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, origemDe } from "../acesso/acesso.js";
import { registrar } from "../auditoria/registro.js";
import { paraProvedor, tokenWebhook, type ServicoCanais } from "./canais.servico.js";
import type { ServicoEntrada } from "./entrada.servico.js";
import { assinaturaValida, interpretarWebhook } from "./provedores/cloud-api.js";

declare module "fastify" {
  interface FastifyRequest {
    corpoBruto?: Buffer;
  }
}

export const rotasCanais =
  (s: Servicos, canais: ServicoCanais, entrada: ServicoEntrada): FastifyPluginAsyncZod =>
  async (app) => {
    const tags = ["Conversas — canais"];
    const administrar = { acesso: { modulo: "conversas" as const, acao: "administrar" as const } };

    app.get(
      "/api/canais",
      { config: administrar, schema: { tags, summary: "Canais (com estado da conexão)", response: { 200: z.array(CanalDto) } } },
      async (req) => canais.listar(exigirEmpresa(req)),
    );

    app.get(
      "/api/canais/ativos",
      { config: { acesso: { modulo: "conversas", acao: "ver" } }, schema: { tags, summary: "Canais ativos (para iniciar conversa)", response: { 200: z.array(CanalResumoDto) } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        return comEmpresa(s.banco, ctx.empresaId, (tx) =>
          tx.db
            .select({ id: canal.id, nome: canal.nome, provedor: canal.provedor, status: canal.status })
            .from(canal)
            .where(and(eq(canal.empresaId, ctx.empresaId), isNull(canal.arquivadoEm)))
            .orderBy(asc(canal.criadoEm))
            .limit(100),
        );
      },
    );

    app.post(
      "/api/canais",
      { config: administrar, schema: { tags, summary: "Criar canal", body: CanalEntrada, response: { 201: CanalDto } } },
      async (req, reply) => reply.status(201).send(await canais.criar(exigirEmpresa(req), origemDe(req), req.body)),
    );

    app.patch(
      "/api/canais/:id",
      { config: administrar, schema: { tags, summary: "Alterar, arquivar ou restaurar canal", params: ParamId, body: AtualizarCanalEntrada, response: { 200: CanalDto } } },
      async (req) => canais.atualizar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.put(
      "/api/canais/:id/credenciais",
      { config: administrar, schema: { tags, summary: "Credenciais da API oficial (só entram, nunca saem)", params: ParamId, body: CredenciaisCloudEntrada, response: { 200: CanalDto } } },
      async (req) => canais.salvarCredenciais(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.post(
      "/api/canais/:id/conectar",
      { config: administrar, schema: { tags, summary: "Conectar (testa as credenciais ou gera o QR code)", params: ParamId, response: { 200: ConexaoDto } } },
      async (req) => canais.conectar(exigirEmpresa(req), origemDe(req), req.params.id),
    );

    app.post(
      "/api/canais/:id/desconectar",
      { config: administrar, schema: { tags, summary: "Desconectar", params: ParamId, response: { 200: ConexaoDto } } },
      async (req) => canais.desconectar(exigirEmpresa(req), origemDe(req), req.params.id),
    );

    app.get(
      "/api/canais/:id/estado",
      { config: administrar, schema: { tags, summary: "Estado da conexão (com o QR code da vez)", params: ParamId, response: { 200: ConexaoDto } } },
      async (req) => canais.estado(exigirEmpresa(req), req.params.id),
    );

    // Modo demonstração: o "celular do cliente" é esta rota.
    app.post(
      "/api/canais/:id/simular",
      { config: administrar, schema: { tags, summary: "Demonstração: simular mensagem chegando de um cliente", params: ParamId, body: SimularEntrada, response: { 200: Ok } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        const c = await comEmpresa(s.banco, ctx.empresaId, (tx) => canais.carregar(tx, ctx.empresaId, req.params.id));
        if (c.provedor !== "demonstracao") throw invalido("A simulação só existe em canais de demonstração.");
        const telefone = normalizarTelefone(req.body.telefone);
        if (!telefone) throw invalido("Telefone inválido. Use DDD + número, ex.: (11) 98888-7777.");
        const remetente = req.body.idExterno ?? `${telefone.slice(1)}@demo`;
        await entrada.processar(c, [
          {
            tipo: "mensagem",
            idExterno: req.body.idMensagem ?? `demo-entrada-${randomUUID()}`,
            remetente,
            idsAlternativos: [],
            telefone,
            nome: req.body.nome ?? null,
            conteudo: req.body.midia ? (req.body.midia.mime.startsWith("image/") ? "imagem" : req.body.midia.mime.startsWith("audio/") ? "audio" : "documento") : "texto",
            texto: req.body.texto ?? null,
            midia: req.body.midia ? { ref: { ...req.body.midia }, mime: req.body.midia.mime, nome: req.body.midia.nome } : null,
            em: new Date(),
          },
        ]);
        await comEmpresa(s.banco, ctx.empresaId, (tx) => registrar(tx, origemDe(req), { acao: "canal.simulacao", entidade: "canal", entidadeId: c.id }));
        return { ok: true as const };
      },
    );

    // Webhook da API oficial: escopo próprio para guardar o corpo bruto (a assinatura é sobre os bytes exatos).
    await app.register(async (escopo) => {
      const wh = escopo.withTypeProvider<ZodTypeProvider>();
      wh.removeContentTypeParser("application/json");
      wh.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 2 * 1024 * 1024 }, (req, corpo, pronto) => {
        req.corpoBruto = corpo as Buffer;
        try {
          pronto(null, JSON.parse((corpo as Buffer).toString("utf8")));
        } catch {
          pronto(new ErroApp(400, "DADOS_INVALIDOS", "Corpo do webhook inválido."), undefined);
        }
      });

      const ParamCanal = z.object({ canalId: z.uuid() });
      const buscarCanal = async (id: string) => {
        const [c] = await comoSistema(s.banco, (tx) => tx.db.select().from(canal).where(and(eq(canal.id, id), eq(canal.provedor, "cloud_api"), isNull(canal.arquivadoEm))));
        if (!c) throw naoEncontrado("Canal");
        return c;
      };

      // Verificação do endereço pela Meta (feita uma vez, ao cadastrar o webhook no painel).
      wh.get(
        "/api/webhooks/whatsapp/:canalId",
        {
          config: { acesso: { webhook: true }, rateLimit: false },
          schema: {
            tags: ["Webhooks"],
            summary: "Verificação do webhook (Meta)",
            params: ParamCanal,
            querystring: z.object({ "hub.mode": z.string().optional(), "hub.verify_token": z.string().optional(), "hub.challenge": z.string().max(200).optional() }),
          },
        },
        async (req, reply) => {
          const c = await buscarCanal(req.params.canalId);
          const q = req.query;
          if (q["hub.mode"] !== "subscribe" || q["hub.verify_token"] !== tokenWebhook(s.config, c.id) || !q["hub.challenge"]) {
            throw new ErroApp(403, "SEM_PERMISSAO", "Token de verificação do webhook não confere.");
          }
          return reply.type("text/plain").send(q["hub.challenge"]);
        },
      );

      wh.post(
        "/api/webhooks/whatsapp/:canalId",
        { config: { acesso: { webhook: true }, rateLimit: false }, schema: { tags: ["Webhooks"], summary: "Mensagens e status da API oficial (assinado)", params: ParamCanal, response: { 200: Ok } } },
        async (req) => {
          const c = await buscarCanal(req.params.canalId);
          const p = paraProvedor(s.config.crmChave, c);
          const segredo = p.credenciais?.appSecret;
          const assinatura = req.headers["x-hub-signature-256"];
          if (!segredo || !req.corpoBruto || !assinaturaValida(req.corpoBruto, typeof assinatura === "string" ? assinatura : undefined, segredo)) {
            throw new ErroApp(401, "NAO_AUTENTICADO", "Assinatura do webhook inválida.");
          }
          // Processa antes de responder: se falhar, a Meta reenvia (e o reenvio não duplica nada).
          await entrada.processar(c, interpretarWebhook(req.body, c.identificadorExterno));
          return { ok: true as const };
        },
      );
    });
  };
