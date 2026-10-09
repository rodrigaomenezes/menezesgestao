// Contrato do módulo CRM (fase 1): contatos, funis e etapas, oportunidades, tarefas, notas, etiquetas,
// campos personalizados, histórico e importação.
import { z } from "zod";
import { DataIso, FiltroLista, Id, IdOpcional, Paginacao } from "./dto.js";

const texto = (max: number, rotulo: string) =>
  z.string().trim().min(1, { error: `${rotulo}: preencha.` }).max(max, { error: `${rotulo}: no máximo ${max} caracteres.` });
const Cor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: "Use uma cor no formato #RRGGBB." });
const opcional = <T extends z.ZodType>(t: T) => t.nullish();

// Campos personalizados ----------------------------------------------------------------------------

export const TIPOS_CAMPO = ["texto", "numero", "data", "lista", "sim_nao"] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];
export const NOMES_TIPOS_CAMPO: Record<TipoCampo, string> = {
  texto: "Texto",
  numero: "Número",
  data: "Data",
  lista: "Lista de opções",
  sim_nao: "Sim ou não",
};
export const ENTIDADES_CAMPO = ["contato", "oportunidade"] as const;

export const CampoPersonalizadoDto = z.object({
  id: Id,
  entidade: z.enum(ENTIDADES_CAMPO),
  chave: z.string(),
  rotulo: z.string(),
  tipo: z.enum(TIPOS_CAMPO),
  opcoes: z.array(z.string()),
  obrigatorio: z.boolean(),
  ordem: z.number().int(),
  arquivadoEm: DataIso.nullable(),
});
export type CampoPersonalizadoDto = z.infer<typeof CampoPersonalizadoDto>;

export const CampoPersonalizadoEntrada = z.object({
  entidade: z.enum(ENTIDADES_CAMPO),
  chave: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,39}$/, { error: "Identificador: comece com letra; use só minúsculas, números e _ (ex.: data_nascimento)." }),
  rotulo: texto(80, "Nome do campo"),
  tipo: z.enum(TIPOS_CAMPO),
  opcoes: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  obrigatorio: z.boolean().default(false),
  ordem: z.number().int().min(0).max(1000).default(0),
});
export const AtualizarCampoEntrada = CampoPersonalizadoEntrada.omit({ entidade: true, chave: true, tipo: true }).partial();

/** Valores de campos personalizados: chave → texto, número, data ISO, opção ou sim/não. */
export const ValoresCampos = z.record(z.string().max(40), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]));

// Etiquetas, funis, etapas e motivos ---------------------------------------------------------------

export const EtiquetaDto = z.object({ id: Id, nome: z.string(), cor: z.string(), arquivadoEm: DataIso.nullable() });
export type EtiquetaDto = z.infer<typeof EtiquetaDto>;
export const EtiquetaEntrada = z.object({ nome: texto(40, "Nome da etiqueta"), cor: Cor.default("#5b6470") });

export const TIPOS_ETAPA = ["aberta", "ganha", "perdida"] as const;
export type TipoEtapa = (typeof TIPOS_ETAPA)[number];
export const NOMES_TIPOS_ETAPA: Record<TipoEtapa, string> = { aberta: "Em andamento", ganha: "Ganho", perdida: "Perdido" };

export const EtapaDto = z.object({
  id: Id,
  funilId: Id,
  nome: z.string(),
  cor: z.string(),
  ordem: z.number().int(),
  probabilidade: z.number().int(),
  tipo: z.enum(TIPOS_ETAPA),
  camposObrigatorios: z.array(z.string()),
  arquivadoEm: DataIso.nullable(),
});
export type EtapaDto = z.infer<typeof EtapaDto>;
export const EtapaEntrada = z.object({
  funilId: Id,
  nome: texto(60, "Nome da etapa"),
  cor: Cor.default("#1f5fbf"),
  ordem: z.number().int().min(0).max(1000).default(0),
  probabilidade: z.number().int().min(0, { error: "A probabilidade vai de 0 a 100." }).max(100, { error: "A probabilidade vai de 0 a 100." }).default(0),
  tipo: z.enum(TIPOS_ETAPA).default("aberta"),
  camposObrigatorios: z.array(z.string().max(40)).max(30).default([]),
});
export const AtualizarEtapaEntrada = EtapaEntrada.omit({ funilId: true }).partial();

