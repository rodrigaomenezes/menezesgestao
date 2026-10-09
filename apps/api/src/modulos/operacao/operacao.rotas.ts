// Rotas da operação (fase 4): rotina, agenda, escala e horas, metas e desempenho, mapa de atividades e scripts.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AtividadeDto,
  AtividadeEntrada,
  AtualizarAtividadeEntrada,
  AtualizarChecklistItemEntrada,
  AtualizarCompromissoEntrada,
  AtualizarMetaEntrada,
  AtualizarRegistroHorasEntrada,
  AtualizarScriptEntrada,
  ChecklistItemDto,
  ChecklistItemEntrada,
  CompromissoDto,
  CompromissoEntrada,
  DataDia,
  DesempenhoDto,
  EscalaDto,
  EscalaEntrada,
  FechamentoDto,
  FecharMesEntrada,
  FiltroAtividades,
  FiltroCompromissos,
  FiltroDesempenho,
  FiltroHoras,
  FiltroMapa,
  FiltroMetas,
  FiltroResumoHoras,
  FiltroScripts,
  Id,
  LinhaMapaDto,
  MarcarChecklistEntrada,
  MetaDto,
  MetaEntrada,
  Ok,
  Paginacao,
  ParamId,
  ReabrirMesEntrada,
  RegistroHorasDto,
  RegistroHorasEntrada,
  ResumoHorasDto,
  RotinaDto,
  ScriptDto,
  ScriptEntrada,
  ValidarHorasEntrada,
  pagina,
  type Acao,
  type Modulo,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoAgenda } from "./agenda.servico.js";
import { criarServicoDesempenho } from "./desempenho.servico.js";
import { criarServicoHoras } from "./horas.servico.js";
import { criarServicoMapa } from "./mapa.servico.js";
import { criarServicoRotina } from "./rotina.servico.js";
import { criarServicoScripts } from "./scripts.servico.js";

const acesso = (modulo: Modulo, acao: Acao) => ({ acesso: { modulo, acao } });
const ParamUsuario = z.object({ usuarioId: Id });

