import type { FastifyPluginAsync } from "fastify";
import type { Servicos } from "../app.js";
import { MARCA_PADRAO } from "../compartilhado/marca.js";
import { exigirEmpresa } from "../nucleo/acesso.js";

export const rotasSistema =
  (s: Servicos): FastifyPluginAsync =>
  async (app) => {
    app.get("/api/health", { config: { acesso: { publica: true } } }, async () => ({
      ok: true,
      time: new Date().toISOString(),
    }));

    // Marca para a tela de entrada (antes do login) ou da empresa ativa.
    app.get("/api/marca", { config: { acesso: { publica: true } } }, async (req) => {
      const marca = req.ctx?.marca ?? MARCA_PADRAO;
      return { ...marca, nomeProduto: marca.nomeProduto ?? s.config.produtoNome };
    });

    app.get("/api/tempo-real", { config: { acesso: { autenticada: true } } }, async (req, reply) => {
      await s.tempoReal.conectar(exigirEmpresa(req), reply);
    });
  };
