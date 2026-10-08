import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AtualizarTarefaEntrada,
  FiltroTarefas,
  NotaDto,
  NotaEntrada,
  Ok,
  Paginacao,
  ParamId,
  TarefaDto,
  TarefaEntrada,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoTarefas } from "./tarefas.servico.js";

export const rotasTarefas =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const tarefas = criarServicoTarefas(s);
    const acesso = (acao: "ver" | "criar" | "editar" | "arquivar") => ({ acesso: { modulo: "crm" as const, acao } });
    const tags = ["CRM — tarefas e notas"];

    app.get(
      "/api/tarefas",
      { config: acesso("ver"), schema: { tags, summary: "Tarefas (abertas por vencimento ou concluídas)", querystring: FiltroTarefas, response: { 200: pagina(TarefaDto) } } },
      async (req) => tarefas.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
    );
    app.post(
      "/api/tarefas",
      { config: acesso("criar"), schema: { tags, summary: "Criar tarefa", body: TarefaEntrada, response: { 201: TarefaDto } } },
      async (req, reply) => reply.status(201).send(await tarefas.criar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );
    app.patch(
      "/api/tarefas/:id",
      { config: acesso("editar"), schema: { tags, summary: "Alterar, concluir ou reabrir tarefa", params: ParamId, body: AtualizarTarefaEntrada, response: { 200: TarefaDto } } },
      async (req) => tarefas.atualizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );
    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/tarefas/:id/${rota}`,
        { config: acesso("arquivar"), schema: { tags, summary: arquivar ? "Arquivar tarefa" : "Restaurar tarefa", params: ParamId, response: { 200: Ok } } },
        async (req) => {
          await tarefas.alternarArquivo(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, arquivar);
          return { ok: true as const };
        },
      );
    }

    app.get(
      "/api/contatos/:id/notas",
      { config: acesso("ver"), schema: { tags, summary: "Notas do contato", params: ParamId, querystring: Paginacao, response: { 200: pagina(NotaDto) } } },
      async (req) => tarefas.listarNotas(exigirEmpresa(req), exigirEscopo(req), req.params.id, req.query.cursor, req.query.limite),
    );
    app.post(
      "/api/contatos/:id/notas",
      { config: acesso("editar"), schema: { tags, summary: "Escrever nota no contato", params: ParamId, body: NotaEntrada, response: { 201: NotaDto } } },
      async (req, reply) => reply.status(201).send(await tarefas.criarNota(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body)),
    );
    app.patch(
      "/api/notas/:id",
      {
        config: acesso("editar"),
        schema: { tags, summary: "Corrigir ou arquivar nota (autor ou administrador)", params: ParamId, body: z.object({ texto: NotaEntrada.shape.texto.optional(), arquivar: z.boolean().optional() }), response: { 200: Ok } },
      },
      async (req) => {
        await tarefas.alterarNota(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body);
        return { ok: true as const };
      },
    );
  };
