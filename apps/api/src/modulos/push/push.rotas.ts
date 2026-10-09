import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { CancelarPushEntrada, InscricaoPushEntrada, Ok, PushConfigDto } from "@mg/shared";
import { dispositivoDe, exigirContexto } from "../acesso/acesso.js";
import type { criarServicoPush } from "./push.js";

const tags = ["Avisos no celular"];

export const rotasPush =
  (push: ReturnType<typeof criarServicoPush>): FastifyPluginAsyncZod =>
  async (app) => {
    const autenticada = { acesso: { autenticada: true as const } };

    app.get(
      "/api/push/config",
      { config: autenticada, schema: { tags, summary: "Se os avisos no celular estão disponíveis (e a chave pública)", response: { 200: PushConfigDto } } },
      async () => ({ ativo: Boolean(push.chavePublica), chavePublica: push.chavePublica }),
    );

    app.post(
      "/api/push/inscricao",
      { config: autenticada, schema: { tags, summary: "Receber avisos neste aparelho", body: InscricaoPushEntrada, response: { 200: Ok } } },
      async (req) => {
        await push.inscrever(exigirContexto(req).usuarioId, req.body, dispositivoDe(req));
        return { ok: true as const };
      },
    );

    app.post(
      "/api/push/cancelar",
      { config: autenticada, schema: { tags, summary: "Parar os avisos neste aparelho", body: CancelarPushEntrada, response: { 200: Ok } } },
      async (req) => {
        await push.cancelar(exigirContexto(req).usuarioId, req.body.endpoint);
        return { ok: true as const };
      },
    );
  };
