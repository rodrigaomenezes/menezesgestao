import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Servicos } from "../../app.js";
import { exigirEmpresa } from "../acesso/acesso.js";

const SaudeDto = z.object({
  ok: z.boolean(),
  time: z.string(),
  provedores: z.object({ avisos: z.enum(["ONLINE", "OFFLINE", "DEGRADED", "CONFIGURATION_ERROR"]) }),
});

export const rotasSistema =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const publica = { acesso: { publica: true as const } };
    const tags = ["Sistema"];

    app.get(
      "/api/health",
      { config: publica, schema: { tags, summary: "Saúde do servidor e dos provedores", response: { 200: SaudeDto } } },
      async () => ({ ok: true, time: new Date().toISOString(), provedores: { avisos: s.avisos.status() } }),
    );


    app.get(
      "/api/tempo-real",
      { config: { acesso: { autenticada: true } }, schema: { tags, summary: "Avisos em tempo real (SSE)", hide: true } },
      async (req, reply) => {
        await s.tempoReal.conectar(exigirEmpresa(req), reply);
      },
    );

    app.get(
      "/api/openapi.json",
      { config: publica, schema: { hide: true } },
      async () => app.swagger(),
    );
  };
