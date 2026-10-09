// Contrato da fase 6: marca e domínio, vocabulário, pacotes por segmento, cadastro aberto e assistente,
// automações "quando/se/então" e cobrança. Tudo aqui é produto (o que existe), nunca regra de um cliente.
import { z } from "zod";
import { DataIso, Email, Id, SenhaNova } from "./dto.js";
import { DataDia } from "./dto-operacao.js";
import { COR_HEX, contraste, corDoTextoSobre } from "./marca.js";

const texto = (max: number, rotulo: string) =>
  z.string().trim().min(1, { error: `${rotulo}: preencha.` }).max(max, { error: `${rotulo}: no máximo ${max} caracteres.` });

// Vocabulário ---------------------------------------------------------------------------------------------

export const TERMOS = [
  { chave: "contato", padrao: "contato", rotulo: "Quem compra" },
  { chave: "oportunidade", padrao: "oportunidade", rotulo: "Negócio em andamento" },
  { chave: "oferta", padrao: "oferta", rotulo: "O que a empresa vende" },
  { chave: "entrega", padrao: "entrega", rotulo: "Como entrega (turma, agenda…)" },
  { chave: "prestador", padrao: "prestador", rotulo: "Quem executa o serviço" },
] as const;
export type ChaveTermo = (typeof TERMOS)[number]["chave"];

const Termo = z.string().trim().min(2, { error: "Use pelo menos 2 letras." }).max(40).regex(/^[\p{L} -]+$/u, { error: "Use só letras." });
/** Singular e, se o plural não for regular, o plural (chave_plural). */
export const VocabularioEntrada = z
  .record(z.string().regex(/^(contato|oportunidade|oferta|entrega|prestador)(_plural)?$/), Termo)
  .refine((v) => Object.keys(v).length <= 10);

// Pacotes por segmento ----------------------------------------------------------------------------------

interface EtapaPacote {
  nome: string;
  probabilidade: number;
  tipo: "aberta" | "ganha" | "perdida";
}
export interface Segmento {
  id: string;
  nome: string;
  descricao: string;
  vocabulario: Partial<Record<ChaveTermo | `${ChaveTermo}_plural`, string>>;
  funil: { nome: string; etapas: EtapaPacote[] };
  motivosPerda: string[];
}

const fim = (ganha: string, perdida: string): EtapaPacote[] => [
  { nome: ganha, probabilidade: 100, tipo: "ganha" },
  { nome: perdida, probabilidade: 0, tipo: "perdida" },
];

