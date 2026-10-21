// Motor BRE (fase 8.1): as listas fechadas da doutrina (ETR BRE-ETR-001 v0.2, seção 3), os limites que cada
// empresa ajusta e as regras puras (estado do cliente, transições, ação padrão do Break). Os códigos nunca mudam;
// os nomes exibidos podem passar pelo vocabulário da empresa.
import { z } from "zod";
import { DataIso, Id, IdOpcional, Paginacao } from "./dto.js";

const lista = <T extends string>(itens: readonly { codigo: T; nome: string }[]) => itens.map((i) => i.codigo) as [T, ...T[]];

/** 3.1 — os 7 estágios + Encerrado. O motor lê o marco da etapa, nunca o nome (DEC-012). */
export const MARCOS_BRE = [
  { codigo: "LEAD_IDENTIFIED", nome: "Lead identificado" },
  { codigo: "DIAGNOSIS", nome: "Diagnóstico" },
  { codigo: "INTEREST", nome: "Interesse" },
  { codigo: "PROPOSAL", nome: "Proposta" },
  { codigo: "NEGOTIATION", nome: "Negociação" },
  { codigo: "SALE", nome: "Venda" },
  { codigo: "REENTRY", nome: "Reentrada" },
  { codigo: "CLOSED", nome: "Encerrado" },
] as const;
export type MarcoBre = (typeof MARCOS_BRE)[number]["codigo"];
export const CODIGOS_MARCOS = lista(MARCOS_BRE);

/** 3.11 — transições permitidas (BRE-FR-007). */
export const TRANSICOES_BRE: Record<MarcoBre, readonly MarcoBre[]> = {
  LEAD_IDENTIFIED: ["DIAGNOSIS", "CLOSED"],
  DIAGNOSIS: ["INTEREST", "REENTRY", "CLOSED"],
  INTEREST: ["PROPOSAL", "DIAGNOSIS", "REENTRY"],
  PROPOSAL: ["NEGOTIATION", "SALE", "REENTRY"],
  NEGOTIATION: ["SALE", "PROPOSAL", "REENTRY"],
  SALE: ["REENTRY"],
  REENTRY: ["DIAGNOSIS", "INTEREST", "CLOSED"],
  CLOSED: ["REENTRY"],
};
export const transicaoPermitida = (de: MarcoBre, para: MarcoBre) => de === para || TRANSICOES_BRE[de].includes(para);
export const nomeMarco = (c: MarcoBre) => MARCOS_BRE.find((m) => m.codigo === c)!.nome;

/** 3.2 — estado do cliente (D-01). */
export const ESTADOS_CLIENTE = [
  { codigo: "RECENT", nome: "Recente" },
  { codigo: "ACTIVE", nome: "Ativo" },
  { codigo: "ABOUT_TO_SLEEP", nome: "Prestes a dormir" },
  { codigo: "INACTIVE", nome: "Inativo" },
] as const;
export type EstadoCliente = (typeof ESTADOS_CLIENTE)[number]["codigo"];
export const CODIGOS_ESTADOS = lista(ESTADOS_CLIENTE);

/** 3.3 — categorias de Break (D-03). */
export const CATEGORIAS_BREAK = [
  { codigo: "A_TIME", nome: "A — Tempo" },
  { codigo: "B_PRODUCT", nome: "B — Produto" },
  { codigo: "C_FINANCIAL", nome: "C — Financeiro" },
  { codigo: "D_TRUST", nome: "D — Confiança" },
  { codigo: "E_PROCESS", nome: "E — Processo" },
  { codigo: "F_COMPETITOR", nome: "F — Concorrência" },
  { codigo: "G_OTHER", nome: "G — Outros" },
  { codigo: "PRIOR_EXPERIENCE", nome: "Experiência anterior" },
  { codigo: "NO_INTEREST", nome: "Sem interesse" },
] as const;
export type CategoriaBreak = (typeof CATEGORIAS_BREAK)[number]["codigo"];
export const CODIGOS_CATEGORIAS = lista(CATEGORIAS_BREAK);