export const rotasOperacao =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const rotina = criarServicoRotina(s);
    const agenda = criarServicoAgenda(s);
    const horas = criarServicoHoras(s);
    const desempenho = criarServicoDesempenho(s);
    const mapa = criarServicoMapa(s);
    const scripts = criarServicoScripts(s);

    // Rotina diária -------------------------------------------------------------------------------------
    {
      const tags = ["Operação — rotina"];
      app.get("/api/rotina", { config: acesso("rotina", "ver"), schema: { tags, summary: "O que fazer hoje (só dos módulos que o perfil vê)", response: { 200: RotinaDto } } }, async (req) =>
        rotina.rotina(exigirEmpresa(req)),
      );
      app.put(
        "/api/rotina/checklist/:id",
        { config: acesso("rotina", "editar"), schema: { tags, summary: "Marcar ou desmarcar item do check-list de hoje", params: ParamId, body: MarcarChecklistEntrada, response: { 200: Ok } } },
        async (req) => {
          await rotina.marcar(exigirEmpresa(req), origemDe(req), req.params.id, req.body.feito);
          return { ok: true as const };
        },
      );
      app.get(
        "/api/checklist",
        { config: acesso("rotina", "administrar"), schema: { tags, summary: "Itens do check-list (configuração)", response: { 200: z.object({ itens: z.array(ChecklistItemDto) }) } } },
        async (req) => rotina.itens(exigirEmpresa(req)),
      );
      app.post(
        "/api/checklist",
        { config: acesso("rotina", "administrar"), schema: { tags, summary: "Criar item do check-list", body: ChecklistItemEntrada, response: { 201: ChecklistItemDto } } },
        async (req, reply) => reply.status(201).send(await rotina.salvarItem(exigirEmpresa(req), origemDe(req), null, req.body)),
      );
      app.patch(
        "/api/checklist/:id",
        { config: acesso("rotina", "administrar"), schema: { tags, summary: "Alterar ou arquivar item do check-list", params: ParamId, body: AtualizarChecklistItemEntrada, response: { 200: ChecklistItemDto } } },
        async (req) => rotina.salvarItem(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
      );
    }

    // Agenda --------------------------------------------------------------------------------------------
    {
      const tags = ["Operação — agenda"];
      app.get(
        "/api/compromissos",
        { config: acesso("agenda", "ver"), schema: { tags, summary: "Compromissos de uma pessoa num intervalo de dias", querystring: FiltroCompromissos, response: { 200: pagina(CompromissoDto) } } },
        async (req) => agenda.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.post(
        "/api/compromissos",
        { config: acesso("agenda", "criar"), schema: { tags, summary: "Criar compromisso", body: CompromissoEntrada, response: { 201: CompromissoDto } } },
        async (req, reply) => reply.status(201).send(await agenda.criar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/compromissos/:id",
        { config: acesso("agenda", "editar"), schema: { tags, summary: "Alterar, remarcar ou arquivar compromisso", params: ParamId, body: AtualizarCompromissoEntrada, response: { 200: CompromissoDto } } },
        async (req) => agenda.atualizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
    }

    // Escala e horas ----------------------------------------------------------------------------------
    {
      const tags = ["Operação — escala e horas"];
      app.get(
        "/api/escalas/:usuarioId",
        { config: acesso("agenda", "ver"), schema: { tags, summary: "Escala semanal da pessoa", params: ParamUsuario, response: { 200: EscalaDto } } },
        async (req) => horas.obterEscala(exigirEmpresa(req), exigirEscopo(req), req.params.usuarioId),
      );
      app.put(
        "/api/escalas/:usuarioId",
        { config: acesso("agenda", "editar"), schema: { tags, summary: "Trocar a escala semanal (gestor)", params: ParamUsuario, body: EscalaEntrada, response: { 200: EscalaDto } } },
        async (req) => horas.salvarEscala(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.usuarioId, req.body.intervalos),
      );
      app.get(
        "/api/horas",
        { config: acesso("agenda", "ver"), schema: { tags, summary: "Registros de horas do mês", querystring: FiltroHoras, response: { 200: pagina(RegistroHorasDto) } } },
        async (req) => horas.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.get(
        "/api/horas/ponto",
        { config: acesso("agenda", "ver"), schema: { tags, summary: "Meu ponto aberto (se houver)", response: { 200: z.object({ registro: RegistroHorasDto.nullable() }) } } },
        async (req) => ({ registro: await horas.meuPonto(exigirEmpresa(req)) }),
      );
      app.post(
        "/api/horas/ponto",
        { config: acesso("agenda", "criar"), schema: { tags, summary: "Bater o ponto (entrada ou saída)", response: { 200: RegistroHorasDto } } },
        async (req) => horas.ponto(exigirEmpresa(req), origemDe(req)),
      );
      app.post(
        "/api/horas",
        { config: acesso("agenda", "criar"), schema: { tags, summary: "Lançar horas (entrada e saída)", body: RegistroHorasEntrada, response: { 201: RegistroHorasDto } } },
        async (req, reply) => reply.status(201).send(await horas.criar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/horas/:id",
        { config: acesso("agenda", "editar"), schema: { tags, summary: "Corrigir ou arquivar registro (volta para validação)", params: ParamId, body: AtualizarRegistroHorasEntrada, response: { 200: RegistroHorasDto } } },
        async (req) => horas.atualizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
      app.post(
        "/api/horas/:id/validacao",
        { config: acesso("agenda", "editar"), schema: { tags, summary: "Validar ou recusar registro (gestor da pessoa)", params: ParamId, body: ValidarHorasEntrada, response: { 200: RegistroHorasDto } } },
        async (req) => horas.validar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
      app.get(
        "/api/horas/resumo",
        { config: acesso("agenda", "ver"), schema: { tags, summary: "Previsto × registrado × validado por pessoa no mês", querystring: FiltroResumoHoras, response: { 200: pagina(ResumoHorasDto) } } },
        async (req) => horas.resumo(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.get(
        "/api/horas/fechamentos",
        { config: acesso("agenda", "ver"), schema: { tags, summary: "Meses fechados", querystring: Paginacao, response: { 200: pagina(FechamentoDto) } } },
        async (req) => horas.fechamentos(exigirEmpresa(req), req.query),
      );
      app.post(
        "/api/horas/fechamentos",
        { config: acesso("agenda", "administrar"), schema: { tags, summary: "Fechar o mês (bloqueia mudanças)", body: FecharMesEntrada, response: { 201: FechamentoDto } } },
        async (req, reply) => reply.status(201).send(await horas.fecharMes(exigirEmpresa(req), origemDe(req), req.body.mes)),
      );
      app.post(
        "/api/horas/fechamentos/:id/reabrir",
        { config: acesso("agenda", "administrar"), schema: { tags, summary: "Reabrir mês fechado (com motivo)", params: ParamId, body: ReabrirMesEntrada, response: { 200: FechamentoDto } } },
        async (req) => horas.reabrirMes(exigirEmpresa(req), origemDe(req), req.params.id, req.body.motivo),
      );
    }

    // Metas e desempenho --------------------------------------------------------------------------------
    {
      const tags = ["Operação — metas e desempenho"];
      app.get(
        "/api/desempenho",
        { config: acesso("desempenho", "ver"), schema: { tags, summary: "Indicadores por pessoa no período (calculados dos eventos)", querystring: FiltroDesempenho, response: { 200: DesempenhoDto } } },
        async (req) => desempenho.painel(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.get(
        "/api/metas",
        { config: acesso("desempenho", "ver"), schema: { tags, summary: "Metas com o realizado do período", querystring: FiltroMetas, response: { 200: pagina(MetaDto) } } },
        async (req) => desempenho.listarMetas(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.post(
        "/api/metas",
        { config: acesso("desempenho", "criar"), schema: { tags, summary: "Definir meta", body: MetaEntrada, response: { 201: MetaDto } } },
        async (req, reply) => reply.status(201).send(await desempenho.criarMeta(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/metas/:id",
        { config: acesso("desempenho", "editar"), schema: { tags, summary: "Mudar valor ou arquivar meta", params: ParamId, body: AtualizarMetaEntrada, response: { 200: MetaDto } } },
        async (req) => desempenho.atualizarMeta(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
    }

    // Mapa de atividades ----------------------------------------------------------------------------------
    {
      const tags = ["Operação — mapa de atividades"];
      app.get(
        "/api/mapa",
        {
          config: acesso("mapa", "ver"),
          schema: { tags, summary: "Atividade por hora de cada pessoa no dia", querystring: FiltroMapa, response: { 200: z.object({ data: DataDia, itens: z.array(LinhaMapaDto), proximoCursor: z.string().nullable() }) } },
        },
        async (req) => mapa.mapa(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.get(
        "/api/atividades",
        { config: acesso("mapa", "ver"), schema: { tags, summary: "Atividades lançadas à mão", querystring: FiltroAtividades, response: { 200: pagina(AtividadeDto) } } },
        async (req) => mapa.listarAtividades(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.post(
        "/api/atividades",
        { config: acesso("mapa", "criar"), schema: { tags, summary: "Lançar atividade (reunião, visita…)", body: AtividadeEntrada, response: { 201: AtividadeDto } } },
        async (req, reply) => reply.status(201).send(await mapa.criarAtividade(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/atividades/:id",
        { config: acesso("mapa", "editar"), schema: { tags, summary: "Corrigir ou arquivar atividade lançada", params: ParamId, body: AtualizarAtividadeEntrada, response: { 200: AtividadeDto } } },
        async (req) => mapa.atualizarAtividade(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
    }

    // Scripts -------------------------------------------------------------------------------------------
    {
      const tags = ["Operação — scripts"];
      app.get(
        "/api/scripts",
        { config: acesso("scripts", "ver"), schema: { tags, summary: "Scripts (no contexto de um contato: os da etapa primeiro)", querystring: FiltroScripts, response: { 200: pagina(ScriptDto) } } },
        async (req) => scripts.listar(exigirEmpresa(req), req.query),
      );
      app.get(
        "/api/scripts/:id",
        { config: acesso("scripts", "ver"), schema: { tags, summary: "Ver script", params: ParamId, response: { 200: ScriptDto } } },
        async (req) => scripts.obter(exigirEmpresa(req), req.params.id),
      );
      app.post(
        "/api/scripts",
        { config: acesso("scripts", "criar"), schema: { tags, summary: "Criar script", body: ScriptEntrada, response: { 201: ScriptDto } } },
        async (req, reply) => reply.status(201).send(await scripts.salvar(exigirEmpresa(req), origemDe(req), null, req.body)),
      );
      app.patch(
        "/api/scripts/:id",
        { config: acesso("scripts", "editar"), schema: { tags, summary: "Alterar, arquivar ou restaurar script", params: ParamId, body: AtualizarScriptEntrada, response: { 200: ScriptDto } } },
        async (req) => scripts.salvar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
      );
    }
  };
