// Contrato da fase 4: rotina diária, agenda, escala e horas, atividades, metas/desempenho e scripts.
import { z } from "zod";
import { DataIso, Id, IdOpcional, Paginacao } from "./dto.js";

const texto = (max: number, rotulo: string) =>
  z.string().trim().min(1, { error: `${rotulo}: preencha.` }).max(max, { error: `${rotulo}: no máximo ${max} caracteres.` });
const textoOpcional = (max: number, rotulo: string) =>
  z.string().trim().max(max, { error: `${rotulo}: no máximo ${max} caracteres.` }).nullish().transform((v) => (v ? v : null));
const Instante = z.iso.datetime({ offset: true, error: "Data e hora inválidas." });
export const DataDia = z.iso.date({ error: "Data inválida (use AAAA-MM-DD)." });
export const Mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Mês inválido (use AAAA-MM)." });
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Hora inválida (use HH:MM)." });

// Indicadores (calculados só dos eventos) -----------------------------------------------------------------

export const INDICADORES = [
  { id: "ligacoes", nome: "Ligações feitas", formato: "numero" },
  { id: "ligacoes_atendidas", nome: "Ligações atendidas", formato: "numero" },
  { id: "minutos_ligacao", nome: "Minutos em ligação", formato: "numero" },
  { id: "mensagens", nome: "Mensagens enviadas", formato: "numero" },
  { id: "conversas_resolvidas", nome: "Conversas resolvidas", formato: "numero" },
  { id: "contatos_novos", nome: "Contatos cadastrados", formato: "numero" },
  { id: "oportunidades_criadas", nome: "Oportunidades abertas", formato: "numero" },
  { id: "vendas", nome: "Oportunidades ganhas", formato: "numero" },
  { id: "valor_vendido", nome: "Valor ganho", formato: "moeda" },
  { id: "tarefas_concluidas", nome: "Tarefas concluídas", formato: "numero" },
  { id: "resultados_fila", nome: "Resultados na fila", formato: "numero" },
] as const;
export type IndicadorId = (typeof INDICADORES)[number]["id"];
export const IDS_INDICADORES = INDICADORES.map((i) => i.id) as [IndicadorId, ...IndicadorId[]];
export const NOMES_INDICADORES = Object.fromEntries(INDICADORES.map((i) => [i.id, i.nome])) as Record<IndicadorId, string>;