export const SEGMENTOS: Segmento[] = [
  {
    id: "escola",
    nome: "Escola e cursos",
    descricao: "Matrículas em cursos e turmas.",
    vocabulario: { contato: "aluno", oportunidade: "matrícula", oferta: "curso", entrega: "turma", prestador: "professor" },
    funil: {
      nome: "Matrículas",
      etapas: [
        { nome: "Interessado", probabilidade: 10, tipo: "aberta" },
        { nome: "Aula experimental", probabilidade: 40, tipo: "aberta" },
        { nome: "Proposta enviada", probabilidade: 70, tipo: "aberta" },
        ...fim("Matriculado", "Desistiu"),
      ],
    },
    motivosPerda: ["Preço", "Horário", "Escolheu outra escola", "Não respondeu"],
  },
  {
    id: "clinica",
    nome: "Clínica e saúde",
    descricao: "Agendamento de consultas e procedimentos.",
    vocabulario: { contato: "paciente", oportunidade: "atendimento", oferta: "procedimento", entrega: "consulta", prestador: "profissional" },
    funil: {
      nome: "Atendimentos",
      etapas: [
        { nome: "Primeiro contato", probabilidade: 10, tipo: "aberta" },
        { nome: "Avaliação agendada", probabilidade: 40, tipo: "aberta" },
        { nome: "Orçamento", probabilidade: 70, tipo: "aberta" },
        ...fim("Agendado", "Não fechou"),
      ],
    },
    motivosPerda: ["Preço", "Convênio", "Distância", "Não respondeu"],
  },
  {
    id: "consultoria",
    nome: "Consultoria e serviços",
    descricao: "Projetos e contratos de serviço.",
    vocabulario: { contato: "cliente", oportunidade: "negócio", oferta: "projeto", entrega: "sessão", entrega_plural: "sessões", prestador: "consultor" },
    funil: {
      nome: "Negócios",
      etapas: [
        { nome: "Contato inicial", probabilidade: 10, tipo: "aberta" },
        { nome: "Diagnóstico", probabilidade: 30, tipo: "aberta" },
        { nome: "Proposta", probabilidade: 60, tipo: "aberta" },
        { nome: "Negociação", probabilidade: 80, tipo: "aberta" },
        ...fim("Contrato assinado", "Perdido"),
      ],
    },
    motivosPerda: ["Preço", "Prazo", "Escolheu a concorrência", "Projeto adiado"],
  },
  {
    id: "imobiliaria",
    nome: "Imobiliária",
    descricao: "Visitas, propostas e fechamento de imóveis.",
    vocabulario: { contato: "cliente", oportunidade: "negócio", oferta: "imóvel", entrega: "visita", prestador: "corretor" },
    funil: {
      nome: "Negócios",
      etapas: [
        { nome: "Lead", probabilidade: 10, tipo: "aberta" },
        { nome: "Visita marcada", probabilidade: 30, tipo: "aberta" },
        { nome: "Proposta", probabilidade: 60, tipo: "aberta" },
        { nome: "Documentação", probabilidade: 85, tipo: "aberta" },
        ...fim("Fechado", "Perdido"),
      ],
    },
    motivosPerda: ["Financiamento negado", "Preço", "Localização", "Não respondeu"],
  },
  {
    id: "varejo",
    nome: "Varejo e distribuição",
    descricao: "Venda consultiva de produtos.",
    vocabulario: { contato: "comprador", oportunidade: "pedido", oferta: "produto", entrega: "pedido", prestador: "representante" },
    funil: {
      nome: "Pedidos",
      etapas: [
        { nome: "Contato", probabilidade: 10, tipo: "aberta" },
        { nome: "Orçamento", probabilidade: 40, tipo: "aberta" },
        { nome: "Negociação", probabilidade: 70, tipo: "aberta" },
        ...fim("Pedido fechado", "Perdido"),
      ],
    },
    motivosPerda: ["Preço", "Prazo de entrega", "Sem estoque", "Não respondeu"],
  },
  {
    id: "outro",
    nome: "Outro segmento",
    descricao: "Começa com os termos genéricos; dá para trocar depois.",
    vocabulario: {},
    funil: {
      nome: "Vendas",
      etapas: [
        { nome: "Novo contato", probabilidade: 10, tipo: "aberta" },
        { nome: "Em conversa", probabilidade: 30, tipo: "aberta" },
        { nome: "Proposta", probabilidade: 60, tipo: "aberta" },
        { nome: "Negociação", probabilidade: 80, tipo: "aberta" },
        ...fim("Ganho", "Perdido"),
      ],
    },
    motivosPerda: ["Preço", "Sem interesse", "Escolheu a concorrência", "Não respondeu"],
  },
];
export const IDS_SEGMENTOS = SEGMENTOS.map((s) => s.id) as [string, ...string[]];

// Marca e domínio ---------------------------------------------------------------------------------------

/** Contraste mínimo (WCAG AA para texto) entre a cor e o texto que vai sobre ela. */
export const CONTRASTE_MINIMO = 4.5;
export function contrasteDaCor(cor: string): number {
  return contraste(cor, corDoTextoSobre(cor));
}
const CorComContraste = z
  .string()
  .regex(COR_HEX, { error: "Use uma cor no formato #RRGGBB." })
  .refine((c) => contrasteDaCor(c) >= CONTRASTE_MINIMO, { error: "Essa cor deixa o texto difícil de ler. Escolha um tom mais escuro ou mais claro." });

