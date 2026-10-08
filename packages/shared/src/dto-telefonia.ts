// Contrato da fase 3: telefonia (ligações, ramais, gravação) e filas de discagem ativa.
import { z } from "zod";
import { DataIso, Id, IdOpcional, Paginacao } from "./dto.js";

const texto = (max: number, rotulo: string) =>
  z.string().trim().min(1, { error: `${rotulo}: preencha.` }).max(max, { error: `${rotulo}: no máximo ${max} caracteres.` });

// Ligações ----------------------------------------------------------------------------------------

export const PROVEDORES_TELEFONE = ["treino", "celular", "sip"] as const;
export type ProvedorTelefoneId = (typeof PROVEDORES_TELEFONE)[number];
export const NOMES_PROVEDORES_TELEFONE: Record<ProvedorTelefoneId, string> = {
  treino: "Modo treino (simulado)",
  celular: "Celular do vendedor",
  sip: "Telefone pelo navegador (SIP)",
};

export const ESTADOS_LIGACAO = ["criada", "discando", "tocando", "em_ligacao", "em_espera", "encerrada"] as const;
export type EstadoLigacaoId = (typeof ESTADOS_LIGACAO)[number];
export const NOMES_ESTADOS_LIGACAO: Record<EstadoLigacaoId, string> = {
  criada: "Preparando",
  discando: "Discando",
  tocando: "Chamando",
  em_ligacao: "Em ligação",
  em_espera: "Em espera",
  encerrada: "Encerrada",
};

/** Transições válidas (a tela e o servidor usam a mesma regra). */
export const TRANSICOES_LIGACAO: Record<EstadoLigacaoId, readonly EstadoLigacaoId[]> = {
  criada: ["discando", "encerrada"],
  discando: ["tocando", "em_ligacao", "encerrada"],
  tocando: ["em_ligacao", "encerrada"],
  em_ligacao: ["em_espera", "encerrada"],
  em_espera: ["em_ligacao", "encerrada"],
  encerrada: [],
};

export function transicaoValida(de: EstadoLigacaoId, para: EstadoLigacaoId): boolean {
  return de === para || TRANSICOES_LIGACAO[de].includes(para);
}

export const LigacaoDto = z.object({
  id: Id,
  contatoId: Id.nullable(),
  contatoNome: z.string().nullable(),
  oportunidadeId: Id.nullable(),
  filaItemId: Id.nullable(),
  usuarioId: Id,
  usuarioNome: z.string().nullable(),
  provedor: z.enum(PROVEDORES_TELEFONE),
  direcao: z.enum(["saida", "entrada"]),
  numero: z.string(),
  estado: z.enum(ESTADOS_LIGACAO),
  iniciadaEm: DataIso,
  atendidaEm: DataIso.nullable(),
  encerradaEm: DataIso.nullable(),
  duracaoSegundos: z.number().int().nullable(),
  motivoFim: z.string().nullable(),
  resultadoId: Id.nullable(),
  resultadoNome: z.string().nullable(),
  observacao: z.string().nullable(),
  temGravacao: z.boolean(),
});
export type LigacaoDto = z.infer<typeof LigacaoDto>;

export const NovaLigacaoEntrada = z
  .object({
    provedor: z.enum(PROVEDORES_TELEFONE),
    numero: z.string().trim().max(40).nullish(),
    contatoId: IdOpcional,
    oportunidadeId: IdOpcional,
    filaItemId: IdOpcional,
  })
  .refine((l) => l.numero || l.contatoId || l.filaItemId, { error: "Informe o número ou o contato." });

export const EstadoLigacaoEntrada = z.object({
  estado: z.enum(ESTADOS_LIGACAO),
  idExterno: z.string().trim().max(200).nullish(),
  /** Motivo do fim (ex.: "ocupado", "não atendeu", "desligou") ou detalhe da mudança. */
  detalhe: z.string().trim().max(200).nullish(),
});

