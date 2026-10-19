// Início por pessoa (fase 7.6): cada um lê e grava só o próprio; qualquer perfil da empresa.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { InicioDto, InicioEntrada } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, origemDe } from "../acesso/acesso.js";
import { criarServicoInicio } from "./inicio.servico.js";

export const rotasInicio =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const config = { acesso: { autenticada: true as const } };
    const tags = ["Início"];
    const inicio = criarServicoInicio(s);

    app.get("/api/inicio", { config, schema: { tags, summary: "Meu Início: blocos na ordem escolhida (ou o padrão do perfil)", response: { 200: InicioDto } } }, async (req) =>
      inicio.ver(exigirEmpresa(req)),
    );
    app.put(
      "/api/inicio",
      { config, schema: { tags, summary: "Salvar a ordem dos meus blocos (só os que o perfil pode ver)", body: InicioEntrada, response: { 200: InicioDto } } },
      async (req) => inicio.salvar(exigirEmpresa(req), origemDe(req), req.body.blocos),
    );
    app.delete("/api/inicio", { config, schema: { tags, summary: "Voltar ao Início padrão do perfil", response: { 200: InicioDto } } }, async (req) =>
      inicio.salvar(exigirEmpresa(req), origemDe(req), null),
    );
  };
