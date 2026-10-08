// Rotas da telefonia: configuração, ramais, resultados, ligações e gravação.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AtualizarResultadoEntrada,
  EstadoLigacaoEntrada,
  FiltroLigacoes,
  FinalizarLigacaoEntrada,
  LigacaoDto,
  MeuTelefoneDto,
  NovaLigacaoEntrada,
  ParamId,
  ParamUsuario,
  RamalDto,
  RamalEntrada,
  ResultadoLigacaoDto,
  ResultadoLigacaoEntrada,
  TelefoniaConfigDto,
  TelefoniaConfigEntrada,
  pagina,
} from "@mg/shared";
import { invalido } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { LIMITE_GRAVACAO, criarServicoTelefonia } from "./telefonia.servico.js";

export const rotasTelefonia =
  (s: Servicos, arquivos: ProvedorArquivos): FastifyPluginAsyncZod =>
  async (app) => {
    const tel = criarServicoTelefonia(s, arquivos);
    const acesso = (acao: "ver" | "criar" | "editar" | "administrar") => ({ acesso: { modulo: "telefonia" as const, acao } });
    const tags = ["Telefonia"];

    app.get(
      "/api/telefonia/config",
      { config: acesso("administrar"), schema: { tags, summary: "Configuração da telefonia", response: { 200: TelefoniaConfigDto } } },
      async (req) => tel.obterConfig(exigirEmpresa(req)),
    );
    app.put(
      "/api/telefonia/config",
      { config: acesso("administrar"), schema: { tags, summary: "Salvar configuração (SIP, gravação, retenção)", body: TelefoniaConfigEntrada, response: { 200: TelefoniaConfigDto } } },
      async (req) =>
        tel.salvarConfig(exigirEmpresa(req), origemDe(req), {
          sipServidor: req.body.sipServidor ?? null,
          sipDominio: req.body.sipDominio ?? null,
          gravacaoAtiva: req.body.gravacaoAtiva,
          avisoGravacao: req.body.avisoGravacao,
          retencaoDias: req.body.retencaoDias,
        }),
    );
    app.get(
      "/api/telefonia/ramais",
      { config: acesso("administrar"), schema: { tags, summary: "Ramais SIP (sem as senhas)", response: { 200: z.array(RamalDto) } } },
      async (req) => tel.ramais(exigirEmpresa(req)),
    );
    app.put(
      "/api/telefonia/ramais/:usuarioId",
      { config: acesso("administrar"), schema: { tags, summary: "Cadastrar ou alterar o ramal de uma pessoa", params: ParamUsuario, body: RamalEntrada, response: { 200: RamalDto } } },
      async (req) => tel.salvarRamal(exigirEmpresa(req), origemDe(req), req.params.usuarioId, req.body),
    );
    app.get(
      "/api/telefonia/meu",
      { config: acesso("ver"), schema: { tags, summary: "Meu telefone: formas de ligar e o ramal SIP (só para a própria pessoa)", response: { 200: MeuTelefoneDto } } },
      async (req, reply) => {
        reply.header("cache-control", "no-store");
        return tel.meuTelefone(exigirEmpresa(req));
      },
    );

    app.get(
      "/api/telefonia/resultados",
      { config: acesso("ver"), schema: { tags, summary: "Resultados de ligação (ativos e arquivados)", response: { 200: z.array(ResultadoLigacaoDto) } } },
      async (req) => tel.resultados(exigirEmpresa(req)),
    );
    app.post(
      "/api/telefonia/resultados",
      { config: acesso("administrar"), schema: { tags, summary: "Criar resultado", body: ResultadoLigacaoEntrada, response: { 201: ResultadoLigacaoDto } } },
      async (req, reply) => reply.status(201).send(await tel.salvarResultado(exigirEmpresa(req), origemDe(req), null, req.body)),
    );
    app.patch(
      "/api/telefonia/resultados/:id",
      { config: acesso("administrar"), schema: { tags, summary: "Alterar, arquivar ou restaurar resultado", params: ParamId, body: AtualizarResultadoEntrada, response: { 200: ResultadoLigacaoDto } } },
      async (req) => tel.salvarResultado(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.get(
      "/api/ligacoes",
      { config: acesso("ver"), schema: { tags, summary: "Ligações (minhas ou da equipe, conforme o perfil)", querystring: FiltroLigacoes, response: { 200: pagina(LigacaoDto) } } },
      async (req) => tel.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
    );
    app.post(
      "/api/ligacoes",
      { config: acesso("criar"), schema: { tags, summary: "Começar ligação (o navegador disca pelo provedor escolhido)", body: NovaLigacaoEntrada, response: { 201: LigacaoDto } } },
      async (req, reply) => reply.status(201).send(await tel.criar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );
    app.get(
      "/api/ligacoes/:id",
      { config: acesso("ver"), schema: { tags, summary: "Ver ligação", params: ParamId, response: { 200: LigacaoDto } } },
      async (req) => tel.obter(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );
    app.post(
      "/api/ligacoes/:id/estado",
      { config: acesso("criar"), schema: { tags, summary: "Mudança de estado (discando, tocando, em ligação, em espera, encerrada)", params: ParamId, body: EstadoLigacaoEntrada, response: { 200: LigacaoDto } } },
      async (req) => tel.mudarEstado(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );
    app.post(
      "/api/ligacoes/:id/finalizar",
      { config: acesso("criar"), schema: { tags, summary: "Resultado e observação da ligação", params: ParamId, body: FinalizarLigacaoEntrada, response: { 200: LigacaoDto } } },
      async (req) => tel.finalizar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    // Gravação: o áudio chega por multipart e é cifrado antes de ir para o armazenamento.
    app.post(
      "/api/ligacoes/:id/gravacao",
      { config: acesso("criar"), schema: { tags, summary: "Enviar a gravação da ligação (cifrada no servidor)", consumes: ["multipart/form-data"], params: ParamId, response: { 201: LigacaoDto } } },
      async (req, reply) => {
        if (!req.isMultipart()) throw invalido("Envie a gravação como arquivo (multipart/form-data, campo \"arquivo\").");
        const parte = await req.file({ limits: { fileSize: LIMITE_GRAVACAO, files: 1 } });
        if (!parte) throw invalido("Nenhuma gravação recebida.");
        let conteudo: Buffer;
        try {
          conteudo = await parte.toBuffer();
        } catch {
          throw invalido("A gravação passou de 30 MB.");
        }
        if (!/^audio\//.test(parte.mimetype)) throw invalido("A gravação precisa ser um arquivo de áudio.");
        return reply.status(201).send(await tel.gravar(exigirEmpresa(req), origemDe(req), req.params.id, { mime: parte.mimetype, conteudo }));
      },
    );
    app.post(
      "/api/ligacoes/:id/gravacao/acesso",
      { config: acesso("ver"), schema: { tags, summary: "Link temporário (5 min) para ouvir a gravação — o acesso fica registrado", params: ParamId, response: { 200: z.object({ url: z.string(), expiraEm: z.string() }) } } },
      async (req) => tel.linkGravacao(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id),
    );
    app.get(
      "/api/gravacoes/:token",
      { config: acesso("ver"), schema: { tags, summary: "Ouvir gravação pelo link temporário", params: z.object({ token: z.string().max(300) }) } },
      async (req, reply) => {
        const g = await tel.lerGravacao(exigirEmpresa(req), req.params.token);
        return reply.header("content-type", g.mime).header("cache-control", "private, no-store").header("x-content-type-options", "nosniff").send(g.conteudo);
      },
    );
  };

export { criarServicoTelefonia };
