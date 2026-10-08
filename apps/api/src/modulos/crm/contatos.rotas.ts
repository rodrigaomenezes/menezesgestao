import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AcaoEmMassaEntrada,
  AtualizarContatoEntrada,
  ContatoDto,
  ContatoEntrada,
  EtiquetasContatoEntrada,
  FiltroContatos,
  HistoricoDto,
  Ok,
  Paginacao,
  ParamId,
  ResultadoEmMassaDto,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoContatos } from "./contatos.servico.js";

export const rotasContatos =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const contatos = criarServicoContatos(s);
    const acesso = (acao: "ver" | "criar" | "editar" | "arquivar") => ({ acesso: { modulo: "crm" as const, acao } });
    const tags = ["CRM — contatos"];

    app.get(
      "/api/contatos",
      { config: acesso("ver"), schema: { tags, summary: "Listar contatos da carteira (busca, etiqueta, responsável)", querystring: FiltroContatos, response: { 200: pagina(ContatoDto) } } },
      async (req) => contatos.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    app.get(
      "/api/contatos/:id",
      { config: acesso("ver"), schema: { tags, summary: "Ver contato", params: ParamId, response: { 200: ContatoDto } } },
      async (req) => contatos.obter(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );

    app.get(
      "/api/contatos/:id/historico",
      { config: acesso("ver"), schema: { tags, summary: "Histórico único do contato", params: ParamId, querystring: Paginacao, response: { 200: pagina(HistoricoDto) } } },
      async (req) => contatos.historico(exigirEmpresa(req), exigirEscopo(req), req.params.id, req.query.cursor, req.query.limite),
    );

    app.post(
      "/api/contatos",
      { config: acesso("criar"), schema: { tags, summary: "Criar contato (telefone único por empresa)", body: ContatoEntrada, response: { 201: ContatoDto } } },
      async (req, reply) => reply.status(201).send(await contatos.criar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );

    app.patch(
      "/api/contatos/:id",
      { config: acesso("editar"), schema: { tags, summary: "Alterar contato (inclui transferir responsável)", params: ParamId, body: AtualizarContatoEntrada, response: { 200: ContatoDto } } },
      async (req) => contatos.atualizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );

    app.put(
      "/api/contatos/:id/etiquetas",
      { config: acesso("editar"), schema: { tags, summary: "Definir as etiquetas do contato", params: ParamId, body: EtiquetasContatoEntrada, response: { 200: ContatoDto } } },
      async (req) => contatos.definirEtiquetas(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.etiquetaIds),
    );

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/contatos/:id/${rota}`,
        { config: acesso("arquivar"), schema: { tags, summary: arquivar ? "Arquivar contato (vai para a lixeira)" : "Restaurar contato", params: ParamId, response: { 200: Ok } } },
        async (req) => {
          await contatos.alternarArquivo(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, arquivar);
          return { ok: true as const };
        },
      );
    }

    app.post(
      "/api/contatos/acoes",
      { config: acesso("editar"), schema: { tags, summary: "Ações em massa: transferir, arquivar, restaurar, etiquetar", body: AcaoEmMassaEntrada, response: { 200: ResultadoEmMassaDto } } },
      async (req) => contatos.acaoEmMassa(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body),
    );
  };
