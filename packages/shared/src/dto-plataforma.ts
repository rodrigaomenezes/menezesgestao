// Fase 9 — pronto para vender: limites por plano, situação da assinatura (aviso → só leitura), painel da plataforma,
// documentos legais com aceite versionado, suporte e página de status.
import { z } from "zod";
import { DataIso, EuDto, Id, Paginacao } from "./dto.js";
import { DataDia } from "./dto-operacao.js";

// Limites por plano -------------------------------------------------------------------------------------

export const RECURSOS_PLANO = ["usuarios", "canais", "armazenamento"] as const;
export type RecursoPlano = (typeof RECURSOS_PLANO)[number];
export const NOMES_RECURSOS_PLANO: Record<RecursoPlano, string> = { usuarios: "Pessoas ativas", canais: "Canais de WhatsApp", armazenamento: "Armazenamento" };

const MB = 1024 * 1024;
/** Limites de cada plano. "sob_medida" não tem limite (combinado à parte). */
export const LIMITES_PLANOS: Record<"essencial" | "comercial" | "completo", Record<RecursoPlano, number>> = {
  essencial: { usuarios: 3, canais: 1, armazenamento: 500 * MB },
  comercial: { usuarios: 10, canais: 3, armazenamento: 2_000 * MB },
  completo: { usuarios: 30, canais: 10, armazenamento: 10_000 * MB },
};
export function limitesDoPlano(plano: string): Record<RecursoPlano, number> | null {
  return plano in LIMITES_PLANOS ? LIMITES_PLANOS[plano as keyof typeof LIMITES_PLANOS] : null;
}

export const UsoPlanoDto = z.object({
  recurso: z.enum(RECURSOS_PLANO),
  usado: z.number(),
  limite: z.number().nullable(),
});
export type UsoPlanoDto = z.infer<typeof UsoPlanoDto>;

// Situação da assinatura -------------------------------------------------------------------------------

/** Até este número de dias de atraso a empresa só recebe aviso; depois, fica só para consulta. */
export const DIAS_TOLERANCIA_ATRASO = 7;

/** Gravações recusadas pelo servidor quando `somenteLeitura` (atraso além da tolerância, cancelada ou suspensa). */
export const SituacaoAssinaturaDto = EuDto.shape.assinatura.unwrap();
export type SituacaoAssinaturaDto = z.infer<typeof SituacaoAssinaturaDto>;

/** Regra única (servidor e tela) de quando a empresa fica só para consulta. */
export function ficaSomenteLeitura(status: string, diasAtraso: number): boolean {
  return status === "cancelada" || status === "suspensa" || (status === "atrasada" && diasAtraso > DIAS_TOLERANCIA_ATRASO);
}

// Painel da plataforma ---------------------------------------------------------------------------------

export const SAUDES_EMPRESA = ["boa", "atencao", "risco"] as const;
export const EmpresaPlataformaDto = z.object({
  id: Id,
  nome: z.string(),
  slug: z.string(),
  plano: z.string(),
  status: SituacaoAssinaturaDto.shape.status,
  testeAte: DataDia.nullable(),
  diasAtraso: z.number().int(),
  pessoas: z.number().int(),
  canais: z.number().int(),
  armazenamentoBytes: z.number(),
  ultimaAtividade: DataIso.nullable(),
  criadaEm: DataIso,
  /** boa = em dia e usando; atencao = parada há 7 dias, perto do limite ou atraso curto; risco = só leitura ou parada há 30 dias. */
  saude: z.enum(SAUDES_EMPRESA),
  motivoSaude: z.string().nullable(),
});
export type EmpresaPlataformaDto = z.infer<typeof EmpresaPlataformaDto>;
export const FiltroEmpresasPlataforma = Paginacao.extend({ busca: z.string().trim().max(100).optional() });
export const EstenderTesteEntrada = z.object({ dias: z.number().int().min(1, { error: "Dias: de 1 a 60." }).max(60, { error: "Dias: de 1 a 60." }) });
export const SuspenderEntrada = z.object({ motivo: z.string().trim().min(3, { error: "Diga o motivo da suspensão." }).max(300) });
export const PlanoPlataformaEntrada = z.object({ plano: z.enum(["essencial", "comercial", "completo"]) });

// Documentos legais -----------------------------------------------------------------------------------

export const DOCUMENTOS_LEGAIS = [
  { id: "termos", titulo: "Termos de Uso", rota: "/termos", aceite: "pessoa" },
  { id: "privacidade", titulo: "Política de Privacidade", rota: "/privacidade", aceite: "pessoa" },
  { id: "contrato", titulo: "Contrato de Tratamento de Dados", rota: "/contrato-de-dados", aceite: "empresa" },
] as const;
export type DocumentoLegalId = (typeof DOCUMENTOS_LEGAIS)[number]["id"];
export const IDS_DOCUMENTOS_LEGAIS = DOCUMENTOS_LEGAIS.map((d) => d.id) as [DocumentoLegalId, ...DocumentoLegalId[]];

export const DocumentoLegalDto = z.object({
  id: z.enum(IDS_DOCUMENTOS_LEGAIS),
  titulo: z.string(),
  versao: z.string(),
  vigencia: DataDia,
  /** Markdown simples (títulos, listas, tabelas, negrito); a tela monta sem innerHTML. */
  texto: z.string(),
});
export type DocumentoLegalDto = z.infer<typeof DocumentoLegalDto>;
export const AceitarTermosEntrada = z.object({ documentos: z.array(z.enum(IDS_DOCUMENTOS_LEGAIS)).min(1).max(3) });

// Suporte e status ------------------------------------------------------------------------------------

export const SuporteDto = z.object({
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),
  encarregado: z.string().nullable(),
});
export type SuporteDto = z.infer<typeof SuporteDto>;

export const StatusPublicoDto = z.object({
  situacao: z.enum(["operando", "instavel"]),
  componentes: z.array(z.object({ nome: z.string(), ok: z.boolean() })),
  verificadoEm: DataIso,
});
export type StatusPublicoDto = z.infer<typeof StatusPublicoDto>;

export const PedirRedefinicaoDuasEtapasEntrada = z.object({ motivo: z.string().trim().min(3, { error: "Diga o motivo." }).max(300) });
