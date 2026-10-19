// Contrato da fase 7.6: o Início que cada pessoa monta com blocos. O catálogo diz o que cada bloco exige (módulo
// × ação); o servidor só aceita e só devolve blocos que o perfil pode ver. Nomes com marcadores do vocabulário.
import { z } from "zod";
import { moduloAtivo, temPermissao, type Acao, type Modulo, type Permissoes } from "./catalogo.js";

export interface BlocoInicio {
  id: string;
  nome: string;
  descricao: string;
  /** Todas as permissões exigidas (vazio = qualquer pessoa da empresa). */
  exige: readonly (readonly [Modulo, Acao])[];
}

export const BLOCOS_INICIO = [
  { id: "atalhos", nome: "Atalhos", descricao: "Ações rápidas do seu dia", exige: [] },
  { id: "conversas", nome: "Conversas esperando", descricao: "Quem escreveu e ainda não teve resposta", exige: [["rotina", "ver"], ["conversas", "ver"]] },
  { id: "metas", nome: "Minhas metas", descricao: "Seu progresso nas metas do dia, da semana e do mês", exige: [["rotina", "ver"], ["desempenho", "ver"]] },
  { id: "agenda", nome: "Agenda de hoje", descricao: "Compromissos e visitas do dia", exige: [["rotina", "ver"], ["agenda", "ver"]] },
  { id: "tarefas", nome: "Tarefas", descricao: "Vencidas e para hoje", exige: [["rotina", "ver"], ["crm", "ver"]] },
  { id: "retornos", nome: "Retornos da fila", descricao: "Ligações combinadas para hoje", exige: [["rotina", "ver"], ["fila", "ver"]] },
  { id: "checklist", nome: "Check-list de hoje", descricao: "O passo a passo do seu perfil", exige: [["rotina", "ver"]] },
  { id: "ponto", nome: "Ponto", descricao: "Registrar entrada e saída", exige: [["agenda", "criar"]] },
  { id: "funil", nome: "Seu funil", descricao: "{Quantas oportunidades} em cada etapa", exige: [["crm", "ver"]] },
  { id: "ranking", nome: "Ranking da equipe", descricao: "Quem está liderando o mês", exige: [["desempenho", "ver"]] },
  { id: "comissao", nome: "Comissão do mês", descricao: "Prévia do que já foi confirmado", exige: [["vendas", "ver"]] },
  { id: "avisos", nome: "Avisos", descricao: "Notificações que você ainda não leu", exige: [] },
] as const satisfies readonly BlocoInicio[];

export type BlocoInicioId = (typeof BLOCOS_INICIO)[number]["id"];
export const IDS_BLOCOS_INICIO = BLOCOS_INICIO.map((b) => b.id) as [BlocoInicioId, ...BlocoInicioId[]];

/** Ordem pensada para quem atende (o padrão), para quem gere e para quem confere números. */
const ORDEM_ATENDIMENTO: BlocoInicioId[] = ["atalhos", "conversas", "metas", "agenda", "retornos", "tarefas", "checklist", "ponto", "avisos"];
const ORDEM_GESTAO: BlocoInicioId[] = ["atalhos", "ranking", "metas", "funil", "conversas", "agenda", "tarefas", "checklist", "ponto", "avisos"];
const ORDEM_FINANCEIRO: BlocoInicioId[] = ["atalhos", "comissao", "ranking", "avisos"];

export function blocoPermitido(id: string, permissoes: Permissoes, modulos: readonly string[]): boolean {
  const b = BLOCOS_INICIO.find((x) => x.id === id);
  if (!b) return false;
  return b.exige.every(([m, a]) => moduloAtivo(m, modulos) && Boolean(temPermissao(permissoes, m, a)));
}

/**
 * Início padrão de um perfil, montado pelas permissões: quem vê usuários ou define metas além das próprias vê a
 * ordem de gestão; quem só vê vendas e comissões, a do financeiro; os demais, a de atendimento.
 */
export function inicioPadrao(permissoes: Permissoes, modulos: readonly string[]): BlocoInicioId[] {
  const metasDeOutros = temPermissao(permissoes, "desempenho", "criar");
  const gestao = Boolean(temPermissao(permissoes, "usuarios", "ver")) || (metasDeOutros !== null && metasDeOutros !== "proprio");
  const financeiro = !gestao && Boolean(temPermissao(permissoes, "vendas", "ver")) && !temPermissao(permissoes, "crm", "criar");
  const ordem = gestao ? ORDEM_GESTAO : financeiro ? ORDEM_FINANCEIRO : ORDEM_ATENDIMENTO;
  return ordem.filter((id) => blocoPermitido(id, permissoes, modulos));
}

export const InicioDto = z.object({
  /** Blocos na ordem em que aparecem (só os que a pessoa pode ver). */
  blocos: z.array(z.enum(IDS_BLOCOS_INICIO)),
  /** true quando é o padrão do perfil (a pessoa ainda não personalizou ou voltou ao padrão). */
  padrao: z.boolean(),
});
export type InicioDto = z.infer<typeof InicioDto>;

export const InicioEntrada = z.object({
  blocos: z
    .array(z.enum(IDS_BLOCOS_INICIO, { error: "Bloco desconhecido." }))
    .max(BLOCOS_INICIO.length)
    .refine((b) => new Set(b).size === b.length, { error: "O mesmo bloco aparece duas vezes." }),
});