export const MarcaEntrada = z.object({
  nomeProduto: z.string().trim().max(60).optional(),
  corPrimaria: CorComContraste,
  corDestaque: CorComContraste,
});
export const DOMINIO_REGEX = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const DominioEntrada = z.object({
  dominio: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMINIO_REGEX, { error: "Informe só o endereço, sem https:// (ex.: app.suaempresa.com.br)." })
    .nullable(),
});
export const MarcaPublicaDto = z.object({
  nomeProduto: z.string(),
  corPrimaria: z.string(),
  corDestaque: z.string(),
  /** Nome da empresa quando o endereço é dela (subdomínio ou domínio próprio). */
  empresa: z.string().nullable(),
  logoClaro: z.string().nullable(),
  logoEscuro: z.string().nullable(),
  cadastroAberto: z.boolean(),
});
export type MarcaPublicaDto = z.infer<typeof MarcaPublicaDto>;
export const ConfigMarcaDto = z.object({
  nomeProduto: z.string().nullable(),
  corPrimaria: z.string(),
  corDestaque: z.string(),
  logoClaro: z.string().nullable(),
  logoEscuro: z.string().nullable(),
  dominio: z.string().nullable(),
  /** Endereço pelo subdomínio, quando DOMINIO_BASE está configurado. */
  subdominio: z.string().nullable(),
  vocabulario: z.record(z.string(), z.string()),
});
export type ConfigMarcaDto = z.infer<typeof ConfigMarcaDto>;

// Cadastro aberto e assistente ------------------------------------------------------------------------------

export const CadastroEntrada = z.object({
  empresa: texto(120, "Nome da empresa"),
  nome: texto(120, "Seu nome"),
  email: Email,
  senha: SenhaNova,
  aceite: z.literal(true, { error: "É preciso aceitar os termos de uso e a política de privacidade." }),
});

export const PASSOS_ASSISTENTE = ["Empresa e marca", "Segmento", "Equipe", "Canais", "Contatos"] as const;
export const OnboardingDto = z.object({
  passo: z.number().int(),
  segmento: z.string().nullable(),
  concluido: z.boolean(),
  temExemplos: z.boolean(),
});
export type OnboardingDto = z.infer<typeof OnboardingDto>;
export const SegmentoEntrada = z.object({ segmento: z.enum(IDS_SEGMENTOS) });
export const AvancarEntrada = z.object({ passo: z.number().int().min(1).max(6) });

// Automações -------------------------------------------------------------------------------------------

export const GATILHOS = [
  { id: "contato.criado", nome: "Contato cadastrado", campos: [] },
  { id: "oportunidade.etapa_alterada", nome: "Oportunidade mudou de etapa", campos: ["etapaNovaId"] },
  { id: "oportunidade.ganha", nome: "Oportunidade ganha", campos: [] },
  { id: "oportunidade.perdida", nome: "Oportunidade perdida", campos: ["motivo"] },
  { id: "ligacao.encerrada", nome: "Ligação encerrada", campos: ["atendida"] },
  { id: "mensagem.recebida", nome: "Cliente mandou mensagem", campos: [] },
  { id: "venda.confirmada", nome: "Pagamento de venda confirmado", campos: [] },
] as const;
export type GatilhoId = (typeof GATILHOS)[number]["id"];
export const IDS_GATILHOS = GATILHOS.map((g) => g.id) as [GatilhoId, ...GatilhoId[]];

export const CAMPOS_CONDICAO: Record<string, { nome: string; operadores: readonly string[] }> = {
  etapaNovaId: { nome: "Etapa nova", operadores: ["igual", "diferente"] },
  motivo: { nome: "Motivo da perda", operadores: ["igual", "contem"] },
  atendida: { nome: "Foi atendida", operadores: ["igual"] },
  "contato.etiqueta": { nome: "Etiqueta do contato", operadores: ["tem"] },
  "contato.responsavel": { nome: "Responsável pelo contato", operadores: ["vazio", "preenchido"] },
};
export const NOMES_OPERADORES: Record<string, string> = {
  igual: "é",
  diferente: "não é",
  contem: "contém",
  tem: "tem",
  vazio: "está vazio",
  preenchido: "está preenchido",
};
export const CondicaoEntrada = z.object({
  campo: z.string().refine((c) => c in CAMPOS_CONDICAO, { error: "Condição desconhecida." }),
  operador: z.enum(["igual", "diferente", "contem", "tem", "vazio", "preenchido"]),
  valor: z.string().trim().max(200).optional(),
});

