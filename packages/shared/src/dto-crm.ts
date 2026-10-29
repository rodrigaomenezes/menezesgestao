// Contrato do módulo CRM (fase 1): contatos, funis e etapas, oportunidades, tarefas, notas, etiquetas,
// campos personalizados, histórico e importação.
import { z } from "zod";
import { DataIso, FiltroLista, Id, IdOpcional, MAX_DIAS_ANALISE, Paginacao, validarIntervalo } from "./dto.js";
import { TIPOS_DOCUMENTO } from "./documento.js";
import { DataDia } from "./dto-operacao.js";
import { CODIGOS_MARCOS } from "./dto-bre.js";

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
  /** Conta como inteligência do método BRE (completude do CRM e "o que falta saber"). */
  inteligenciaBre: z.boolean(),
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
  inteligenciaBre: z.boolean().default(false),
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
  /** Marco BRE da etapa (DEC-012); null = o motor BRE ignora a etapa. */
  marcoBre: z.enum(CODIGOS_MARCOS).nullable(),
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
  marcoBre: z.enum(CODIGOS_MARCOS).nullable().default(null),
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
  /** CPF/CNPJ só mascarado (•••.•••.123-45); o inteiro sai por /documento/revelar, com permissão e auditoria. */
  documentoTipo: z.enum(TIPOS_DOCUMENTO).nullable(),
  documentoMascarado: z.string().nullable(),
  etiquetas: z.array(z.object({ id: Id, nome: z.string(), cor: z.string() })),
  criadoEm: DataIso,
  atualizadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
  /** LGPD: dados pessoais apagados a pedido do titular ou pelo prazo de retenção. */
  anonimizadoEm: DataIso.nullable(),
  /** Fundido em outro cadastro (Konecta RF-CRM-008): este fica arquivado e o histórico aparece no destino. */
  fundidoEmId: Id.nullable(),
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
  /** CPF ou CNPJ, com ou sem pontuação; vazio ou null tira o documento. */
  documento: opcional(z.string().trim().max(30)),
  etiquetaIds: z.array(Id).max(30).default([]),
});
export const AtualizarContatoEntrada = ContatoEntrada.omit({ etiquetaIds: true }).partial();

export const FiltroContatos = FiltroLista.extend({
  etiquetaId: Id.optional(),
  responsavelId: Id.optional(),
  tipo: z.enum(TIPOS_CONTATO).optional(),
});

export const DocumentoReveladoDto = z.object({ tipo: z.enum(TIPOS_DOCUMENTO), documento: z.string() });
export type DocumentoReveladoDto = z.infer<typeof DocumentoReveladoDto>;

/** Finalidade obrigatória para exportar (LGPD; Konecta RF-MIG-002): fica registrada na auditoria com os filtros. */
export const FINALIDADES_EXPORTACAO = ["relatorio_interno", "migracao_de_sistema", "campanha_autorizada", "pedido_do_titular", "auditoria"] as const;
export const NOMES_FINALIDADES_EXPORTACAO: Record<(typeof FINALIDADES_EXPORTACAO)[number], string> = {
  relatorio_interno: "Relatório interno",
  migracao_de_sistema: "Migração de sistema",
  campanha_autorizada: "Campanha com consentimento",
  pedido_do_titular: "Pedido do próprio titular",
  auditoria: "Auditoria ou fiscalização",
};
/** Quantas linhas uma exportação traz no máximo (acima disso, filtre mais). */
export const LIMITE_EXPORTACAO_CONTATOS = 10_000;
export const FiltroExportacaoContatos = FiltroContatos.omit({ cursor: true, limite: true }).extend({
  finalidade: z.enum(FINALIDADES_EXPORTACAO, { error: "Escolha a finalidade da exportação." }),
});

// Telefones, e-mails e endereços extras (Konecta RF-CRM-002) ------------------------------------------------
// O telefone e o e-mail principais continuam no contato (o telefone é a chave contra duplicidade); estes são os outros.