export function formatarIndicador(id: IndicadorId, valor: number): string {
  const ind = INDICADORES.find((i) => i.id === id);
  if (ind?.formato === "moeda") return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return Number.isInteger(valor) ? String(valor) : valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export const PERIODOS = ["dia", "semana", "mes"] as const;
export type PeriodoId = (typeof PERIODOS)[number];
export const NOMES_PERIODOS: Record<PeriodoId, string> = { dia: "Por dia", semana: "Por semana", mes: "Por mês" };

// Metas e desempenho --------------------------------------------------------------------------------------

export const ALVOS_META = ["pessoa", "equipe", "empresa"] as const;
export const MetaDto = z.object({
  id: Id,
  alvo: z.enum(ALVOS_META),
  usuarioId: Id.nullable(),
  equipeId: Id.nullable(),
  alvoNome: z.string(),
  indicador: z.enum(IDS_INDICADORES),
  periodo: z.enum(PERIODOS),
  valor: z.number(),
  realizado: z.number(),
  percentual: z.number(),
  inicioPeriodo: DataDia,
  fimPeriodo: DataDia,
  arquivadoEm: DataIso.nullable(),
});
export type MetaDto = z.infer<typeof MetaDto>;
export const MetaEntrada = z.object({
  alvo: z.enum(ALVOS_META),
  usuarioId: IdOpcional,
  equipeId: IdOpcional,
  indicador: z.enum(IDS_INDICADORES),
  periodo: z.enum(PERIODOS),
  valor: z.number().positive({ error: "A meta precisa ser maior que zero." }).max(1e12),
});
export const AtualizarMetaEntrada = z.object({ valor: MetaEntrada.shape.valor.optional(), arquivar: z.boolean().optional() });
export const FiltroMetas = Paginacao.extend({
  data: DataDia.optional(),
  alvo: z.enum(ALVOS_META).optional(),
  arquivados: z.enum(["sim", "nao"]).default("nao"),
});

export const FiltroDesempenho = Paginacao.extend({
  periodo: z.enum(PERIODOS).default("dia"),
  data: DataDia.optional(),
  equipeId: Id.optional(),
});
export const LinhaDesempenhoDto = z.object({
  usuarioId: Id,
  nome: z.string(),
  valores: z.record(z.string(), z.number()),
});
export const DesempenhoDto = z.object({
  inicio: DataDia,
  fim: DataDia,
  itens: z.array(LinhaDesempenhoDto),
  proximoCursor: z.string().nullable(),
});
export type DesempenhoDto = z.infer<typeof DesempenhoDto>;

// Mapa de atividades ------------------------------------------------------------------------------------

export const TIPOS_ATIVIDADE = ["reuniao", "treinamento", "visita", "atendimento", "pausa", "outro"] as const;
export type TipoAtividadeId = (typeof TIPOS_ATIVIDADE)[number];
export const NOMES_TIPOS_ATIVIDADE: Record<TipoAtividadeId, string> = {
  reuniao: "Reunião",
  treinamento: "Treinamento",
  visita: "Visita",
  atendimento: "Atendimento presencial",
  pausa: "Pausa",
  outro: "Outro",
};

/** Grupos de eventos que aparecem no mapa. */
export const CATEGORIAS_MAPA = ["ligacoes", "mensagens", "crm", "fila"] as const;
export type CategoriaMapa = (typeof CATEGORIAS_MAPA)[number];
export const NOMES_CATEGORIAS_MAPA: Record<CategoriaMapa, string> = {
  ligacoes: "Ligações",
  mensagens: "Mensagens",
  crm: "Cadastros e funil",
  fila: "Fila",
};

export const HoraMapaDto = z.object({
  hora: z.number().int(),
  acoes: z.number().int(),
  ligacoes: z.number().int(),
  mensagens: z.number().int(),
  crm: z.number().int(),
  fila: z.number().int(),
  manualMinutos: z.number().int(),
  manualTipos: z.array(z.string()),
});
export const LinhaMapaDto = z.object({ usuarioId: Id, nome: z.string(), horas: z.array(HoraMapaDto) });
export type LinhaMapaDto = z.infer<typeof LinhaMapaDto>;
export const FiltroMapa = Paginacao.extend({ data: DataDia.optional(), equipeId: Id.optional() });

export const AtividadeDto = z.object({
  id: Id,
  usuarioId: Id,
  usuarioNome: z.string().nullable(),
  tipo: z.enum(TIPOS_ATIVIDADE),
  descricao: z.string().nullable(),
  inicio: DataIso,
  fim: DataIso,
});
export type AtividadeDto = z.infer<typeof AtividadeDto>;
export const AtividadeEntrada = z.object({
  usuarioId: IdOpcional,
  tipo: z.enum(TIPOS_ATIVIDADE),
  descricao: textoOpcional(300, "Descrição"),
  inicio: Instante,
  fim: Instante,
});
export const AtualizarAtividadeEntrada = z.object({
  tipo: z.enum(TIPOS_ATIVIDADE).optional(),
  descricao: textoOpcional(300, "Descrição").optional(),
  inicio: Instante.optional(),
  fim: Instante.optional(),
  arquivar: z.boolean().optional(),
});
export const FiltroAtividades = Paginacao.extend({ data: DataDia.optional(), usuarioId: Id.optional() });

// Agenda --------------------------------------------------------------------------------------------------

export const CompromissoDto = z.object({
  id: Id,
  usuarioId: Id,
  usuarioNome: z.string().nullable(),
  contatoId: Id.nullable(),
  contatoNome: z.string().nullable(),
  titulo: z.string(),
  descricao: z.string().nullable(),
  local: z.string().nullable(),
  inicio: DataIso,
  fim: DataIso,
  lembreteMinutos: z.number().int().nullable(),
  arquivadoEm: DataIso.nullable(),
});
export type CompromissoDto = z.infer<typeof CompromissoDto>;
export const CompromissoEntrada = z.object({
  usuarioId: IdOpcional,
  contatoId: IdOpcional,
  titulo: texto(200, "Título"),
  descricao: textoOpcional(2000, "Descrição"),
  local: textoOpcional(200, "Local"),
  inicio: Instante,
  fim: Instante,
  lembreteMinutos: z.number().int().min(0).max(1440).nullish(),
});
export const AtualizarCompromissoEntrada = CompromissoEntrada.partial().extend({ arquivar: z.boolean().optional() });
export const FiltroCompromissos = Paginacao.extend({
  de: DataDia,
  ate: DataDia,
  usuarioId: Id.optional(),
});

// Escala e horas ----------------------------------------------------------------------------------------

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export const IntervaloEscala = z
  .object({ diaSemana: z.number().int().min(0).max(6), inicio: Hora, fim: Hora })
  .refine((i) => i.fim > i.inicio, { error: "O fim do intervalo precisa ser depois do início." });
export const EscalaDto = z.object({
  usuarioId: Id,
  intervalos: z.array(z.object({ diaSemana: z.number().int(), inicio: z.string(), fim: z.string() })),
  minutosSemana: z.number().int(),
});
export type EscalaDto = z.infer<typeof EscalaDto>;
export const EscalaEntrada = z.object({ intervalos: z.array(IntervaloEscala).max(28) });

export const STATUS_HORAS = ["aberto", "pendente", "validado", "recusado"] as const;
export type StatusHorasId = (typeof STATUS_HORAS)[number];
export const NOMES_STATUS_HORAS: Record<StatusHorasId, string> = {
  aberto: "Em andamento",
  pendente: "Aguardando validação",
  validado: "Validado",
  recusado: "Recusado",
};

export const RegistroHorasDto = z.object({
  id: Id,
  usuarioId: Id,
  usuarioNome: z.string().nullable(),
  data: DataDia,
  entrada: DataIso,
  saida: DataIso.nullable(),
  minutos: z.number().int().nullable(),
  observacao: z.string().nullable(),
  status: z.enum(STATUS_HORAS),
  validadoPorNome: z.string().nullable(),
  validadoEm: DataIso.nullable(),
  motivo: z.string().nullable(),
  fechado: z.boolean(),
});
export type RegistroHorasDto = z.infer<typeof RegistroHorasDto>;
export const RegistroHorasEntrada = z.object({
  usuarioId: IdOpcional,
  entrada: Instante,
  saida: Instante,
  observacao: textoOpcional(500, "Observação"),
});
export const AtualizarRegistroHorasEntrada = z.object({
  entrada: Instante.optional(),
  saida: Instante.optional(),
  observacao: textoOpcional(500, "Observação").optional(),
  arquivar: z.boolean().optional(),
});
export const ValidarHorasEntrada = z.object({ aprovar: z.boolean(), motivo: textoOpcional(500, "Motivo") });
export const FiltroHoras = Paginacao.extend({
  mes: Mes,
  usuarioId: Id.optional(),
  status: z.enum(STATUS_HORAS).optional(),
});
export const ResumoHorasDto = z.object({
  usuarioId: Id,
  nome: z.string(),
  previstoMinutos: z.number().int(),
  registradoMinutos: z.number().int(),
  validadoMinutos: z.number().int(),
  pendentes: z.number().int(),
  emAndamento: z.boolean(),
});
export type ResumoHorasDto = z.infer<typeof ResumoHorasDto>;
export const FiltroResumoHoras = Paginacao.extend({ mes: Mes });
export const FechamentoDto = z.object({
  id: Id,
  mes: Mes,
  fechadoEm: DataIso,
  fechadoPorNome: z.string().nullable(),
  reabertoEm: DataIso.nullable(),
  reabertoPorNome: z.string().nullable(),
  motivoReabertura: z.string().nullable(),
});
export type FechamentoDto = z.infer<typeof FechamentoDto>;
export const FecharMesEntrada = z.object({ mes: Mes });
export const ReabrirMesEntrada = z.object({ motivo: texto(500, "Motivo") });

export function formatarMinutos(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// Rotina diária ----------------------------------------------------------------------------------------

export const ChecklistItemDto = z.object({
  id: Id,
  perfilId: Id.nullable(),
  perfilNome: z.string().nullable(),
  texto: z.string(),
  ordem: z.number().int(),
});
export type ChecklistItemDto = z.infer<typeof ChecklistItemDto>;
export const ChecklistItemEntrada = z.object({
  perfilId: IdOpcional,
  texto: texto(200, "Item"),
  ordem: z.number().int().min(0).max(10000).optional(),
});
export const AtualizarChecklistItemEntrada = ChecklistItemEntrada.partial().extend({ arquivar: z.boolean().optional() });
export const MarcarChecklistEntrada = z.object({ feito: z.boolean() });

export const RotinaDto = z.object({
  data: DataDia,
  tarefas: z
    .object({
      vencidas: z.number().int(),
      hoje: z.number().int(),
      itens: z.array(z.object({ id: Id, titulo: z.string(), venceEm: DataIso.nullable(), contatoId: Id.nullable(), contatoNome: z.string().nullable() })),
    })
    .nullable(),
  retornos: z
    .array(z.object({ itemId: Id, filaId: Id, filaNome: z.string(), contatoId: Id, contatoNome: z.string(), retornarEm: DataIso }))
    .nullable(),
  conversas: z
    .array(z.object({ id: Id, contatoNome: z.string().nullable(), telefone: z.string().nullable(), ultimaMensagem: z.string().nullable(), ultimaEntradaEm: DataIso.nullable() }))
    .nullable(),
  compromissos: z.array(CompromissoDto).nullable(),
  checklist: z.array(z.object({ itemId: Id, texto: z.string(), feito: z.boolean() })),
  metas: z.array(MetaDto).nullable(),
});
export type RotinaDto = z.infer<typeof RotinaDto>;

// Scripts ---------------------------------------------------------------------------------------------

export const USOS_SCRIPT = ["todos", "conversa", "ligacao"] as const;
export const NOMES_USOS_SCRIPT: Record<(typeof USOS_SCRIPT)[number], string> = {
  todos: "Conversa e ligação",
  conversa: "Só conversa",
  ligacao: "Só ligação",
};
export const ScriptDto = z.object({
  id: Id,
  titulo: z.string(),
  texto: z.string(),
  uso: z.enum(USOS_SCRIPT),
  funilId: Id.nullable(),
  funilNome: z.string().nullable(),
  etapaId: Id.nullable(),
  etapaNome: z.string().nullable(),
  ordem: z.number().int(),
  arquivadoEm: DataIso.nullable(),
});
export type ScriptDto = z.infer<typeof ScriptDto>;
export const ScriptEntrada = z.object({
  titulo: texto(120, "Título"),
  texto: texto(20000, "Texto"),
  uso: z.enum(USOS_SCRIPT).default("todos"),
  funilId: IdOpcional,
  etapaId: IdOpcional,
  ordem: z.number().int().min(0).max(10000).optional(),
});
export const AtualizarScriptEntrada = z.object({
  titulo: ScriptEntrada.shape.titulo.optional(),
  texto: ScriptEntrada.shape.texto.optional(),
  uso: z.enum(USOS_SCRIPT).optional(),
  funilId: IdOpcional,
  etapaId: IdOpcional,
  ordem: ScriptEntrada.shape.ordem,
  arquivar: z.boolean().optional(),
});
export const FiltroScripts = Paginacao.extend({
  uso: z.enum(["conversa", "ligacao"]).optional(),
  /** Scripts da etapa em que o contato está (oportunidade aberta mais recente) primeiro, depois os gerais. */
  contatoId: Id.optional(),
  etapaId: Id.optional(),
  busca: z.string().trim().max(100).optional(),
  arquivados: z.enum(["sim", "nao"]).default("nao"),
});
