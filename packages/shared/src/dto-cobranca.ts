// Cobrança dos clientes da empresa pelo provedor dela (fase 8.6): conta por empresa, cobrança nascida da venda e
// baixa automática pelo aviso do provedor.
import { z } from "zod";
import { DataIso, Id } from "./dto.js";
import { DataDia } from "./dto-operacao.js";

export const PROVEDORES_COBRANCA = [
  { codigo: "demonstracao", nome: "Demonstração (sem conta, simula o pagamento)" },
  { codigo: "asaas", nome: "Asaas" },
] as const;
export const CODIGOS_PROVEDOR_COBRANCA = ["demonstracao", "asaas"] as const;
export type ProvedorCobrancaId = (typeof CODIGOS_PROVEDOR_COBRANCA)[number];

export const FORMAS_COBRANCA = ["pix", "boleto", "link"] as const;
export const NOMES_FORMAS_COBRANCA: Record<(typeof FORMAS_COBRANCA)[number], string> = { pix: "Pix", boleto: "Boleto", link: "Link de pagamento" };
export const STATUS_COBRANCA = ["pendente", "paga", "vencida", "cancelada", "estornada"] as const;
export const NOMES_STATUS_COBRANCA: Record<(typeof STATUS_COBRANCA)[number], string> = {
  pendente: "Aguardando pagamento",
  paga: "Paga",
  vencida: "Vencida",
  cancelada: "Cancelada",
  estornada: "Estornada",
};

export const ContaCobrancaDto = z.object({
  provedor: z.enum(CODIGOS_PROVEDOR_COBRANCA),
  ambiente: z.enum(["teste", "producao"]),
  finalChave: z.string().nullable(),
  ativa: z.boolean(),
  /** Endereço e token que a pessoa cola no painel do provedor (webhook). */
  urlWebhook: z.string(),
  tokenWebhook: z.string(),
  atualizadoEm: DataIso,
});
export type ContaCobrancaDto = z.infer<typeof ContaCobrancaDto>;

export const ContaCobrancaEntrada = z
  .object({
    provedor: z.enum(CODIGOS_PROVEDOR_COBRANCA),
    ambiente: z.enum(["teste", "producao"]).default("teste"),
    /** Chave de API do provedor. Vazia = mantém a guardada. */
    chave: z.string().trim().max(500).optional(),
    ativa: z.boolean().default(true),
  });

export const CobrancaDto = z.object({
  id: Id,
  vendaId: Id,
  provedor: z.string(),
  forma: z.enum(FORMAS_COBRANCA),
  valorCentavos: z.number().int(),
  vencimento: DataDia,
  status: z.enum(STATUS_COBRANCA),
  link: z.string().nullable(),
  pixCopiaCola: z.string().nullable(),
  pagoEm: DataIso.nullable(),
  criadoEm: DataIso,
});
export type CobrancaDto = z.infer<typeof CobrancaDto>;

export const CobrancaEntrada = z.object({
  forma: z.enum(FORMAS_COBRANCA),
  vencimento: DataDia.optional(),
  /** CPF ou CNPJ de quem paga: o Asaas exige para emitir. Só números. */
  documento: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v === "" || v.length === 11 || v.length === 14, { error: "CPF ou CNPJ: 11 ou 14 números." })
    .optional(),
});