export const TIPOS_CANAL = ["telefone", "email"] as const;
export const ROTULOS_CANAL = ["celular", "whatsapp", "comercial", "residencial", "pessoal", "outro"] as const;
export const NOMES_ROTULOS_CANAL: Record<(typeof ROTULOS_CANAL)[number], string> = {
  celular: "Celular",
  whatsapp: "WhatsApp",
  comercial: "Comercial",
  residencial: "Residencial",
  pessoal: "Pessoal",
  outro: "Outro",
};
export const CanalContatoDto = z.object({
  id: Id,
  tipo: z.enum(TIPOS_CANAL),
  /** Telefone em E.164; e-mail em minúsculas. */
  valor: z.string(),
  rotulo: z.enum(ROTULOS_CANAL),
  criadoEm: DataIso,
});
export type CanalContatoDto = z.infer<typeof CanalContatoDto>;
export const CanalContatoEntrada = z.object({
  tipo: z.enum(TIPOS_CANAL),
  valor: texto(200, "Número ou e-mail"),
  rotulo: z.enum(ROTULOS_CANAL).default("outro"),
});
export const ParamCanal = z.object({ id: Id, canalId: Id });

export const ROTULOS_ENDERECO = ["residencial", "comercial", "entrega", "cobranca", "outro"] as const;
export const NOMES_ROTULOS_ENDERECO: Record<(typeof ROTULOS_ENDERECO)[number], string> = {
  residencial: "Residencial",
  comercial: "Comercial",
  entrega: "Entrega",
  cobranca: "Cobrança",
  outro: "Outro",
};
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;
export const EnderecoContatoDto = z.object({
  id: Id,
  rotulo: z.enum(ROTULOS_ENDERECO),
  cep: z.string().nullable(),
  logradouro: z.string(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  cidade: z.string(),
  uf: z.string(),
  principal: z.boolean(),
  criadoEm: DataIso,
  atualizadoEm: DataIso,
});
export type EnderecoContatoDto = z.infer<typeof EnderecoContatoDto>;
const textoOpcional = (max: number, rotulo: string) =>
  opcional(z.string().trim().max(max, { error: `${rotulo}: no máximo ${max} caracteres.` })).transform((v) => v || null);
export const EnderecoContatoEntrada = z.object({
  rotulo: z.enum(ROTULOS_ENDERECO).default("residencial"),
  /** CEP com ou sem traço; guardado só com os 8 dígitos. */
  cep: opcional(z.string().trim().max(10))
    .transform((v) => (v ? v.replace(/\D/g, "") : null))
    .refine((v) => v === null || v.length === 8, { error: "CEP: use os 8 números, por exemplo 01310-100." }),
  logradouro: texto(200, "Rua ou avenida"),
  numero: textoOpcional(20, "Número"),
  complemento: textoOpcional(120, "Complemento"),
  bairro: textoOpcional(120, "Bairro"),
  cidade: texto(120, "Cidade"),
  uf: z.enum(UFS, { error: "Escolha o estado (UF)." }),
  principal: z.boolean().default(false),
});
export const ParamEndereco = z.object({ id: Id, enderecoId: Id });

// Duplicados e fusão (Konecta RF-CRM-004/008) ---------------------------------------------------------------

export const MOTIVOS_DUPLICIDADE = ["email", "nome"] as const;
export const NOMES_MOTIVOS_DUPLICIDADE: Record<(typeof MOTIVOS_DUPLICIDADE)[number], string> = { email: "Mesmo e-mail", nome: "Mesmo nome" };
const ResumoDuplicado = z.object({
  id: Id,
  nome: z.string(),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  responsavelNome: z.string().nullable(),
  criadoEm: DataIso,
});
export const ParDuplicadoDto = z.object({ a: ResumoDuplicado, b: ResumoDuplicado, motivos: z.array(z.enum(MOTIVOS_DUPLICIDADE)) });
export type ParDuplicadoDto = z.infer<typeof ParDuplicadoDto>;
export const ParContatosEntrada = z.object({ contatoA: Id, contatoB: Id }).refine((p) => p.contatoA !== p.contatoB, { error: "Escolha dois cadastros diferentes." });

/** Campos em que a pessoa escolhe qual lado fica; o que não fica vira extra (telefone, e-mail) ou vai para o registro. */
export const CAMPOS_FUSAO = ["nome", "tipo", "telefone", "email", "documento", "origem", "responsavel", "organizacao"] as const;
export type CampoFusao = (typeof CAMPOS_FUSAO)[number];
export const NOMES_CAMPOS_FUSAO: Record<CampoFusao, string> = {
  nome: "Nome",
  tipo: "Tipo",
  telefone: "Telefone principal",
  email: "E-mail principal",
  documento: "CPF/CNPJ",
  origem: "Origem",
  responsavel: "Responsável",
  organizacao: "Empresa",
};
const Lado = z.enum(["destino", "origem"]);
export const FusaoEntrada = z.object({
  /** O cadastro que some (fica arquivado, marcado como fundido no destino da rota). */
  origemId: Id,
  /** Para cada campo, de qual lado vem o valor; o que faltar fica com o destino. */
  manter: z.partialRecord(z.enum(CAMPOS_FUSAO), Lado).default({}),
});
export const FusaoDto = z.object({
  id: Id,
  destinoId: Id,
  origemId: Id,
  /** Quantos registros de cada tipo passaram para o destino (oportunidades, tarefas, conversas…). */
  movidos: z.record(z.string(), z.number().int()),
  incorporados: z.record(z.string(), z.unknown()),
});
export type FusaoDto = z.infer<typeof FusaoDto>;

export const ACOES_EM_MASSA = ["transferir", "arquivar", "restaurar", "etiquetar", "desetiquetar"] as const;
export const AcaoEmMassaEntrada = z.object({
  ids: z.array(Id).min(1, { error: "Selecione ao menos {um contato}." }).max(200, { error: "Selecione no máximo 200 {contatos} por vez." }),
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
  /** Encerramento guiado pelo método BRE (critério e data), quando houve. */
  encerradaBre: z.object({ criterio: z.string(), em: DataIso }).nullable(),
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
  motivoPerdaId: Id.optional(),
  /** Painel do funil: fechadas (ganhas/perdidas) entre estas datas, no fuso da empresa. */
  fechadaDe: DataDia.optional(),
  fechadaAte: DataDia.optional(),
  /** Painel do funil: criadas entre estas datas. */
  criadaDe: DataDia.optional(),
  criadaAte: DataDia.optional(),
  /** Conversão do painel: só as que pararam nesta etapa (chegaram nela e não passaram da seguinte; nem ganharam). */
  parouEm: Id.optional(),
});

// Painel do funil (do todo ao micro) ----------------------------------------------------------------------

export const FiltroPainelFunil = z
  .object({ funilId: Id, inicio: DataDia, fim: DataDia, responsavelId: Id.optional() })
  .superRefine(validarIntervalo(MAX_DIAS_ANALISE));
const TotaisFunil = z.object({
  /** Criadas no período. */
  entraram: z.number().int(),
  /** Fechadas no período. */
  ganhas: z.number().int(),
  perdidas: z.number().int(),
  valorGanhoCentavos: z.number().int(),
  /** Ganhas ÷ (ganhas + perdidas) no período, em %; null sem nenhuma fechada. */
  conversao: z.number().nullable(),
  /** Dias médios da criação ao ganho, das ganhas no período. */
  cicloMedioDias: z.number().nullable(),
});
export const PainelFunilDto = z.object({
  inicio: DataDia,
  fim: DataDia,
  anterior: z.object({ inicio: DataDia, fim: DataDia }),
  totais: TotaisFunil,
  totaisAnteriores: TotaisFunil,
  /** Abertas AGORA em cada etapa aberta do funil (retrato do momento, não do período), na ordem do funil. */
  etapas: z.array(z.object({ etapaId: Id, nome: z.string(), quantidade: z.number().int(), valorCentavos: z.number().int() })),
  /** Perdidas no período por motivo (maior primeiro); motivo null = sem motivo informado. */
  motivos: z.array(z.object({ motivoPerdaId: Id.nullable(), nome: z.string(), quantidade: z.number().int() })),
  /** Ganhas no período por responsável (valor maior primeiro), até 20. Não usa o filtro de responsável. */
  responsaveis: z.array(z.object({ usuarioId: Id, nome: z.string(), ganhas: z.number().int(), valorCentavos: z.number().int() })),
  /** Ganhas por dia (com zeros). */
  serie: z.array(z.object({ dia: DataDia, valor: z.number() })),
  /**
   * Conversão entre etapas de quem entrou no período (coorte): quantas chegaram a cada etapa aberta (passaram por ela
   * ou por uma depois dela, ou ganharam) e quantas pararam ali. `ganharam` fecha o funil.
   */
  conversao: z.object({
    etapas: z.array(z.object({ etapaId: Id, nome: z.string(), chegaram: z.number().int(), pararam: z.number().int() })),
    ganharam: z.number().int(),
  }),
});
export type PainelFunilDto = z.infer<typeof PainelFunilDto>;

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
  .refine((t) => t.contatoId || t.oportunidadeId, { error: "A tarefa precisa estar ligada a {um contato} ou {uma oportunidade}." });
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