/** Motivos que toda empresa recebe na primeira vez (lista configurável depois). */
export const MOTIVOS_BREAK_PADRAO: Record<CategoriaBreak, readonly string[]> = {
  A_TIME: ["Ainda não experimentou", "Está viajando", "Vai decidir depois", "Aguardando salário"],
  B_PRODUCT: ["Não gostou", "Esperava outra coisa", "Desempenho abaixo do esperado"],
  C_FINANCIAL: ["Preço", "Prioridade", "Parcelamento", "Orçamento"],
  D_TRUST: ["Ainda inseguro", "Vai pesquisar", "Quer comparar", "Nunca comprou antes"],
  E_PROCESS: ["Não respondeu", "Visualizou", "Mudou de número", "Contato inválido"],
  F_COMPETITOR: ["Comprou em outro lugar", "Recebeu presente", "Melhor condição"],
  G_OTHER: ["Outro motivo"],
  PRIOR_EXPERIENCE: ["Problema em compra ou atendimento anterior"],
  NO_INTEREST: ["Mudou de perfil", "Não quer mais o produto"],
};

/** 3.4, 3.5, 3.6 — estado emocional (D-04), temperatura (D-07) e resultado do contato (D-08). */
export const ESTADOS_EMOCIONAIS = [
  { codigo: "CURIOUS", nome: "Curioso" },
  { codigo: "INTERESTED", nome: "Interessado" },
  { codigo: "WARY", nome: "Receoso" },
  { codigo: "EXCITED", nome: "Entusiasmado" },
  { codigo: "CONVINCED", nome: "Convencido" },
] as const;
export const TEMPERATURAS = [
  { codigo: "COLD", nome: "Fria" },
  { codigo: "WARM", nome: "Morna" },
  { codigo: "HOT", nome: "Quente" },
  { codigo: "READY_TO_BUY", nome: "Pronta para comprar" },
] as const;
export const RESULTADOS_CONTATO = [
  { codigo: "PURCHASED", nome: "Comprou" },
  { codigo: "ADVANCED", nome: "Avançou" },
  { codigo: "REPLIED_NO_ADVANCE", nome: "Respondeu sem avançar" },
  { codigo: "NO_REPLY", nome: "Não respondeu" },
  { codigo: "OPTED_OUT", nome: "Pediu para não ser contatado" },
] as const;
export type ResultadoContato = (typeof RESULTADOS_CONTATO)[number]["codigo"];

/** 3.7 — tipos de reentrada. */
export const TIPOS_REENTRADA = [
  { codigo: "TIME", nome: "Tempo" },
  { codigo: "EVENT", nome: "Evento" },
  { codigo: "PROFILE", nome: "Perfil" },
  { codigo: "BEHAVIOR", nome: "Comportamento" },
  { codigo: "RELATIONSHIP", nome: "Evolução do relacionamento" },
] as const;
export type TipoReentrada = (typeof TIPOS_REENTRADA)[number]["codigo"];

/** 3.9 — critérios de encerramento e checklist. */
export const CRITERIOS_ENCERRAMENTO = [
  { codigo: "PURCHASE_DONE", nome: "Compra realizada" },
  { codigo: "CUSTOMER_REQUESTED", nome: "Cliente pediu para encerrar" },
  { codigo: "CONTACT_BLOCKED", nome: "Bloqueou o contato" },
  { codigo: "NO_INTEREST_PERMANENT", nome: "Sem interesse permanente" },
  { codigo: "PROFILE_MISMATCH", nome: "Mudança de perfil incompatível" },
  { codigo: "MAX_ATTEMPTS", nome: "Tentativa máxima atingida" },
] as const;
export const CHECKLIST_ENCERRAMENTO = [
  { codigo: "motivoCompreendido", nome: "Motivo compreendido" },
  { codigo: "crmAtualizado", nome: "CRM atualizado" },
  { codigo: "temperaturaDefinida", nome: "Temperatura definida" },
  { codigo: "proximoGatilho", nome: "Próximo gatilho definido" },
  { codigo: "reentradaDefinida", nome: "Data ou evento de reentrada" },
  { codigo: "nadaSemRegistro", nome: "Nenhuma informação sem registro" },
] as const;

