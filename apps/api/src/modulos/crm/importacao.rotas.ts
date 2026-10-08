import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { ConfirmarImportacaoEntrada, ImportacaoDto, Paginacao, ParamId, pagina } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { invalido } from "../../infra/erros.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { criarServicoImportacao } from "./importacao.servico.js";
import { LIMITE_BYTES } from "./planilha.js";

const TIPOS_ACEITOS = /\.(csv|txt|xlsx)$/i;

export const rotasImportacao =
  (s: Servicos, arquivos: ProvedorArquivos): FastifyPluginAsyncZod =>
  async (app) => {
    const importacoes = criarServicoImportacao(s, arquivos);
    const tags = ["CRM — importação"];

    app.get(
      "/api/importacoes",
      { config: { acesso: { modulo: "crm", acao: "criar" } }, schema: { tags, summary: "Minhas importações", querystring: Paginacao, response: { 200: pagina(ImportacaoDto) } } },
      async (req) => importacoes.listar(exigirEmpresa(req), req.query.cursor, req.query.limite),
    );

    app.get(
      "/api/importacoes/:id",
      { config: { acesso: { modulo: "crm", acao: "criar" } }, schema: { tags, summary: "Andamento e relatório da importação", params: ParamId, response: { 200: ImportacaoDto } } },
      async (req) => importacoes.obter(exigirEmpresa(req), req.params.id),
    );

    // Upload em multipart (o limite de 1 MB do JSON não vale aqui): só a planilha, até 10 MB.
    app.post(
      "/api/importacoes",
      { config: { acesso: { modulo: "crm", acao: "criar" } }, schema: { tags, summary: "Enviar planilha (CSV ou XLSX) e ver a prévia", consumes: ["multipart/form-data"], response: { 201: ImportacaoDto } } },
      async (req, reply) => {
        if (!req.isMultipart()) throw invalido("Envie a planilha como arquivo (multipart/form-data, campo \"arquivo\").");
        const parte = await req.file({ limits: { fileSize: LIMITE_BYTES, files: 1 } });
        if (!parte) throw invalido("Nenhum arquivo recebido. Escolha a planilha e tente de novo.");
        const nome = parte.filename || "planilha.csv";
        if (!TIPOS_ACEITOS.test(nome)) throw invalido("Formato não aceito. Envie uma planilha .xlsx ou .csv.");
        let conteudo: Buffer;
        try {
          conteudo = await parte.toBuffer();
        } catch {
          throw invalido("A planilha passou de 10 MB. Divida em arquivos menores.");
        }
        const dto = await importacoes.receber(exigirEmpresa(req), origemDe(req), nome, parte.mimetype, conteudo);
        return reply.status(201).send(dto);
      },
    );

    app.post(
      "/api/importacoes/:id/confirmar",
      { config: { acesso: { modulo: "crm", acao: "criar" } }, schema: { tags, summary: "Confirmar mapeamento e importar", params: ParamId, body: ConfirmarImportacaoEntrada, response: { 200: ImportacaoDto } } },
      async (req) => importacoes.confirmar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );
  };