export const FinalizarLigacaoEntrada = z.object({
  resultadoId: IdOpcional,
  observacao: z.string().trim().max(2000).nullish(),
});

export const FiltroLigacoes = Paginacao.extend({ contatoId: Id.optional(), usuarioId: Id.optional() });

// Configuração e ramais ---------------------------------------------------------------------------

export const TelefoniaConfigDto = z.object({
  sipServidor: z.string().nullable(),
  sipDominio: z.string().nullable(),
  gravacaoAtiva: z.boolean(),
  avisoGravacao: z.string(),
  retencaoDias: z.number().int(),
});
export type TelefoniaConfigDto = z.infer<typeof TelefoniaConfigDto>;

export const TelefoniaConfigEntrada = z.object({
  sipServidor: z
    .string()
    .trim()
    .regex(/^wss:\/\/[^\s]+$/, { error: "O servidor SIP precisa começar com wss:// (WebSocket seguro)." })
    .max(300)
    .nullish(),
  sipDominio: z.string().trim().max(200).nullish(),
  gravacaoAtiva: z.boolean(),
  avisoGravacao: texto(300, "Aviso de gravação"),
  retencaoDias: z.number().int().min(1, { error: "Retenção mínima de 1 dia." }).max(3650),
});

export const RamalDto = z.object({ usuarioId: Id, usuarioNome: z.string(), login: z.string(), ativo: z.boolean() });
export type RamalDto = z.infer<typeof RamalDto>;
export const RamalEntrada = z.object({
  login: texto(100, "Usuário do ramal"),
  /** Senha do ramal: só entra; vazio mantém a atual. */
  senha: z.string().max(200).nullish(),
  ativo: z.boolean().default(true),
});
export const ParamUsuario = z.object({ usuarioId: Id });

/** O que o navegador precisa para registrar o ramal SIP (só a própria pessoa recebe). */
export const MeuTelefoneDto = z.object({
  provedores: z.array(z.enum(PROVEDORES_TELEFONE)),
  sip: z.object({ servidor: z.string(), dominio: z.string(), login: z.string(), senha: z.string() }).nullable(),
  gravacaoAtiva: z.boolean(),
  avisoGravacao: z.string(),
});
export type MeuTelefoneDto = z.infer<typeof MeuTelefoneDto>;

// Resultados e tipos de base ---------------------------------------------------------------------

export const ACOES_RESULTADO = ["nenhuma", "reagendar", "encerrar", "descartar", "converter"] as const;
export const NOMES_ACOES_RESULTADO: Record<(typeof ACOES_RESULTADO)[number], string> = {
  nenhuma: "Só registrar",
  reagendar: "Ligar de novo depois",
  encerrar: "Tirar da fila",
  descartar: "Descartar (número inválido)",
  converter: "Converter para o funil",
};

export const ResultadoLigacaoDto = z.object({
  id: Id,
  nome: z.string(),
  acao: z.enum(ACOES_RESULTADO),
  horas: z.number().int().nullable(),
  atendida: z.boolean(),
  ordem: z.number().int(),
  arquivadoEm: DataIso.nullable(),
});
export type ResultadoLigacaoDto = z.infer<typeof ResultadoLigacaoDto>;
export const ResultadoLigacaoEntrada = z.object({
  nome: texto(80, "Nome do resultado"),
  acao: z.enum(ACOES_RESULTADO),
  /** Reagendar: em quantas horas (vazio = a pessoa escolhe a data). */
  horas: z.number().int().min(1).max(8760).nullish(),
  atendida: z.boolean().default(false),
  ordem: z.number().int().min(0).max(1000).default(0),
});
export const AtualizarResultadoEntrada = ResultadoLigacaoEntrada.partial().extend({ arquivado: z.boolean().optional() });

export const TipoBaseDto = z.object({ id: Id, nome: z.string(), arquivadoEm: DataIso.nullable() });
export type TipoBaseDto = z.infer<typeof TipoBaseDto>;
export const TipoBaseEntrada = z.object({ nome: texto(60, "Tipo de base"), arquivado: z.boolean().optional() });

