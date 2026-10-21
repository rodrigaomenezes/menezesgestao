// Rotas do Motor BRE (fase 8.1). Módulo "bre" por plano; permissão checada em toda rota.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AnaliseBreDto,
  AtualizarAutomacaoBreEntrada,
  AutomacaoBreDto,
  AutomacaoBreEntrada,
  ExecucaoAutomacaoBreDto,
  AtualizarMotivoBreakEntrada,
  AtualizarReentradaEntrada,
  BpiRespostaDto,
  BreakDto,
  ConcordanciaDto,
  InteligenciaContatoDto,
  ConfirmarSqBreEntrada,
  EscalonamentoDto,
  FiltroBpi,
  FiltroEscalonamentos,
  FiltroSqBre,
  SqBreDto,
  SqBreEntrada,
  ConfigBreDto,
  ConfigBreEntrada,
  EncerramentoBreEntrada,
  FiltroBreaks,
  FiltroReentradas,
  ItemFilaBreDto,
  MotivoBreakDto,
  MotivoBreakEntrada,
  Ok,
  Paginacao,
  ParamId,
  ReentradaDto,
  ReentradaEntrada,
  RegistroBreDto,
  RegistroBreEntrada,
  pagina,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { ErroApp } from "../../infra/erros.js";
import { exigirEmpresa, exigirEscopo, origemDe, type ContextoEmpresa } from "../acesso/acesso.js";
import { criarServicoBre } from "./bre.servico.js";
import { criarServicoDesempenho } from "./desempenho.servico.js";
import { criarServicoAutomacaoBre } from "./automacao.servico.js";
import type { ServicoEnvio } from "../conversas/envio.servico.js";

export const FILA_BRE_DIARIA = "bre.classificar";
export const FILA_BRE_HORARIA = "bre.silencio";
export const FILA_BRE_SEMANAL = "bre.coaching";
export const FILA_BRE_AUTOMACAO = "bre.automacao";

/** O SQ-BRE mora na Qualidade (DEC-014), mas só existe com o motor BRE ligado. */
function exigirBre(ctx: ContextoEmpresa): ContextoEmpresa {
  if (!ctx.modulos.includes("bre")) throw new ErroApp(403, "MODULO_INATIVO", "Este módulo não está ativo no plano da empresa. Fale com o administrador.");
  return ctx;
}

