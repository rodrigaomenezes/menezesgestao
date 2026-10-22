// Tela /demonstracao (antes do login, só com a chave do servidor): empresas de exemplo por segmento, com dados
// fictícios, e entrada com um clique como dono, gestor, vendedor ou financeiro.
import { z } from "zod";
import { DataIso, Id } from "./dto.js";

export const PAPEIS_DEMONSTRACAO = [
  { id: "dono", nome: "Dono", ve: "tudo da empresa, plano e configurações" },
  { id: "gestor", nome: "Gestor", ve: "a equipe dele, metas, ranking e qualidade" },
  { id: "vendedor", nome: "Vendedor", ve: "só a própria carteira, conversas e fila" },
  { id: "financeiro", nome: "Financeiro", ve: "vendas, cobranças e comissões" },
] as const;
export type PapelDemonstracao = (typeof PAPEIS_DEMONSTRACAO)[number]["id"];
export const IDS_PAPEIS_DEMONSTRACAO = PAPEIS_DEMONSTRACAO.map((p) => p.id) as [PapelDemonstracao, ...PapelDemonstracao[]];

export const SEGMENTOS_DEMONSTRACAO = ["escola", "clinica", "consultoria", "imobiliaria", "varejo"] as const;

export const AcessoDemonstracaoEntrada = z.object({ chave: z.string().min(1, { error: "Digite a chave da demonstração." }).max(200) });

export const EmpresaDemonstracaoDto = z.object({
  id: Id,
  segmento: z.enum(SEGMENTOS_DEMONSTRACAO),
  empresaId: Id.nullable(),
  empresaNome: z.string().nullable(),
  status: z.enum(["gerando", "pronta", "falhou", "arquivada"]),
  erro: z.string().nullable(),
  /** Números gerados (contatos, oportunidades, conversas, ligações, vendas…). */
  resumo: z.record(z.string(), z.number()),
  criadoEm: DataIso,
});
export type EmpresaDemonstracaoDto = z.infer<typeof EmpresaDemonstracaoDto>;

export const PainelDemonstracaoDto = z.object({
  segmentos: z.array(z.object({ id: z.enum(SEGMENTOS_DEMONSTRACAO), nome: z.string(), descricao: z.string(), empresa: z.string() })),
  empresas: z.array(EmpresaDemonstracaoDto),
});
export type PainelDemonstracaoDto = z.infer<typeof PainelDemonstracaoDto>;

export const EntrarDemonstracaoEntrada = z.object({ papel: z.enum(IDS_PAPEIS_DEMONSTRACAO) });
export const ParamSegmentoDemonstracao = z.object({ segmento: z.enum(SEGMENTOS_DEMONSTRACAO) });
