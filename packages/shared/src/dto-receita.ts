// Contrato da fase 5: ofertas e entregas, vendas e comissões, monitoramento de qualidade e pesquisas.
import { z } from "zod";
import { DataIso, Id, IdOpcional, Paginacao } from "./dto.js";
import { DataDia, Mes } from "./dto-operacao.js";

const texto = (max: number, rotulo: string) =>
  z.string().trim().min(1, { error: `${rotulo}: preencha.` }).max(max, { error: `${rotulo}: no máximo ${max} caracteres.` });
const textoOpcional = (max: number, rotulo: string) =>
  z.string().trim().max(max, { error: `${rotulo}: no máximo ${max} caracteres.` }).nullish().transform((v) => (v ? v : null));
const Centavos = z.number().int({ error: "Valor inválido." }).min(0).max(1e13);

// Ofertas e entregas ------------------------------------------------------------------------------------

export const OfertaDto = z.object({
  id: Id,
  nome: z.string(),
  descricao: z.string().nullable(),
  precoCentavos: z.number().int().nullable(),
  arquivadoEm: DataIso.nullable(),
});
export type OfertaDto = z.infer<typeof OfertaDto>;
export const OfertaEntrada = z.object({
  nome: texto(120, "Nome"),
  descricao: textoOpcional(2000, "Descrição"),
  precoCentavos: Centavos.nullish(),
});
export const AtualizarOfertaEntrada = OfertaEntrada.partial().extend({ arquivar: z.boolean().optional() });
export const FiltroOfertas = Paginacao.extend({
  arquivados: z.enum(["sim", "nao"]).default("nao"),
  busca: z.string().trim().max(100).optional(),
});

export const EntregaDto = z.object({
  id: Id,
  ofertaId: Id,
  ofertaNome: z.string().nullable(),
  nome: z.string(),
  prestadorId: Id.nullable(),
  prestadorNome: z.string().nullable(),
  capacidade: z.number().int().nullable(),
  ocupadas: z.number().int(),
  inicio: DataDia.nullable(),
  fim: DataDia.nullable(),
  horario: z.string().nullable(),
  status: z.enum(["aberta", "encerrada"]),
  arquivadoEm: DataIso.nullable(),
});
export type EntregaDto = z.infer<typeof EntregaDto>;
export const EntregaEntrada = z.object({
  ofertaId: Id,
  nome: texto(120, "Nome"),
  prestadorId: IdOpcional,
  capacidade: z.number().int().min(1).max(100000).nullish(),
  inicio: DataDia.nullish(),
  fim: DataDia.nullish(),
  horario: textoOpcional(200, "Horário"),
});
export const AtualizarEntregaEntrada = EntregaEntrada.partial().extend({
  status: z.enum(["aberta", "encerrada"]).optional(),
  arquivar: z.boolean().optional(),
});
export const FiltroEntregas = Paginacao.extend({
  ofertaId: Id.optional(),
  status: z.enum(["aberta", "encerrada"]).optional(),
  arquivados: z.enum(["sim", "nao"]).default("nao"),
});
export const ParticipanteDto = z.object({
  id: Id,
  contatoId: Id,
  contatoNome: z.string().nullable(),
  vendaId: Id.nullable(),
  status: z.enum(["ativo", "cancelado"]),
  criadoEm: DataIso,
});
export type ParticipanteDto = z.infer<typeof ParticipanteDto>;
export const ParticipanteEntrada = z.object({ contatoId: Id });

// Vendas ------------------------------------------------------------------------------------------------

export const FORMAS_PAGAMENTO = ["pix", "cartao", "boleto", "dinheiro", "transferencia", "outro"] as const;
export const NOMES_FORMAS_PAGAMENTO: Record<(typeof FORMAS_PAGAMENTO)[number], string> = {
  pix: "Pix",
  cartao: "Cartão",
  boleto: "Boleto",
  dinheiro: "Dinheiro",
  transferencia: "Transferência",
  outro: "Outro",
};
export const STATUS_VENDA = ["pendente", "confirmada", "cancelada"] as const;
export type StatusVendaId = (typeof STATUS_VENDA)[number];
export const NOMES_STATUS_VENDA: Record<StatusVendaId, string> = { pendente: "Aguardando pagamento", confirmada: "Confirmada", cancelada: "Cancelada" };