/** 3.10 — os três "sim" antes da oferta (D-11). */
export const SINS = [
  { codigo: "CONFIRMATION", nome: "Confirmação" },
  { codigo: "AGREEMENT", nome: "Concordância" },
  { codigo: "VISUALIZATION", nome: "Visualização" },
] as const;

/** Pilar Próximo Passo do SQ-BRE: as ações que fecham um registro. */
export const PROXIMAS_ACOES = [
  { codigo: "SEND_CATALOG", nome: "Enviar catálogo" },
  { codigo: "SEND_SAMPLE", nome: "Mandar amostra" },
  { codigo: "WAIT_STOCK", nome: "Aguardar estoque" },
  { codigo: "CALL_BACK", nome: "Retornar depois" },
  { codigo: "REMINDER", nome: "Criar lembrete" },
  { codigo: "SCHEDULE_TALK", nome: "Marcar nova conversa" },
  { codigo: "CLOSE_NO_INTEREST", nome: "Encerrar por falta de interesse" },
] as const;

// Limites por empresa (BRE-DEC: tudo que é [CONFIG]) -----------------------------------------------

export const ConfigBre = z.object({
  /** D-01: limites do estado do cliente, em dias desde a última compra entregue. */
  recenteAte: z.number().int().min(1).max(365).default(45),
  ativoAte: z.number().int().min(1).max(365).default(60),
  inativoApos: z.number().int().min(2).max(730).default(120),
  /** BR-015: horas depois da entrega antes do primeiro contato com cliente Recente. */
  horasAntesDoPrimeiroContato: z.number().int().min(0).max(240).default(48),
  /** BR-011: tentativas sem resposta por ciclo. */
  tentativasPorCiclo: z.number().int().min(1).max(10).default(3),
  /** BR-012: horas de espera antes de nova abordagem e dias de silêncio que encerram o ciclo. */
  horasEntreTentativas: z.number().int().min(1).max(240).default(48),
  diasSilencioEncerra: z.number().int().min(1).max(60).default(7),
  /** BR-013: intervalo mínimo entre ciclos para quem não respondeu. */
  diasEntreCiclos: z.number().int().min(1).max(180).default(15),
  /** BR-019: dias da agenda de pós-venda. */
  diasPosVenda: z.array(z.number().int().min(1).max(365)).max(10).default([2, 5, 10, 20, 30]),
  /** DEC-010: concordância mínima IA × supervisor para liberar automação (fase 8.2). */
  concordanciaParaAutomacao: z.number().int().min(50).max(100).default(85),
  amostraParaAutomacao: z.number().int().min(20).max(5000).default(200),
});
export type ConfigBre = z.infer<typeof ConfigBre>;
export const CONFIG_BRE_PADRAO: ConfigBre = ConfigBre.parse({});
export const ConfigBreEntrada = ConfigBre.partial().refine(
  (c) => c.recenteAte === undefined || c.ativoAte === undefined || c.inativoApos === undefined || (c.recenteAte < c.inativoApos && c.ativoAte < c.inativoApos),
  { error: "O limite de Inativo precisa ser maior que os de Recente e Ativo." },
);
export const ConfigBreDto = ConfigBre.extend({ versao: z.number().int() });