export const FunilDto = z.object({
  id: Id,
  nome: z.string(),
  ordem: z.number().int(),
  arquivadoEm: DataIso.nullable(),
  etapas: z.array(EtapaDto),
});
export type FunilDto = z.infer<typeof FunilDto>;
export const FunilEntrada = z.object({ nome: texto(60, "Nome do funil"), ordem: z.number().int().min(0).max(1000).default(0) });

export const MotivoPerdaDto = z.object({ id: Id, nome: z.string(), ordem: z.number().int(), arquivadoEm: DataIso.nullable() });
export type MotivoPerdaDto = z.infer<typeof MotivoPerdaDto>;
export const MotivoPerdaEntrada = z.object({ nome: texto(80, "Motivo"), ordem: z.number().int().min(0).max(1000).default(0) });

/** Tudo o que os formulários do CRM precisam (listas curtas, só ativos). */
export const ConfiguracaoCrmDto = z.object({
  funis: z.array(FunilDto),
  motivosPerda: z.array(MotivoPerdaDto),
  etiquetas: z.array(EtiquetaDto),
  campos: z.array(CampoPersonalizadoDto),
  responsaveis: z.array(z.object({ id: Id, nome: z.string() })),
});
export type ConfiguracaoCrmDto = z.infer<typeof ConfiguracaoCrmDto>;

// Contatos ----------------------------------------------------------------------------------------

export const TIPOS_CONTATO = ["pessoa", "empresa"] as const;

export const ContatoDto = z.object({
  id: Id,
  tipo: z.enum(TIPOS_CONTATO),
  nome: z.string(),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  organizacaoId: Id.nullable(),
  organizacaoNome: z.string().nullable(),
  responsavelId: Id.nullable(),
  responsavelNome: z.string().nullable(),
  origem: z.string().nullable(),
  campos: z.record(z.string(), z.unknown()),
  naoContatar: z.boolean(),
  consentimentoEm: DataIso.nullable(),
  etiquetas: z.array(z.object({ id: Id, nome: z.string(), cor: z.string() })),
  criadoEm: DataIso,
  atualizadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
  /** LGPD: dados pessoais apagados a pedido do titular ou pelo prazo de retenção. */
  anonimizadoEm: DataIso.nullable(),
});
export type ContatoDto = z.infer<typeof ContatoDto>;

export const ContatoEntrada = z.object({
  tipo: z.enum(TIPOS_CONTATO).default("pessoa"),
  nome: texto(160, "Nome"),
  telefone: opcional(z.string().trim().max(40)),
  email: opcional(z.email({ error: "Informe um e-mail válido." }).max(200)),
  organizacaoId: IdOpcional,
  responsavelId: IdOpcional,
  origem: opcional(z.string().trim().max(80)),
  campos: ValoresCampos.default({}),
  naoContatar: z.boolean().default(false),
  consentimentoEm: opcional(z.iso.datetime({ error: "Data de consentimento inválida." })),
  etiquetaIds: z.array(Id).max(30).default([]),
});
export const AtualizarContatoEntrada = ContatoEntrada.omit({ etiquetaIds: true }).partial();

export const FiltroContatos = FiltroLista.extend({
  etiquetaId: Id.optional(),
  responsavelId: Id.optional(),
  tipo: z.enum(TIPOS_CONTATO).optional(),
});