export const VendaDto = z.object({
  id: Id,
  contatoId: Id,
  contatoNome: z.string().nullable(),
  ofertaId: Id,
  ofertaNome: z.string().nullable(),
  vendedorId: Id,
  vendedorNome: z.string().nullable(),
  oportunidadeId: Id.nullable(),
  entregaId: Id.nullable(),
  entregaNome: z.string().nullable(),
  valorCentavos: z.number().int(),
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
  parcelas: z.number().int(),
  status: z.enum(STATUS_VENDA),
  dataVenda: DataDia,
  observacao: z.string().nullable(),
  motivoCancelamento: z.string().nullable(),
  fechada: z.boolean(),
  criadoEm: DataIso,
});
export type VendaDto = z.infer<typeof VendaDto>;
export const VendaEntrada = z.object({
  contatoId: Id,
  ofertaId: Id,
  vendedorId: IdOpcional,
  oportunidadeId: IdOpcional,
  entregaId: IdOpcional,
  valorCentavos: Centavos.refine((v) => v > 0, { error: "O valor precisa ser maior que zero." }),
  formaPagamento: z.enum(FORMAS_PAGAMENTO),
  parcelas: z.number().int().min(1).max(60).default(1),
  dataVenda: DataDia.optional(),
  status: z.enum(["pendente", "confirmada"]).default("pendente"),
  observacao: textoOpcional(1000, "Observação"),
});
export const AtualizarVendaEntrada = z.object({
  valorCentavos: VendaEntrada.shape.valorCentavos.optional(),
  formaPagamento: z.enum(FORMAS_PAGAMENTO).optional(),
  parcelas: z.number().int().min(1).max(60).optional(),
  dataVenda: DataDia.optional(),
  observacao: textoOpcional(1000, "Observação").optional(),
  status: z.enum(STATUS_VENDA).optional(),
  motivoCancelamento: textoOpcional(500, "Motivo"),
});
export const FiltroVendas = Paginacao.extend({
  mes: Mes.optional(),
  vendedorId: Id.optional(),
  contatoId: Id.optional(),
  status: z.enum(STATUS_VENDA).optional(),
});

// Comissões ---------------------------------------------------------------------------------------------

export const Faixa = z.object({ ateCentavos: Centavos.nullable(), percentual: z.number().min(0).max(100) });
export const RegraComissaoDto = z.object({
  id: Id,
  nome: z.string(),
  ofertaId: Id.nullable(),
  ofertaNome: z.string().nullable(),
  tipo: z.enum(["percentual", "faixa"]),
  percentual: z.number().nullable(),
  faixas: z.array(Faixa).nullable(),
  arquivadoEm: DataIso.nullable(),
});
export type RegraComissaoDto = z.infer<typeof RegraComissaoDto>;
export const RegraComissaoEntrada = z
  .object({
    nome: texto(120, "Nome"),
    ofertaId: IdOpcional,
    tipo: z.enum(["percentual", "faixa"]),
    percentual: z.number().min(0).max(100).nullish(),
    faixas: z.array(Faixa).min(1).max(20).nullish(),
  })
  .refine((r) => (r.tipo === "percentual" ? r.percentual != null : Boolean(r.faixas?.length)), {
    error: "Informe o percentual (regra fixa) ou as faixas (regra por faixa).",
  });
export const AtualizarRegraComissaoEntrada = z.object({ nome: texto(120, "Nome").optional(), arquivar: z.boolean().optional() });

export const LinhaComissaoDto = z.object({
  vendedorId: Id,
  vendedorNome: z.string().nullable(),
  regraId: Id.nullable(),
  regraNome: z.string(),
  vendas: z.number().int(),
  baseCentavos: z.number().int(),
  percentual: z.number(),
  valorCentavos: z.number().int(),
});
export type LinhaComissaoDto = z.infer<typeof LinhaComissaoDto>;
export const ComissoesDoMesDto = z.object({
  mes: Mes,
  fechamento: z
    .object({ id: Id, fechadoEm: DataIso, fechadoPorNome: z.string().nullable(), totalCentavos: z.number().int() })
    .nullable(),
  /** Vendas confirmadas sem regra que se aplique (não geram comissão). */
  semRegra: z.number().int(),
  linhas: z.array(LinhaComissaoDto),
  totalCentavos: z.number().int(),
});
export type ComissoesDoMesDto = z.infer<typeof ComissoesDoMesDto>;
export const FiltroComissoes = z.object({ mes: Mes });
export const FecharComissaoEntrada = z.object({ mes: Mes });
export const ReabrirComissaoEntrada = z.object({ motivo: texto(500, "Motivo") });

// Qualidade -------------------------------------------------------------------------------------------

