import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  AcaoEmMassaEntrada,
  AtualizarContatoEntrada,
  CanalContatoDto,
  CanalContatoEntrada,
  ContatoDto,
  ContatoEntrada,
  DocumentoReveladoDto,
  EnderecoContatoDto,
  EnderecoContatoEntrada,
  EtiquetasContatoEntrada,
  FiltroContatos,
  FiltroExportacaoContatos,
  FusaoDto,
  FusaoEntrada,
  HistoricoDto,
  Ok,
  Paginacao,
  ParContatosEntrada,
  ParDuplicadoDto,
  ParamCanal,
  ParamEndereco,
  ParamId,
  ROTULOS_CANAL,
  ResultadoEmMassaDto,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { z } from "zod";
import { criarServicoCanais } from "./canais.servico.js";
import { criarServicoContatos } from "./contatos.servico.js";
import { criarServicoFusao } from "./fusao.servico.js";

export const rotasContatos =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const contatos = criarServicoContatos(s);
    const canais = criarServicoCanais(s);
    const fusao = criarServicoFusao(s);
    const acesso = (acao: "ver" | "criar" | "editar" | "arquivar" | "exportar") => ({ acesso: { modulo: "crm" as const, acao } });
    const tags = ["CRM — contatos"];

    app.get(
      "/api/contatos",
      { config: acesso("ver"), schema: { tags, summary: "Listar contatos da carteira (busca, etiqueta, responsável)", querystring: FiltroContatos, response: { 200: pagina(ContatoDto) } } },
      async (req) => contatos.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    // Planilha do que a lista mostra, com finalidade obrigatória (fica na auditoria com os filtros e a quantidade).
    app.get(
      "/api/contatos/exportar",
      {
        config: acesso("exportar"),
        schema: { tags, summary: "Exportar a lista filtrada em CSV (finalidade obrigatória, documento mascarado)", querystring: FiltroExportacaoContatos },
      },
      async (req, reply) => {
        const r = await contatos.exportar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.query);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="${r.nomeArquivo}"`)
          .header("cache-control", "no-store")
          .send(r.csv);
      },
    );

    // Documento inteiro: só quem pode exportar, e cada vez fica na auditoria.
    app.post(
      "/api/contatos/:id/documento/revelar",
      { config: acesso("exportar"), schema: { tags, summary: "Mostrar o CPF/CNPJ inteiro (auditado)", params: ParamId, response: { 200: DocumentoReveladoDto } } },
      async (req) => contatos.revelarDocumento(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id),
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

    // Telefones, e-mails e endereços extras (listas curtas, com limite por contato: sem paginação).
    const tagsExtras = ["CRM — telefones, e-mails e endereços"];
    app.get(
      "/api/contatos/:id/canais",
      { config: acesso("ver"), schema: { tags: tagsExtras, summary: "Telefones e e-mails extras do contato", params: ParamId, response: { 200: z.array(CanalContatoDto) } } },
      async (req) => canais.listarCanais(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );
    app.post(
      "/api/contatos/:id/canais",
      {
        config: acesso("editar"),
        schema: { tags: tagsExtras, summary: "Incluir telefone ou e-mail extra (telefone único na empresa)", params: ParamId, body: CanalContatoEntrada, response: { 201: CanalContatoDto } },
      },
      async (req, reply) => reply.status(201).send(await canais.adicionarCanal(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body)),
    );
    app.patch(
      "/api/contatos/:id/canais/:canalId",
      {
        config: acesso("editar"),
        schema: { tags: tagsExtras, summary: "Trocar o rótulo do telefone ou e-mail extra", params: ParamCanal, body: z.object({ rotulo: z.enum(ROTULOS_CANAL) }), response: { 200: CanalContatoDto } },
      },
      async (req) => canais.alterarCanal(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.params.canalId, req.body.rotulo),
    );
    app.post(
      "/api/contatos/:id/canais/:canalId/arquivar",
      { config: acesso("editar"), schema: { tags: tagsExtras, summary: "Tirar o telefone ou e-mail extra (fica arquivado)", params: ParamCanal, response: { 200: Ok } } },
      async (req) => {
        await canais.arquivarCanal(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.params.canalId);
        return { ok: true as const };
      },
    );
    app.post(
      "/api/contatos/:id/canais/:canalId/principal",
      { config: acesso("editar"), schema: { tags: tagsExtras, summary: "Tornar o extra o principal (o principal de antes vira extra)", params: ParamCanal, response: { 200: Ok } } },
      async (req) => {
        await canais.tornarPrincipal(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.params.canalId);
        return { ok: true as const };
      },
    );
    app.get(
      "/api/contatos/:id/enderecos",
      { config: acesso("ver"), schema: { tags: tagsExtras, summary: "Endereços do contato (o principal primeiro)", params: ParamId, response: { 200: z.array(EnderecoContatoDto) } } },
      async (req) => canais.listarEnderecos(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );
    app.post(
      "/api/contatos/:id/enderecos",
      { config: acesso("editar"), schema: { tags: tagsExtras, summary: "Incluir endereço", params: ParamId, body: EnderecoContatoEntrada, response: { 201: EnderecoContatoDto } } },
      async (req, reply) => reply.status(201).send(await canais.adicionarEndereco(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body)),
    );
    app.put(
      "/api/contatos/:id/enderecos/:enderecoId",
      { config: acesso("editar"), schema: { tags: tagsExtras, summary: "Alterar endereço", params: ParamEndereco, body: EnderecoContatoEntrada, response: { 200: EnderecoContatoDto } } },
      async (req) => canais.alterarEndereco(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.params.enderecoId, req.body),
    );
    app.post(
      "/api/contatos/:id/enderecos/:enderecoId/arquivar",
      { config: acesso("editar"), schema: { tags: tagsExtras, summary: "Tirar o endereço (fica arquivado)", params: ParamEndereco, response: { 200: Ok } } },
      async (req) => {
        await canais.arquivarEndereco(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.params.enderecoId);
        return { ok: true as const };
      },
    );

    // Duplicados e fusão (Konecta RF-CRM-004/008): quem arquiva na carteira da equipe ou da empresa (não a própria).
    const tagsFusao = ["CRM — duplicados e fusão"];
    app.get(
      "/api/contatos/duplicados",
      { config: acesso("arquivar"), schema: { tags: tagsFusao, summary: "Possíveis duplicados (mesmo e-mail ou mesmo nome)", querystring: Paginacao, response: { 200: pagina(ParDuplicadoDto) } } },
      async (req) => fusao.pares(exigirEmpresa(req), exigirEscopo(req), req.query.cursor, req.query.limite),
    );
    app.post(
      "/api/contatos/duplicados/ignorar",
      { config: acesso("arquivar"), schema: { tags: tagsFusao, summary: "Marcar o par como \"não é duplicado\"", body: ParContatosEntrada, response: { 200: Ok } } },
      async (req) => {
        await fusao.ignorarPar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body.contatoA, req.body.contatoB);
        return { ok: true as const };
      },
    );
    app.post(
      "/api/contatos/:id/fundir",
      {
        config: acesso("arquivar"),
        schema: { tags: tagsFusao, summary: "Fundir outro cadastro neste (o outro fica arquivado; tudo passa para este)", params: ParamId, body: FusaoEntrada, response: { 200: FusaoDto } },
      },
      async (req) => fusao.fundir(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );
  };