export const ACOES_EM_MASSA = ["transferir", "arquivar", "restaurar", "etiquetar", "desetiquetar"] as const;
export const AcaoEmMassaEntrada = z.object({
  ids: z.array(Id).min(1, { error: "Selecione ao menos um contato." }).max(200, { error: "Selecione no máximo 200 contatos por vez." }),
  acao: z.enum(ACOES_EM_MASSA),
  responsavelId: IdOpcional,
  etiquetaId: IdOpcional,
});
export const ResultadoEmMassaDto = z.object({ afetados: z.number().int(), ignorados: z.number().int() });

export const EtiquetasContatoEntrada = z.object({ etiquetaIds: z.array(Id).max(30) });

// Oportunidades -----------------------------------------------------------------------------------

export const STATUS_OPORTUNIDADE = ["aberta", "ganha", "perdida"] as const;

export const OportunidadeDto = z.object({
  id: Id,
  contatoId: Id,
  contatoNome: z.string(),
  funilId: Id,
  etapaId: Id,
  titulo: z.string(),
  valorCentavos: z.number().int().nullable(),
  oferta: z.string().nullable(),
  responsavelId: Id.nullable(),
  responsavelNome: z.string().nullable(),
  status: z.enum(STATUS_OPORTUNIDADE),
  motivoPerdaId: Id.nullable(),
  fechadaEm: DataIso.nullable(),
  campos: z.record(z.string(), z.unknown()),
  criadoEm: DataIso,
  atualizadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
});
export type OportunidadeDto = z.infer<typeof OportunidadeDto>;

const ValorCentavos = z.number().int({ error: "Valor em centavos deve ser inteiro." }).min(0).max(1_000_000_000_000);

export const OportunidadeEntrada = z.object({
  contatoId: Id,
  funilId: Id,
  etapaId: IdOpcional,
  titulo: texto(160, "Título"),
  valorCentavos: ValorCentavos.nullish(),
  oferta: opcional(z.string().trim().max(160)),
  responsavelId: IdOpcional,
  campos: ValoresCampos.default({}),
});
export const AtualizarOportunidadeEntrada = OportunidadeEntrada.omit({ contatoId: true, funilId: true, etapaId: true }).partial();
export const MoverEtapaEntrada = z.object({ etapaId: Id, motivoPerdaId: IdOpcional });

export const FiltroOportunidades = FiltroLista.extend({
  funilId: Id.optional(),
  etapaId: Id.optional(),
  contatoId: Id.optional(),
  responsavelId: Id.optional(),
  status: z.enum(STATUS_OPORTUNIDADE).optional(),
});

export const KanbanDto = z.object({
  funil: FunilDto,
  colunas: z.array(
    z.object({ etapaId: Id, total: z.number().int(), valorCentavos: z.number().int(), itens: z.array(OportunidadeDto) }),
  ),
});
export type KanbanDto = z.infer<typeof KanbanDto>;
export const FiltroKanban = z.object({ responsavelId: Id.optional(), busca: z.string().trim().max(100).optional() });

// Tarefas e notas ---------------------------------------------------------------------------------

export const TarefaDto = z.object({
  id: Id,
  contatoId: Id.nullable(),
  contatoNome: z.string().nullable(),
  oportunidadeId: Id.nullable(),
  titulo: z.string(),
  descricao: z.string().nullable(),
  responsavelId: Id.nullable(),
  responsavelNome: z.string().nullable(),
  venceEm: DataIso.nullable(),
  concluidaEm: DataIso.nullable(),
  criadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
});
export type TarefaDto = z.infer<typeof TarefaDto>;
export const TarefaEntrada = z
  .object({
    contatoId: IdOpcional,
    oportunidadeId: IdOpcional,
    titulo: texto(160, "Tarefa"),
    descricao: opcional(z.string().trim().max(2000)),
    responsavelId: IdOpcional,
    venceEm: opcional(z.iso.datetime({ error: "Data de vencimento inválida." })),
  })
  .refine((t) => t.contatoId || t.oportunidadeId, { error: "A tarefa precisa estar ligada a um contato ou oportunidade." });