/** D-01: estado pela quantidade de compras e pelos dias desde a última entrega. null = nunca comprou. */
export function estadoCliente(compras: number, diasDesdeEntrega: number | null, c: ConfigBre = CONFIG_BRE_PADRAO): EstadoCliente | null {
  if (compras < 1 || diasDesdeEntrega === null) return null;
  if (diasDesdeEntrega > c.inativoApos) return "INACTIVE";
  if (compras === 1) return diasDesdeEntrega <= c.recenteAte ? "RECENT" : "ABOUT_TO_SLEEP";
  return diasDesdeEntrega <= c.ativoAte ? "ACTIVE" : "ABOUT_TO_SLEEP";
}

/** A ação que o motor aplica sozinho a cada categoria de Break (ETR 3.3). */
export type AcaoPadraoBreak = { reentrada: { tipo: TipoReentrada; dias: number | null; condicao: string | null } | null; texto: string };
export function acaoPadraoBreak(categoria: CategoriaBreak): AcaoPadraoBreak {
  switch (categoria) {
    case "A_TIME":
      return { reentrada: { tipo: "TIME", dias: 30, condicao: null }, texto: "Retorno em 30 dias" };
    case "C_FINANCIAL":
      return { reentrada: { tipo: "EVENT", dias: null, condicao: "Próxima campanha" }, texto: "Reentrada na próxima campanha" };
    case "D_TRUST":
      return { reentrada: { tipo: "TIME", dias: 7, condicao: null }, texto: "Retorno com prova de confiança em 7 dias" };
    case "NO_INTEREST":
      return { reentrada: { tipo: "TIME", dias: 90, condicao: null }, texto: "Reduzir a frequência: retorno em 90 dias" };
    case "B_PRODUCT":
      return { reentrada: null, texto: "Não oferecer itens semelhantes" };
    case "F_COMPETITOR":
      return { reentrada: null, texto: "Registrar marca, preço e motivo" };
    case "PRIOR_EXPERIENCE":
      return { reentrada: null, texto: "Acionar especialista" };
    case "E_PROCESS":
      return { reentrada: null, texto: "Seguir a regra de silêncio; contato inválido corrige o cadastro" };
    case "G_OTHER":
      return { reentrada: null, texto: "Seguir o comentário registrado" };
  }
}

// DTOs e entradas ---------------------------------------------------------------------------------

export const MotivoBreakDto = z.object({ id: Id, categoria: z.enum(CODIGOS_CATEGORIAS), nome: z.string(), arquivadoEm: DataIso.nullable() });
export type MotivoBreakDto = z.infer<typeof MotivoBreakDto>;
export const MotivoBreakEntrada = z.object({
  categoria: z.enum(CODIGOS_CATEGORIAS),
  nome: z.string().trim().min(1, { error: "Nome do motivo: preencha." }).max(80, { error: "Nome do motivo: no máximo 80 caracteres." }),
});
export const AtualizarMotivoBreakEntrada = z.object({ nome: MotivoBreakEntrada.shape.nome.optional(), arquivado: z.boolean().optional() });

const Comentario = z.string().trim().max(1000, { error: "Comentário: no máximo 1.000 caracteres." });

/** Regra de Ouro (BRE-P-012): categoria, motivo, comentário e próxima ação. */
export const BreakEntrada = z.object({
  categoria: z.enum(CODIGOS_CATEGORIAS, { error: "Escolha a categoria do Break." }),
  motivoId: Id,
  comentario: Comentario.min(3, { error: "Comentário do Break: escreva o que o cliente disse." }),
});