// Filas -------------------------------------------------------------------------------------------

export const STATUS_FILA = ["ativa", "pausada", "encerrada"] as const;
export const NOMES_STATUS_FILA: Record<(typeof STATUS_FILA)[number], string> = { ativa: "Ativa", pausada: "Pausada", encerrada: "Encerrada" };

export const FilaDto = z.object({
  id: Id,
  nome: z.string(),
  tipoBaseId: Id.nullable(),
  tipoBaseNome: z.string().nullable(),
  status: z.enum(STATUS_FILA),
  funilId: Id.nullable(),
  etapaId: Id.nullable(),
  reservaMinutos: z.number().int(),
  maxTentativas: z.number().int(),
  /** Prontos para ligar agora (pendentes sem retorno marcado para depois). */
  prontos: z.number().int(),
  agendados: z.number().int(),
  reservados: z.number().int(),
  concluidos: z.number().int(),
  total: z.number().int(),
  arquivadoEm: DataIso.nullable(),
});
export type FilaDto = z.infer<typeof FilaDto>;

export const FilaEntrada = z.object({
  nome: texto(80, "Nome da fila"),
  tipoBaseId: IdOpcional,
  funilId: IdOpcional,
  etapaId: IdOpcional,
  reservaMinutos: z.number().int().min(1).max(240).default(15),
  maxTentativas: z.number().int().min(1).max(50).default(5),
});
export const AtualizarFilaEntrada = FilaEntrada.partial().extend({
  status: z.enum(STATUS_FILA).optional(),
  arquivado: z.boolean().optional(),
});

export const STATUS_ITEM_FILA = ["pendente", "reservado", "concluido", "descartado"] as const;

export const FilaItemDto = z.object({
  id: Id,
  filaId: Id,
  filaNome: z.string(),
  contatoId: Id,
  contatoNome: z.string(),
  telefone: z.string().nullable(),
  status: z.enum(STATUS_ITEM_FILA),
  tentativas: z.number().int(),
  retornarEm: DataIso.nullable(),
  reservadoAte: DataIso.nullable(),
  reservadoPorNome: z.string().nullable(),
  ultimoResultadoNome: z.string().nullable(),
});
export type FilaItemDto = z.infer<typeof FilaItemDto>;

export const ProximoDto = z.object({ item: FilaItemDto.nullable(), motivo: z.string().nullable() });
export type ProximoDto = z.infer<typeof ProximoDto>;

export const FiltroItensFila = Paginacao.extend({ status: z.enum(STATUS_ITEM_FILA).optional() });

export const AdicionarItensEntrada = z.object({
  contatoIds: z.array(Id).min(1, { error: "Escolha ao menos um contato." }).max(500, { error: "No máximo 500 por vez." }),
});
export const ResultadoAdicionarDto = z.object({ adicionados: z.number().int(), emOutraFila: z.number().int(), jaNaFila: z.number().int(), semTelefone: z.number().int() });

export const RegistrarResultadoEntrada = z.object({
  resultadoId: Id,
  observacao: z.string().trim().max(2000).nullish(),
  /** Para resultados "retornar em…" sem horas fixas. */
  retornarEm: z.iso.datetime({ error: "Data de retorno inválida." }).nullish(),
  ligacaoId: IdOpcional,
});
export const RegistrarResultadoDto = z.object({
  item: FilaItemDto,
  oportunidadeId: Id.nullable(),
});

export const FilaLoteDto = z.object({
  id: Id,
  importacaoId: Id.nullable(),
  novos: z.number().int(),
  atualizados: z.number().int(),
  emOutraFila: z.number().int(),
  jaLigados: z.number().int(),
  ignorados: z.number().int(),
  criadoEm: DataIso,
});
export type FilaLoteDto = z.infer<typeof FilaLoteDto>;
