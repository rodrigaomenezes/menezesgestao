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

/** 3.8 — situações que tiram a conversa da automação e chamam uma pessoa (BR-017). */
export const ESCALONAMENTOS = [
  { codigo: "READY_TO_BUY", nome: "Pronto para comprar" },
  { codigo: "TECHNICAL_HELP", nome: "Precisa de ajuda técnica" },
  { codigo: "VIP", nome: "VIP" },
  { codigo: "COMPLAINT", nome: "Reclamação" },
] as const;
export type SituacaoEscalonamento = (typeof ESCALONAMENTOS)[number]["codigo"];
export const CODIGOS_ESCALONAMENTOS = lista(ESCALONAMENTOS);

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
  /** DEC-009: troca dados pessoais por marcadores antes de enviar a conversa à IA (desligado nos primeiros testes). */
  mascararDadosIa: z.boolean().default(false),
  /** Robustez: análises de IA (sugestão e prévia SQ-BRE) por hora na empresa. */
  limiteIaPorHora: z.number().int().min(1).max(10_000).default(300),
  /** Pilar Receita do BPI: meta mensal por pessoa, em centavos. null = sem meta (o pilar fica fora do BPI). */
  metaReceitaCentavos: z.number().int().min(0).max(100_000_000_00).nullable().default(null),
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
    /** BR-017: a conversa precisa de uma pessoa (abre escalonamento e avisa quem responde). */
    escalonamento: z.enum(CODIGOS_ESCALONAMENTOS).nullish(),
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

// Análise da conversa pela IA (fase 8.2, ETR seção 8). A IA só sugere; o motor filtra pelas regras e a pessoa
// confirma no registro. Os campos usam as mesmas listas fechadas: código fora da lista invalida a saída.

export const SaidaIaBre = z.object({
  resumo: z.string().max(1000),
  resultado: z.enum(lista(RESULTADOS_CONTATO)),
  temperatura: z.enum(lista(TEMPERATURAS)),
  estadoEmocional: z.enum(lista(ESTADOS_EMOCIONAIS)).nullable(),
  sins: z.array(z.enum(lista(SINS))),
  break: z.object({ categoria: z.enum(CODIGOS_CATEGORIAS), comentario: z.string().max(1000) }).nullable(),
  proximaAcao: z.enum(lista(PROXIMAS_ACOES)),
  retornoEmDias: z.number().int().min(0).max(365).nullable(),
  sugereOferta: z.boolean(),
  sugereDesconto: z.boolean(),
  escalonamento: z.enum(CODIGOS_ESCALONAMENTOS).nullable(),
  /** Nota prévia do SQ-BRE por pilar (0 a 20); o supervisor confirma (D-05). */
  sqBre: z.object({ H: z.number().int().min(0).max(20), D: z.number().int().min(0).max(20), I: z.number().int().min(0).max(20), V: z.number().int().min(0).max(20), P: z.number().int().min(0).max(20) }),
  incertezas: z.array(z.string().max(300)).max(10),
});
export type SaidaIaBre = z.infer<typeof SaidaIaBre>;

/** A análise roda pela fila de jobs: nasce "processando" e termina "pronta" (com a sugestão) ou "falhou" (com o motivo). */
export const STATUS_IA = ["processando", "pronta", "falhou"] as const;
export const AnaliseBreDto = z.object({
  id: Id,
  status: z.enum(STATUS_IA),
  provedor: z.string().nullable(),
  erro: z.string().nullable(),
  sugestao: SaidaIaBre.extend({
    /** Sugestões que o motor descartou e por quê (BRE-BR-007, BR-014, BR-016). */
    bloqueios: z.array(z.string()),
  }).nullable(),
});
export type AnaliseBreDto = z.infer<typeof AnaliseBreDto>;

// SQ-BRE (ETR 6.1, D-05, D-06): 5 pilares de 20 pontos. A IA dá a prévia; só a nota confirmada conta no BPI.