export const rotasBre =
  (s: Servicos, envio: ServicoEnvio): FastifyPluginAsyncZod =>
  async (app) => {
    const bre = criarServicoBre(s);
    const desempenho = criarServicoDesempenho(s);
    const automacao = criarServicoAutomacaoBre(s, envio);
    const tags = ["Motor BRE"];
    const acesso = (acao: "ver" | "criar" | "editar" | "administrar") => ({ acesso: { modulo: "bre" as const, acao } });

    app.get("/api/bre/config", { config: acesso("ver"), schema: { tags, summary: "Limites do motor BRE da empresa", response: { 200: ConfigBreDto } } }, async (req) =>
      bre.config(exigirEmpresa(req)),
    );
    app.put(
      "/api/bre/config",
      { config: acesso("administrar"), schema: { tags, summary: "Ajustar os limites do motor BRE (nova versão)", body: ConfigBreEntrada, response: { 200: ConfigBreDto } } },
      async (req) => bre.salvarConfig(exigirEmpresa(req), origemDe(req), req.body),
    );

    app.get(
      "/api/bre/motivos",
      { config: acesso("ver"), schema: { tags, summary: "Motivos de Break por categoria", response: { 200: z.object({ itens: z.array(MotivoBreakDto) }) } } },
      async (req) => bre.motivos(exigirEmpresa(req)),
    );
    app.post(
      "/api/bre/motivos",
      { config: acesso("administrar"), schema: { tags, summary: "Criar motivo de Break", body: MotivoBreakEntrada, response: { 201: Ok } } },
      async (req, reply) => reply.status(201).send(await bre.salvarMotivo(exigirEmpresa(req), origemDe(req), null, req.body)),
    );
    app.patch(
      "/api/bre/motivos/:id",
      { config: acesso("administrar"), schema: { tags, summary: "Renomear ou arquivar motivo de Break", params: ParamId, body: AtualizarMotivoBreakEntrada, response: { 200: Ok } } },
      async (req) => bre.salvarMotivo(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );

    app.post(
      "/api/bre/registros",
      { config: acesso("criar"), schema: { tags, summary: "Registrar a conversa (8 campos, Break e próximo passo)", body: RegistroBreEntrada, response: { 201: RegistroBreDto } } },
      async (req, reply) => reply.status(201).send(await bre.registrarConversa(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );
    app.post(
      "/api/bre/conversas/:id/analisar",
      { config: acesso("criar"), schema: { tags, summary: "Analisar a conversa com a IA (sugere; a pessoa confirma no registro)", params: ParamId, response: { 200: AnaliseBreDto } } },
      async (req) => bre.analisarConversa(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id),
    );
    app.get(
      "/api/bre/breaks",
      { config: acesso("ver"), schema: { tags, summary: "Breaks registrados", querystring: FiltroBreaks, response: { 200: pagina(BreakDto) } } },
      async (req) => bre.breaks(exigirEmpresa(req), exigirEscopo(req), req.query),
    );
    app.get(
      "/api/bre/fila-do-dia",
      { config: acesso("ver"), schema: { tags, summary: "Quem pode ser contatado hoje, já respeitando os limites", querystring: Paginacao, response: { 200: pagina(ItemFilaBreDto) } } },
      async (req) => bre.filaDoDia(exigirEmpresa(req), exigirEscopo(req), req.query),
    );

    app.get(
      "/api/bre/reentradas",
      { config: acesso("ver"), schema: { tags, summary: "Reentradas programadas", querystring: FiltroReentradas, response: { 200: pagina(ReentradaDto) } } },
      async (req) => bre.reentradas(exigirEmpresa(req), exigirEscopo(req), req.query),
    );
    app.post(
      "/api/bre/reentradas",
      { config: acesso("criar"), schema: { tags, summary: "Programar reentrada", body: ReentradaEntrada, response: { 201: z.object({ id: z.uuid() }) } } },
      async (req, reply) => reply.status(201).send(await bre.programarReentrada(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
    );
    app.patch(
      "/api/bre/reentradas/:id",
      { config: acesso("editar"), schema: { tags, summary: "Marcar reentrada como feita ou cancelada", params: ParamId, body: AtualizarReentradaEntrada, response: { 200: Ok } } },
      async (req) => bre.concluirReentrada(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.status),
    );

    app.get(
      "/api/bre/contatos/:id/inteligencia",
      { config: acesso("ver"), schema: { tags, summary: "O que falta saber do cliente (campos de inteligência)", params: ParamId, response: { 200: InteligenciaContatoDto } } },
      async (req) => bre.inteligenciaDoContato(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );
    app.get(
      "/api/bre/concordancia",
      { config: acesso("administrar"), schema: { tags, summary: "Concordância IA × pessoa e liberação da automação (DEC-010)", response: { 200: ConcordanciaDto } } },
      async (req) => bre.concordancia(exigirEmpresa(req)),
    );
    app.get(
      "/api/bre/automacoes",
      { config: acesso("administrar"), schema: { tags, summary: "Automações do método (pós-venda, aniversário, reentrada)", response: { 200: z.object({ itens: z.array(AutomacaoBreDto) }) } } },
      async (req) => automacao.listar(exigirEmpresa(req)),
    );
    app.post(
      "/api/bre/automacoes",
      { config: acesso("administrar"), schema: { tags, summary: "Criar automação (nasce desligada)", body: AutomacaoBreEntrada, response: { 201: AutomacaoBreDto } } },
      async (req, reply) => reply.status(201).send(await automacao.criar(exigirEmpresa(req), origemDe(req), req.body)),
    );
    app.patch(
      "/api/bre/automacoes/:id",
      {
        config: acesso("administrar"),
        schema: { tags, summary: "Alterar, ligar (exige o painel IA × equipe liberado), desligar ou arquivar", params: ParamId, body: AtualizarAutomacaoBreEntrada, response: { 200: AutomacaoBreDto } },
      },
      async (req) => automacao.atualizar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
    );
    app.get(
      "/api/bre/automacoes/execucoes",
      { config: acesso("administrar"), schema: { tags, summary: "Envios e pulos das automações", querystring: Paginacao, response: { 200: pagina(ExecucaoAutomacaoBreDto) } } },
      async (req) => automacao.execucoes(exigirEmpresa(req), req.query),
    );
    app.post(
      "/api/bre/automacoes/executar",
      {
        config: acesso("administrar"),
        schema: { tags, summary: "Rodar agora as automações ligadas (o mesmo que a rotina diária)", response: { 200: z.object({ enviadas: z.number().int(), ignoradas: z.number().int(), pausada: z.string().nullable() }) } },
      },
      async (req) => automacao.executar(exigirEmpresa(req).empresaId),
    );
    app.get(
      "/api/bre/desempenho",
      { config: acesso("ver"), schema: { tags, summary: "BPI do mês por pessoa (ranking) e pilares em coaching", querystring: FiltroBpi, response: { 200: BpiRespostaDto } } },
      async (req) => desempenho.bpi(exigirEmpresa(req), exigirEscopo(req), req.query.mes),
    );
    app.get(
      "/api/bre/escalonamentos",
      { config: acesso("ver"), schema: { tags, summary: "Conversas que precisam de uma pessoa", querystring: FiltroEscalonamentos, response: { 200: pagina(EscalonamentoDto) } } },
      async (req) => bre.escalonamentos(exigirEmpresa(req), exigirEscopo(req), req.query),
    );
    app.patch(
      "/api/bre/escalonamentos/:id",
      { config: acesso("editar"), schema: { tags, summary: "Marcar escalonamento como resolvido", params: ParamId, response: { 200: Ok } } },
      async (req) => bre.resolverEscalonamento(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id),
    );

    {
      const tagsQ = ["Qualidade"];
      const qualidade = (acao: "ver" | "criar") => ({ acesso: { modulo: "qualidade" as const, acao } });
      app.get(
        "/api/qualidade/sq-bre",
        { config: qualidade("ver"), schema: { tags: tagsQ, summary: "Avaliações SQ-BRE (prévias e confirmadas)", querystring: FiltroSqBre, response: { 200: pagina(SqBreDto) } } },
        async (req) => desempenho.listarSq(exigirBre(exigirEmpresa(req)), exigirEscopo(req), req.query),
      );
      app.post(
        "/api/qualidade/sq-bre",
        { config: qualidade("criar"), schema: { tags: tagsQ, summary: "Prévia SQ-BRE da conversa pela IA", body: SqBreEntrada, response: { 200: SqBreDto } } },
        async (req) => desempenho.previa(exigirBre(exigirEmpresa(req)), exigirEscopo(req), origemDe(req), req.body.conversaId),
      );
      app.post(
        "/api/qualidade/sq-bre/:id/confirmar",
        { config: qualidade("criar"), schema: { tags: tagsQ, summary: "Supervisor confirma a nota SQ-BRE (ajustando ou não a prévia)", params: ParamId, body: ConfirmarSqBreEntrada, response: { 200: SqBreDto } } },
        async (req) => desempenho.confirmar(exigirBre(exigirEmpresa(req)), exigirEscopo(req), origemDe(req), req.params.id, req.body.notas, req.body.feedback ?? null),
      );
    }

    app.post(
      "/api/bre/oportunidades/:id/encerrar",
      {
        config: acesso("editar"),
        schema: { tags, summary: "Encerramento guiado (critério + checklist)", params: ParamId, body: EncerramentoBreEntrada, response: { 200: z.object({ ok: z.literal(true), reentradaId: z.uuid().nullable() }) } },
      },
      async (req) => bre.encerrar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
    );
  };
