// Rotas da caixa de entrada.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AtribuirEntrada,
  ConversaDetalheDto,
  ConversaDto,
  EnviarTextoEntrada,
  FiltroConversas,
  MensagemDto,
  NovaConversaEntrada,
  Ok,
  Paginacao,
  ParamId,
  StatusConversaEntrada,
  pagina,
} from "@mg/shared";
import { invalido } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { criarServicoConversas, LIMITE_MIDIA_ENVIO } from "./conversas.servico.js";
import { juntarDuplicadas } from "./juntar.js";
import type { ServicoEnvio } from "./envio.servico.js";

const Criada = z.object({ id: z.uuid() });

export const rotasConversas =
  (s: Servicos, arquivos: ProvedorArquivos, envio: ServicoEnvio): FastifyPluginAsyncZod =>
  async (app) => {
    const conversas = criarServicoConversas(s, arquivos, envio);
    const acesso = (acao: "ver" | "criar" | "editar" | "administrar") => ({ acesso: { modulo: "conversas" as const, acao } });
    const tags = ["Conversas"];

    app.get(
      "/api/conversas",
      { config: acesso("ver"), schema: { tags, summary: "Caixa de entrada", querystring: FiltroConversas, response: { 200: pagina(ConversaDto) } } },
      async (req) => conversas.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    app.post(
      "/api/conversas",
      { config: acesso("criar"), schema: { tags, summary: "Começar conversa com um contato", body: NovaConversaEntrada, response: { 200: ConversaDto } } },
      async (req) => conversas.iniciar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body),
    );

    app.get(
      "/api/conversas/:id",
      { config: acesso("ver"), schema: { tags, summary: "Ver conversa", params: ParamId, response: { 200: ConversaDetalheDto } } },
      async (req) => conversas.obter(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );

    app.get(
      "/api/conversas/:id/mensagens",
      { config: acesso("ver"), schema: { tags, summary: "Mensagens (mais recentes primeiro)", params: ParamId, querystring: Paginacao, response: { 200: pagina(MensagemDto) } } },
      async (req) => conversas.mensagens(exigirEmpresa(req), exigirEscopo(req), req.params.id, req.query.cursor, req.query.limite),
    );

    app.post(
      "/api/conversas/:id/mensagens",
      { config: acesso("editar"), schema: { tags, summary: "Enviar texto ou nota interna", params: ParamId, body: EnviarTextoEntrada, response: { 201: Criada } } },
      async (req, reply) => reply.status(201).send(await conversas.enviarTexto(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body)),
    );

    // Arquivo (imagem, documento, vídeo) ou áudio gravado na tela, por multipart: campo "arquivo" + "legenda" opcional.
    app.post(
      "/api/conversas/:id/midia",
      { config: acesso("editar"), schema: { tags, summary: "Enviar arquivo ou áudio", consumes: ["multipart/form-data"], params: ParamId, response: { 201: Criada } } },
      async (req, reply) => {
        if (!req.isMultipart()) throw invalido("Envie o arquivo como multipart/form-data (campo \"arquivo\").");
        let legenda: string | null = null;
        let arquivo: { nome: string; mime: string; conteudo: Buffer } | null = null;
        for await (const parte of req.parts({ limits: { fileSize: LIMITE_MIDIA_ENVIO, files: 1, fields: 2 } })) {
          if (parte.type === "field" && parte.fieldname === "legenda" && typeof parte.value === "string") legenda = parte.value.trim().slice(0, 1000) || null;
          if (parte.type === "file") {
            try {
              arquivo = { nome: (parte.filename || "arquivo").slice(0, 150), mime: parte.mimetype || "application/octet-stream", conteudo: await parte.toBuffer() };
            } catch {
              throw invalido("O arquivo passou de 16 MB, o limite do WhatsApp para mídia.");
            }
          }
        }
        if (!arquivo) throw invalido("Nenhum arquivo recebido.");
        return reply.status(201).send(await conversas.enviarMidia(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, { ...arquivo, legenda }));
      },
    );

    app.post(
      "/api/conversas/:id/lida",
      { config: acesso("ver"), schema: { tags, summary: "Marcar como lida", params: ParamId, response: { 200: Ok } } },
      async (req) => {
        await conversas.marcarLida(exigirEmpresa(req), exigirEscopo(req), req.params.id);
        return { ok: true as const };
      },
    );

    app.post(
      "/api/conversas/:id/atribuir",
      { config: acesso("editar"), schema: { tags, summary: "Atribuir, transferir ou devolver para a fila", params: ParamId, body: AtribuirEntrada, response: { 200: ConversaDto } } },
      async (req) => conversas.atribuir(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.usuarioId ?? null),
    );

    app.post(
      "/api/conversas/:id/status",
      { config: acesso("editar"), schema: { tags, summary: "Mudar status (aberta, aguardando, resolvida)", params: ParamId, body: StatusConversaEntrada, response: { 200: ConversaDto } } },
      async (req) => conversas.alterarStatus(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.status),
    );

    app.post(
      "/api/mensagens/:id/reenviar",
      { config: acesso("editar"), schema: { tags, summary: "Reenviar mensagem que falhou", params: ParamId, response: { 200: Ok } } },
      async (req) => {
        await conversas.reenviar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id);
        return { ok: true as const };
      },
    );

    // Mídia de uma mensagem: mesma checagem de acesso da conversa; nunca vai para cache compartilhado.
    app.get(
      "/api/mensagens/:id/midia",
      { config: acesso("ver"), schema: { tags, summary: "Arquivo da mensagem", params: ParamId } },
      async (req, reply) => {
        const m = await conversas.midia(exigirEmpresa(req), exigirEscopo(req), req.params.id);
        const nome = encodeURIComponent(m.nome);
        return reply
          .header("content-type", m.mime)
          .header("cache-control", "private, max-age=3600")
          .header("content-disposition", `${/^(image|audio|video)\//.test(m.mime) ? "inline" : "attachment"}; filename*=UTF-8''${nome}`)
          .header("x-content-type-options", "nosniff")
          .send(m.conteudo);
      },
    );

    app.post(
      "/api/conversas/juntar-duplicadas",
      { config: acesso("administrar"), schema: { tags, summary: "Juntar conversas duplicadas antigas", response: { 200: z.object({ juntadas: z.number().int() }) } } },
      async (req) => {
        const ctx = exigirEmpresa(req);
        return { juntadas: await juntarDuplicadas(s.banco, ctx.empresaId, ctx.usuarioId) };
      },
    );
  };