export const ACOES_AUTOMACAO = ["criar_tarefa", "mover_etapa", "avisar", "enviar_mensagem"] as const;
export const NOMES_ACOES_AUTOMACAO: Record<(typeof ACOES_AUTOMACAO)[number], string> = {
  criar_tarefa: "Criar tarefa para o responsável",
  mover_etapa: "Mover a oportunidade para a etapa",
  avisar: "Avisar o responsável e o gestor",
  enviar_mensagem: "Enviar mensagem pelo WhatsApp",
};
export const RegraAutomacaoEntrada = z
  .object({
    nome: texto(120, "Nome"),
    gatilho: z.enum(IDS_GATILHOS),
    condicoes: z.array(CondicaoEntrada).max(5).default([]),
    acao: z.enum(ACOES_AUTOMACAO),
    parametros: z.object({
      titulo: z.string().trim().max(200).optional(),
      horas: z.number().int().min(0).max(720).optional(),
      etapaId: Id.optional(),
      texto: z.string().trim().max(1000).optional(),
      canalId: Id.optional(),
    }),
  })
  .refine(
    (r) =>
      r.acao === "criar_tarefa" ? Boolean(r.parametros.titulo) : r.acao === "mover_etapa" ? Boolean(r.parametros.etapaId) : r.acao === "enviar_mensagem" ? Boolean(r.parametros.texto && r.parametros.canalId) : Boolean(r.parametros.texto),
    { error: "Preencha o que a ação precisa (título da tarefa, etapa, canal ou texto)." },
  );
export const AtualizarRegraAutomacaoEntrada = z.object({ ativa: z.boolean().optional(), arquivar: z.boolean().optional() });
export const RegraAutomacaoDto = z.object({
  id: Id,
  nome: z.string(),
  gatilho: z.string(),
  condicoes: z.array(z.object({ campo: z.string(), operador: z.string(), valor: z.string().optional() })),
  acao: z.enum(ACOES_AUTOMACAO),
  parametros: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  ativa: z.boolean(),
  execucoes: z.number().int(),
  ultimaExecucao: DataIso.nullable(),
});
export type RegraAutomacaoDto = z.infer<typeof RegraAutomacaoDto>;

// Cobrança ----------------------------------------------------------------------------------------------

/** Preço mensal de cada plano, em centavos (produto; "sob medida" é negociado). */
export const PRECOS_PLANOS: Record<"essencial" | "comercial" | "completo", number> = {
  essencial: 9_900,
  comercial: 19_900,
  completo: 39_900,
};
export const DIAS_TESTE = 14;
export const NOMES_STATUS_ASSINATURA = { teste: "Em teste", ativa: "Ativa", atrasada: "Pagamento atrasado", cancelada: "Cancelada" } as const;
export const NOMES_STATUS_FATURA = { pendente: "Em aberto", paga: "Paga", vencida: "Vencida", cancelada: "Cancelada" } as const;

export const FaturaDto = z.object({
  id: Id,
  plano: z.string(),
  valorCentavos: z.number().int(),
  vencimento: DataDia,
  status: z.enum(["pendente", "paga", "vencida", "cancelada"]),
  link: z.string().nullable(),
  pagaEm: DataIso.nullable(),
});
export type FaturaDto = z.infer<typeof FaturaDto>;
export const AssinaturaDto = z.object({
  plano: z.string(),
  status: z.enum(["teste", "ativa", "atrasada", "cancelada"]),
  valorCentavos: z.number().int(),
  provedor: z.string(),
  testeAte: DataDia.nullable(),
  proximaCobranca: DataDia.nullable(),
  modulos: z.array(z.string()),
  faturas: z.array(FaturaDto),
});
export type AssinaturaDto = z.infer<typeof AssinaturaDto>;
export const TrocarPlanoEntrada = z.object({ plano: z.enum(["essencial", "comercial", "completo"]) });