export const RegistroBreEntrada = z
  .object({
    contatoId: Id,
    conversaId: IdOpcional,
    oportunidadeId: IdOpcional,
    resultado: z.enum(lista(RESULTADOS_CONTATO), { error: "Escolha o resultado do contato." }),
    temperatura: z.enum(lista(TEMPERATURAS), { error: "Escolha a temperatura da conversa." }),
    estadoEmocional: z.enum(lista(ESTADOS_EMOCIONAIS)).nullish(),
    sins: z.array(z.enum(lista(SINS))).max(3).default([]),
    interesseOfertaId: IdOpcional,
    produtoOfertaId: IdOpcional,
    proximaAcao: z.enum(lista(PROXIMAS_ACOES), { error: "Escolha a próxima ação." }),
    retornoEm: z.iso.date({ error: "Data do retorno inválida." }).nullish(),
    break: BreakEntrada.nullish(),
    /** Quanto tempo a pessoa levou para registrar (meta: 30 s). */
    segundos: z.number().int().min(0).max(36000).nullish(),
  })
  .refine((r) => r.proximaAcao === "CLOSE_NO_INTEREST" || r.resultado === "OPTED_OUT" || Boolean(r.retornoEm), {
    error: "Diga a data do retorno.",
    path: ["retornoEm"],
  });
export type RegistroBreEntrada = z.infer<typeof RegistroBreEntrada>;

export const RegistroBreDto = z.object({
  id: Id,
  cicloEncerrado: z.boolean(),
  reentradaId: Id.nullable(),
  tarefas: z.number().int(),
});

export const BreakDto = z.object({
  id: Id,
  contatoId: Id,
  categoria: z.enum(CODIGOS_CATEGORIAS),
  motivo: z.string(),
  comentario: z.string(),
  marco: z.enum(CODIGOS_MARCOS).nullable(),
  acaoPadrao: z.string(),
  criadoEm: DataIso,
});
export const FiltroBreaks = Paginacao.extend({ contatoId: Id.optional() });

export const ReentradaDto = z.object({
  id: Id,
  contatoId: Id,
  contatoNome: z.string(),
  tipo: z.enum(lista(TIPOS_REENTRADA)),
  previstaPara: z.iso.date().nullable(),
  condicao: z.string().nullable(),
  motivo: z.string(),
  status: z.enum(["pendente", "feita", "cancelada"]),
  criadoEm: DataIso,
});
export type ReentradaDto = z.infer<typeof ReentradaDto>;
const ReentradaBase = z.object({
  tipo: z.enum(lista(TIPOS_REENTRADA)),
  previstaPara: z.iso.date({ error: "Data inválida." }).nullish(),
  condicao: z.string().trim().max(200).nullish(),
  motivo: z.string().trim().min(1, { error: "Motivo da reentrada: preencha." }).max(300),
});
const temQuando = (r: { previstaPara?: string | null; condicao?: string | null }) => Boolean(r.previstaPara) || Boolean(r.condicao);
export const ReentradaEntrada = ReentradaBase.extend({ contatoId: Id })
  .refine(temQuando, { error: "Diga a data ou a condição da reentrada.", path: ["previstaPara"] });
export const FiltroReentradas = Paginacao.extend({ status: z.enum(["pendente", "feita", "cancelada"]).default("pendente") });
export const AtualizarReentradaEntrada = z.object({ status: z.enum(["feita", "cancelada"]) });

export const EncerramentoBreEntrada = z.object({
  criterio: z.enum(lista(CRITERIOS_ENCERRAMENTO), { error: "Escolha o critério de encerramento." }),
  temperatura: z.enum(lista(TEMPERATURAS), { error: "Escolha a temperatura." }),
  checklist: z.object(Object.fromEntries(CHECKLIST_ENCERRAMENTO.map((c) => [c.codigo, z.boolean()])) as Record<(typeof CHECKLIST_ENCERRAMENTO)[number]["codigo"], z.ZodBoolean>),
  reentrada: ReentradaBase.refine(temQuando, { error: "Diga a data ou a condição da reentrada.", path: ["previstaPara"] }).nullish(),
});

export const ItemFilaBreDto = z.object({
  contatoId: Id,
  nome: z.string(),
  telefone: z.string().nullable(),
  estado: z.enum(CODIGOS_ESTADOS).nullable(),
  motivo: z.string(),
  reentradaId: Id.nullable(),
  criadoEm: DataIso,
  id: Id,
});
export type ItemFilaBreDto = z.infer<typeof ItemFilaBreDto>;