export const CriterioDto = z.object({ id: Id, nome: z.string(), descricao: z.string().nullable(), peso: z.number().int(), ordem: z.number().int() });
export type CriterioDto = z.infer<typeof CriterioDto>;
export const CriterioEntrada = z.object({
  nome: texto(120, "Nome"),
  descricao: textoOpcional(500, "Descrição"),
  peso: z.number().int().min(1).max(10).default(1),
  ordem: z.number().int().min(0).max(10000).optional(),
});
export const AtualizarCriterioEntrada = z.object({
  nome: texto(120, "Nome").optional(),
  descricao: textoOpcional(500, "Descrição").optional(),
  peso: z.number().int().min(1).max(10).optional(),
  ordem: z.number().int().min(0).max(10000).optional(),
  arquivar: z.boolean().optional(),
});

export const AvaliacaoDto = z.object({
  id: Id,
  avaliadoId: Id,
  avaliadoNome: z.string().nullable(),
  avaliadorNome: z.string().nullable(),
  conversaId: Id.nullable(),
  ligacaoId: Id.nullable(),
  contatoNome: z.string().nullable(),
  notas: z.array(z.object({ criterioId: Id, nome: z.string(), peso: z.number().int(), nota: z.number() })),
  notaFinal: z.number(),
  feedback: z.string().nullable(),
  lidaEm: DataIso.nullable(),
  criadoEm: DataIso,
});
export type AvaliacaoDto = z.infer<typeof AvaliacaoDto>;
export const AvaliacaoEntrada = z
  .object({
    conversaId: IdOpcional,
    ligacaoId: IdOpcional,
    notas: z.array(z.object({ criterioId: Id, nota: z.number().min(0).max(10) })).min(1).max(50),
    feedback: textoOpcional(2000, "Feedback"),
  })
  .refine((a) => Boolean(a.conversaId) !== Boolean(a.ligacaoId), { error: "Avalie uma conversa ou uma ligação." });
export const FiltroAvaliacoes = Paginacao.extend({ avaliadoId: Id.optional() });

// Pesquisas -------------------------------------------------------------------------------------------

export const TIPOS_PERGUNTA = ["texto", "escolha", "nota"] as const;
export const NOMES_TIPOS_PERGUNTA: Record<(typeof TIPOS_PERGUNTA)[number], string> = {
  texto: "Resposta livre",
  escolha: "Escolha uma opção",
  nota: "Nota de 0 a 10",
};
export const Pergunta = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,12}$/),
    tipo: z.enum(TIPOS_PERGUNTA),
    texto: texto(300, "Pergunta"),
    opcoes: z.array(texto(120, "Opção")).max(20).optional(),
    obrigatoria: z.boolean().default(false),
  })
  .refine((p) => p.tipo !== "escolha" || (p.opcoes?.length ?? 0) >= 2, { error: "Pergunta de escolha precisa de pelo menos duas opções." });
export type Pergunta = z.infer<typeof Pergunta>;

export const PesquisaDto = z.object({
  id: Id,
  titulo: z.string(),
  descricao: z.string().nullable(),
  perguntas: z.array(Pergunta),
  token: z.string(),
  aberta: z.boolean(),
  respostas: z.number().int(),
  arquivadoEm: DataIso.nullable(),
  criadoEm: DataIso,
});
export type PesquisaDto = z.infer<typeof PesquisaDto>;
export const PesquisaEntrada = z.object({
  titulo: texto(160, "Título"),
  descricao: textoOpcional(1000, "Descrição"),
  perguntas: z.array(Pergunta).min(1).max(30),
});
export const AtualizarPesquisaEntrada = z.object({
  titulo: texto(160, "Título").optional(),
  descricao: textoOpcional(1000, "Descrição").optional(),
  aberta: z.boolean().optional(),
  arquivar: z.boolean().optional(),
});

/** O que o público vê (sem id interno nem empresa). */
export const PesquisaPublicaDto = z.object({
  titulo: z.string(),
  descricao: z.string().nullable(),
  empresa: z.string(),
  perguntas: z.array(Pergunta),
  aberta: z.boolean(),
});
export type PesquisaPublicaDto = z.infer<typeof PesquisaPublicaDto>;
export const RespostaPublicaEntrada = z.object({
  respostas: z.record(z.string().regex(/^[a-z0-9]{1,12}$/), z.union([z.string().trim().max(2000), z.number().min(0).max(10)])),
});
export const ParamToken = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

export const ResultadoPesquisaDto = z.object({
  total: z.number().int(),
  perguntas: z.array(
    z.object({
      id: z.string(),
      texto: z.string(),
      tipo: z.enum(TIPOS_PERGUNTA),
      respondidas: z.number().int(),
      opcoes: z.array(z.object({ opcao: z.string(), total: z.number().int() })).optional(),
      media: z.number().nullable().optional(),
      ultimas: z.array(z.string()).optional(),
    }),
  ),
});
export type ResultadoPesquisaDto = z.infer<typeof ResultadoPesquisaDto>;