export const PILARES_SQ = [
  { codigo: "H", nome: "Humanização", itens: ["Personalizou a conversa", "Usou o nome", "Citou algo da compra", "Mostrou interesse genuíno", "Tom natural"] },
  { codigo: "D", nome: "Diagnóstico", itens: ["Contexto", "Uso", "Preferência", "Objeções", "Momento de compra"] },
  { codigo: "I", nome: "Inteligência", itens: ["Registrou ou atualizou os dados que a conversa trouxe"] },
  { codigo: "V", nome: "Valor", itens: ["Benefício", "Diferença", "Conhecimento", "Recomendação personalizada", "Confiança", "Não vendeu só desconto"] },
  { codigo: "P", nome: "Próximo passo", itens: ["Ação da lista com data (20), sem data (10), nenhuma (0)"] },
] as const;
export type PilarSq = (typeof PILARES_SQ)[number]["codigo"];
export const NotasSq = z.object({
  H: z.number().int().min(0, { error: "Cada pilar vai de 0 a 20." }).max(20, { error: "Cada pilar vai de 0 a 20." }),
  D: z.number().int().min(0, { error: "Cada pilar vai de 0 a 20." }).max(20, { error: "Cada pilar vai de 0 a 20." }),
  I: z.number().int().min(0, { error: "Cada pilar vai de 0 a 20." }).max(20, { error: "Cada pilar vai de 0 a 20." }),
  V: z.number().int().min(0, { error: "Cada pilar vai de 0 a 20." }).max(20, { error: "Cada pilar vai de 0 a 20." }),
  P: z.number().int().min(0, { error: "Cada pilar vai de 0 a 20." }).max(20, { error: "Cada pilar vai de 0 a 20." }),
});
export type NotasSq = z.infer<typeof NotasSq>;
export const somaSq = (n: NotasSq) => n.H + n.D + n.I + n.V + n.P;

/** Faixas do SQ-BRE (FONTE). */
export function faixaSq(nota: number): string {
  if (nota >= 95) return "Excelência";
  if (nota >= 85) return "Muito bom";
  if (nota >= 70) return "Bom";
  if (nota >= 50) return "Regular";
  return "Requer reciclagem";
}

export const SqBreDto = z.object({
  id: Id,
  conversaId: Id,
  avaliadoId: Id,
  avaliadoNome: z.string(),
  contatoNome: z.string().nullable(),
  provedor: z.string(),
  previa: NotasSq.nullable(),
  notaPrevia: z.number().int().nullable(),
  erro: z.string().nullable(),
  confirmada: NotasSq.nullable(),
  nota: z.number().int().nullable(),
  faixa: z.string().nullable(),
  feedback: z.string().nullable(),
  /** processando/falhou = a IA ainda não deu (ou não conseguiu dar) a prévia; o supervisor pode confirmar se falhou. */
  status: z.enum(["processando", "falhou", "previa", "confirmada"]),
  criadoEm: DataIso,
});
export type SqBreDto = z.infer<typeof SqBreDto>;
export const SqBreEntrada = z.object({ conversaId: Id });
export const ConfirmarSqBreEntrada = z.object({ notas: NotasSq, feedback: z.string().trim().max(2000).nullish() });
export const FiltroSqBre = Paginacao.extend({ status: z.enum(["previa", "confirmada"]).optional() });

// BPI (ETR 6.2, figura 14.7): pilares de 0 a 100 com os pesos do livro. Pilar sem dados fica fora e os pesos
// dos demais são redistribuídos — nunca vira zero por falta de informação.

export const PILARES_BPI = [
  { codigo: "receita", nome: "Receita", peso: 30 },
  { codigo: "pipeline", nome: "Pipeline", peso: 20 },
  { codigo: "inteligencia", nome: "Inteligência (CRM)", peso: 20 },
  { codigo: "qualidade", nome: "Qualidade", peso: 20 },
  { codigo: "relacionamento", nome: "Relacionamento", peso: 10 },
] as const;
export type PilarBpi = (typeof PILARES_BPI)[number]["codigo"];
export type NotasBpi = Record<PilarBpi, number | null>;

/** Valor contra a meta, em 0 a 100 (acima da meta não passa de 100). */
export const contraMeta = (valor: number, meta: number) => (meta > 0 ? Math.min(100, (valor / meta) * 100) : 0);

export function calcularBpi(n: NotasBpi): number | null {
  const presentes = PILARES_BPI.filter((p) => n[p.codigo] !== null);
  const pesos = presentes.reduce((t, p) => t + p.peso, 0);
  if (!pesos) return null;
  return Math.round((presentes.reduce((t, p) => t + p.peso * n[p.codigo]!, 0) / pesos) * 10) / 10;
}

/** Faixas do BPI (FONTE, figura 14.7). */
export function faixaBpi(bpi: number): string {
  if (bpi >= 95) return "Elite";
  if (bpi >= 90) return "Excelente";
  if (bpi >= 80) return "Muito bom";
  if (bpi >= 70) return "Adequado";
  return "Plano de desenvolvimento";
}