export const AtualizarTarefaEntrada = z.object({
  titulo: texto(160, "Tarefa").optional(),
  descricao: opcional(z.string().trim().max(2000)),
  responsavelId: IdOpcional,
  venceEm: opcional(z.iso.datetime({ error: "Data de vencimento inválida." })),
  concluida: z.boolean().optional(),
});
export const FiltroTarefas = Paginacao.extend({
  situacao: z.enum(["abertas", "concluidas"]).default("abertas"),
  responsavelId: Id.optional(),
  contatoId: Id.optional(),
  oportunidadeId: Id.optional(),
});

export const NotaDto = z.object({
  id: Id,
  contatoId: Id,
  oportunidadeId: Id.nullable(),
  texto: z.string(),
  autorId: Id.nullable(),
  autorNome: z.string().nullable(),
  criadoEm: DataIso,
  atualizadoEm: DataIso,
});
export type NotaDto = z.infer<typeof NotaDto>;
export const NotaEntrada = z.object({ texto: texto(5000, "Nota"), oportunidadeId: IdOpcional });

// Histórico do contato ----------------------------------------------------------------------------

export const HistoricoDto = z.object({
  id: Id,
  tipo: z.string(),
  entidade: z.string(),
  entidadeId: Id.nullable(),
  atorNome: z.string().nullable(),
  dados: z.record(z.string(), z.unknown()),
  criadoEm: DataIso,
});
export type HistoricoDto = z.infer<typeof HistoricoDto>;

// Importação --------------------------------------------------------------------------------------

export const STATUS_IMPORTACAO = ["PRONTA", "PENDENTE", "PROCESSANDO", "CONCLUIDA", "CONCLUIDA_COM_ERROS", "FALHOU"] as const;
export type StatusImportacao = (typeof STATUS_IMPORTACAO)[number];

/** Destinos possíveis de uma coluna da planilha. Campo personalizado: "campo:<chave>". */
export const DESTINOS_FIXOS = ["nome", "telefone", "email", "origem", "organizacao"] as const;
export const NOMES_DESTINOS: Record<(typeof DESTINOS_FIXOS)[number], string> = {
  nome: "Nome",
  telefone: "Telefone",
  email: "E-mail",
  origem: "Origem",
  organizacao: "Empresa (organização)",
};

export const ImportacaoDto = z.object({
  id: Id,
  nomeArquivo: z.string(),
  status: z.enum(STATUS_IMPORTACAO),
  colunas: z.array(z.string()),
  totalLinhas: z.number().int(),
  amostra: z.array(z.array(z.string())),
  novos: z.number().int(),
  atualizados: z.number().int(),
  inalterados: z.number().int(),
  ignorados: z.number().int(),
  erros: z.array(z.object({ linha: z.number().int(), motivo: z.string() })),
  criadoEm: DataIso,
  concluidaEm: DataIso.nullable(),
  /** Relatório da fila alimentada por esta importação (fase 3). */
  fila: z
    .object({ id: Id, nome: z.string(), novos: z.number().int(), atualizados: z.number().int(), emOutraFila: z.number().int(), jaLigados: z.number().int() })
    .nullable(),
});
export type ImportacaoDto = z.infer<typeof ImportacaoDto>;

export const ConfirmarImportacaoEntrada = z.object({
  /** destino → nome da coluna na planilha. */
  mapeamento: z
    .record(z.string().max(60), z.string().max(200))
    .refine((m) => Boolean(m.nome) && Boolean(m.telefone), { error: "Diga quais colunas têm o nome e o telefone." }),
  responsavelId: IdOpcional,
  etiquetaIds: z.array(Id).max(10).default([]),
  origem: opcional(z.string().trim().max(80)),
  atualizarExistentes: z.boolean().default(true),
  /** Fase 3: alimentar uma fila existente ou criar uma nova com os contatos importados. */
  filaId: IdOpcional,
  novaFila: z.object({ nome: z.string().trim().min(1).max(80), tipoBaseId: IdOpcional }).nullish(),
});