const NotaPilar = z.number().nullable();
export const BpiDto = z.object({
  usuarioId: Id,
  nome: z.string(),
  posicao: z.number().int(),
  pilares: z.object({ receita: NotaPilar, pipeline: NotaPilar, inteligencia: NotaPilar, qualidade: NotaPilar, relacionamento: NotaPilar }),
  bpi: z.number().nullable(),
  faixa: z.string().nullable(),
  /** Pilares abaixo de 70 nas duas últimas semanas (BR-022). */
  coaching: z.array(z.string()),
});
export type BpiDto = z.infer<typeof BpiDto>;
export const FiltroBpi = Paginacao.extend({ atualizar: z.enum(["sim"]).optional(), mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Mês no formato AAAA-MM." }).optional() });
export const BpiRespostaDto = z.object({
  mes: z.string(),
  /** Quando o BPI guardado foi calculado (recalcula de hora em hora, ou na consulta se ficou velho). */
  calculadoEm: DataIso,
  itens: z.array(BpiDto),
  proximoCursor: z.string().nullable(),
});
export type BpiRespostaDto = z.infer<typeof BpiRespostaDto>;

// Escalonamento (BR-017, FR-024).
export const EscalonamentoDto = z.object({
  id: Id,
  contatoId: Id,
  contatoNome: z.string(),
  conversaId: Id.nullable(),
  situacao: z.enum(CODIGOS_ESCALONAMENTOS),
  origem: z.enum(["ia", "manual"]),
  observacao: z.string().nullable(),
  status: z.enum(["aberto", "resolvido"]),
  criadoEm: DataIso,
});
export type EscalonamentoDto = z.infer<typeof EscalonamentoDto>;
export const FiltroEscalonamentos = Paginacao.extend({ status: z.enum(["aberto", "resolvido"]).default("aberto") });

// Fase 8.3 ------------------------------------------------------------------------------------------

/** FR-006: o que já se sabe e o que falta saber do cliente (campos de inteligência da empresa). */
export const InteligenciaContatoDto = z.object({
  campos: z.number().int(),
  preenchidos: z.number().int(),
  faltando: z.array(z.string()),
});
export type InteligenciaContatoDto = z.infer<typeof InteligenciaContatoDto>;

/** DEC-010: concordância da IA com a pessoa, campo a campo, na amostra mais recente. */
export const ConcordanciaDto = z.object({
  amostraMinima: z.number().int(),
  percentualMinimo: z.number().int(),
  campos: z.array(z.object({ campo: z.string(), nome: z.string(), pares: z.number().int(), iguais: z.number().int(), percentual: z.number().nullable() })),
  analises: z.number().int(),
  analisesComBloqueio: z.number().int(),
  liberado: z.boolean(),
  motivo: z.string(),
});
export type ConcordanciaDto = z.infer<typeof ConcordanciaDto>;

/**
 * LGPD (DEC-009): troca e-mail, CPF, CNPJ, CEP e telefone por marcadores antes de a conversa sair para a IA.
 * A ordem importa: documentos com pontuação antes do telefone, que pega sequências longas de dígitos.
 */
export function mascararDadosPessoais(texto: string, nomes: readonly string[] = []): string {
  // Partes do nome do cliente (3 letras ou mais), sem distinguir maiúsculas; letras acentuadas contam como letra.
  const partes = [...new Set(nomes.flatMap((n) => n.split(/\s+/)).filter((p) => p.length >= 3))].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const semNome = partes.length ? texto.replace(new RegExp(`(?<!\\p{L})(${partes.join("|")})(?!\\p{L})`, "giu"), "[nome]") : texto;
  return semNome
    .replace(/\b(rua|r\.|avenida|av\.?|travessa|tv\.|alameda|al\.|rodovia|estrada|praça|largo)\s+[^,\n]{2,60}(,\s*(n[ºo°.]?\s*)?\d+[a-z]?)?/giu, "[endereço]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[CNPJ]")
    .replace(/\b\d{5}-\d{3}\b/g, "[CEP]")
    .replace(/(\+?\(?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[telefone]" : m));
}

// Automação (fase 8.4, Fase 4 da ETR): só o automatizável, por modelo de texto, com a concordância liberada.

export const TIPOS_AUTOMACAO_BRE = [
  { codigo: "POS_VENDA", nome: "Pós-venda", ajuda: "Mensagem N dias depois da venda confirmada (ex.: D+2, chegou bem?)" },
  { codigo: "ANIVERSARIO", nome: "Aniversário", ajuda: "No dia e mês do campo de data escolhido" },
  { codigo: "REENTRADA", nome: "Reentrada do dia", ajuda: "Quando vence uma reentrada combinada por data" },
  {
    codigo: "LANCAMENTO",
    nome: "Lançamento compatível",
    ajuda: "Na data de lançamento de um item do catálogo, avisa quem já comprou da mesma categoria (até 7 dias depois, se o envio atrasar)",
  },
  { codigo: "ESTOQUE", nome: "Alerta de estoque", ajuda: "Quando o estoque de um item fica no limite ou abaixo, avisa quem já comprou da mesma categoria" },
] as const;
export type TipoAutomacaoBre = (typeof TIPOS_AUTOMACAO_BRE)[number]["codigo"];
export const CODIGOS_AUTOMACAO_BRE = lista(TIPOS_AUTOMACAO_BRE);

export const AutomacaoBreDto = z.object({
  id: Id,
  tipo: z.enum(CODIGOS_AUTOMACAO_BRE),
  nome: z.string(),
  canalId: Id,
  texto: z.string(),
  dias: z.number().int().nullable(),
  campoChave: z.string().nullable(),
  limiteEstoque: z.number().int().nullable(),
  modelo: z.object({ nome: z.string(), idioma: z.string(), parametros: z.array(z.string()) }).nullable(),
  ativa: z.boolean(),
  arquivadoEm: DataIso.nullable(),
});
export type AutomacaoBreDto = z.infer<typeof AutomacaoBreDto>;

/** Variáveis que uma mensagem automática pode usar (no texto como {nome}; no modelo da Meta, na ordem de {{1}}, {{2}}…). */
export const VARIAVEIS_AUTOMACAO = ["nome", "vendedor", "produto", "empresa"] as const;
/**
 * Mensagem modelo aprovada na Meta (API oficial do WhatsApp): o único jeito de escrever para quem não falou com a
 * empresa nas últimas 24 horas. O texto da automação vira a prévia que aparece na conversa.
 */
export const ModeloMensagem = z.object({
  nome: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, { error: "Nome do modelo: use o nome exato aprovado na Meta (letras minúsculas, números e _)." }),
  idioma: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, { error: "Idioma do modelo: use o código da Meta, como pt_BR." })
    .default("pt_BR"),
  parametros: z.array(z.enum(VARIAVEIS_AUTOMACAO, { error: "Variável do modelo: use nome, vendedor, produto ou empresa." })).max(10).default([]),
});
export type ModeloMensagem = z.infer<typeof ModeloMensagem>;

const TextoModelo = z.string().trim().min(1, { error: "Texto da mensagem: preencha." }).max(1000, { error: "Texto da mensagem: no máximo 1.000 caracteres." });
export const AutomacaoBreEntrada = z
  .object({
    tipo: z.enum(CODIGOS_AUTOMACAO_BRE),
    nome: z.string().trim().min(1, { error: "Nome: preencha." }).max(80),
    canalId: Id,
    texto: TextoModelo,
    dias: z.number().int().min(1, { error: "Dias: de 1 a 365." }).max(365, { error: "Dias: de 1 a 365." }).nullish(),
    campoChave: z.string().trim().max(40).nullish(),
    limiteEstoque: z.number().int().min(1, { error: "Limite de estoque: de 1 a 100.000." }).max(100_000, { error: "Limite de estoque: de 1 a 100.000." }).nullish(),
    modelo: ModeloMensagem.nullish(),
  })
  .refine((a) => a.tipo !== "POS_VENDA" || Boolean(a.dias), { error: "Diga quantos dias depois da venda.", path: ["dias"] })
  .refine((a) => a.tipo !== "ANIVERSARIO" || Boolean(a.campoChave), { error: "Escolha o campo de data do aniversário.", path: ["campoChave"] })
  .refine((a) => a.tipo !== "ESTOQUE" || Boolean(a.limiteEstoque), { error: "Diga a partir de quantas unidades avisar.", path: ["limiteEstoque"] });
export const AtualizarAutomacaoBreEntrada = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  texto: TextoModelo.optional(),
  modelo: ModeloMensagem.nullish(),
  ativa: z.boolean().optional(),
  arquivado: z.boolean().optional(),
});

export const ExecucaoAutomacaoBreDto = z.object({
  id: Id,
  automacaoNome: z.string(),
  contatoId: Id,
  contatoNome: z.string(),
  status: z.enum(["enviada", "ignorada"]),
  detalhe: z.string().nullable(),
  criadoEm: DataIso,
});
export type ExecucaoAutomacaoBreDto = z.infer<typeof ExecucaoAutomacaoBreDto>;
