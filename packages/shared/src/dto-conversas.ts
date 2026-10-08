// Contrato do módulo Conversas (fase 2): canais, caixa de entrada, mensagens, respostas rápidas e automações.
import { z } from "zod";
import { DataIso, Id, IdOpcional, Paginacao } from "./dto.js";

const texto = (max: number, rotulo: string) =>
  z.string().trim().min(1, { error: `${rotulo}: preencha.` }).max(max, { error: `${rotulo}: no máximo ${max} caracteres.` });
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use o formato HH:MM (ex.: 08:00)." });

// Canais ------------------------------------------------------------------------------------------

export const PROVEDORES_CANAL = ["demonstracao", "cloud_api", "qr"] as const;
export type ProvedorCanalId = (typeof PROVEDORES_CANAL)[number];
export const NOMES_PROVEDORES_CANAL: Record<ProvedorCanalId, string> = {
  demonstracao: "Demonstração (sem número real)",
  cloud_api: "WhatsApp — API oficial (Meta)",
  qr: "WhatsApp — conexão por QR code",
};

export const STATUS_CANAL = ["desconectado", "conectando", "aguardando_qr", "conectado", "erro"] as const;
export const NOMES_STATUS_CANAL: Record<(typeof STATUS_CANAL)[number], string> = {
  desconectado: "Desconectado",
  conectando: "Conectando…",
  aguardando_qr: "Aguardando leitura do QR code",
  conectado: "Conectado",
  erro: "Com erro",
};

export const HorarioCanal = z
  .object({
    dias: z.array(z.number().int().min(1).max(7)).max(7),
    inicio: Hora,
    fim: Hora,
  })
  .refine((h) => h.inicio < h.fim, { error: "O fim do atendimento precisa ser depois do início." });

export const CanalDto = z.object({
  id: Id,
  nome: z.string(),
  provedor: z.enum(PROVEDORES_CANAL),
  numero: z.string().nullable(),
  status: z.enum(STATUS_CANAL),
  statusDetalhe: z.string().nullable(),
  statusEm: DataIso,
  temCredenciais: z.boolean(),
  /** Endereço que deve ser cadastrado no painel da Meta (só API oficial). */
  webhookUrl: z.string().nullable(),
  /** Token de verificação a informar no painel da Meta junto com o endereço (só API oficial). */
  webhookToken: z.string().nullable(),
  horario: HorarioCanal,
  equipeId: Id.nullable(),
  arquivadoEm: DataIso.nullable(),
});
export type CanalDto = z.infer<typeof CanalDto>;

export const CanalEntrada = z.object({
  nome: texto(60, "Nome do canal"),
  provedor: z.enum(PROVEDORES_CANAL),
  equipeId: IdOpcional,
  horario: HorarioCanal.optional(),
});
export const AtualizarCanalEntrada = z.object({
  nome: texto(60, "Nome do canal").optional(),
  equipeId: IdOpcional,
  horario: HorarioCanal.optional(),
  arquivado: z.boolean().optional(),
});

/** Credenciais da API oficial: só entram, nunca saem. */
export const CredenciaisCloudEntrada = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, { error: "Phone number ID: só números, como aparece no painel da Meta." }),
  token: z.string().trim().min(20, { error: "Token de acesso inválido." }).max(1000),
  appSecret: z.string().trim().min(16, { error: "Chave secreta do app inválida." }).max(200),
  numero: z.string().trim().max(40).optional(),
});

export const ConexaoDto = z.object({
  canal: CanalDto,
  /** QR code (imagem data:) enquanto aguarda a leitura no celular. */
  qr: z.string().nullable(),
});
export type ConexaoDto = z.infer<typeof ConexaoDto>;

/** Modo demonstração: simula uma mensagem chegando do celular de um cliente. */
export const SimularEntrada = z.object({
  telefone: z.string().trim().min(8).max(40),
  nome: z.string().trim().max(80).optional(),
  texto: z.string().trim().max(4000).optional(),
  /** Simula o provedor mandando outro identificador para o mesmo cliente. */
  idExterno: z.string().trim().max(120).optional(),
  idMensagem: z.string().trim().max(120).optional(),
  /** Mídia simulada (pequena; vai pelo mesmo caminho de download das mídias reais). */
  midia: z.object({ nome: z.string().max(120), mime: z.string().max(100), base64: z.string().max(600_000) }).optional(),
});

/** Canal resumido para quem atende (escolher o canal de uma conversa nova). */
export const CanalResumoDto = z.object({ id: Id, nome: z.string(), provedor: z.enum(PROVEDORES_CANAL), status: z.enum(STATUS_CANAL) });

// Conversas ---------------------------------------------------------------------------------------

export const STATUS_CONVERSA = ["aberta", "aguardando", "resolvida"] as const;
export const NOMES_STATUS_CONVERSA: Record<(typeof STATUS_CONVERSA)[number], string> = {
  aberta: "Aberta",
  aguardando: "Aguardando cliente",
  resolvida: "Resolvida",
};

export const ConversaDto = z.object({
  id: Id,
  canalId: Id,
  canalNome: z.string(),
  contatoId: Id.nullable(),
  contatoNome: z.string().nullable(),
  telefone: z.string().nullable(),
  atribuidaA: Id.nullable(),
  atribuidaNome: z.string().nullable(),
  status: z.enum(STATUS_CONVERSA),
  naoLidas: z.number().int(),
  ultimaMensagem: z.string().nullable(),
  ultimaMensagemEm: DataIso.nullable(),
  ultimaEntradaEm: DataIso.nullable(),
});
export type ConversaDto = z.infer<typeof ConversaDto>;

export const ConversaDetalheDto = ConversaDto.extend({
  provedor: z.enum(PROVEDORES_CANAL),
  /** Valores para as variáveis das respostas rápidas. */
  variaveis: z.record(z.string(), z.string()),
});
export type ConversaDetalheDto = z.infer<typeof ConversaDetalheDto>;

export const FILTROS_CAIXA = ["minhas", "nao_atribuidas", "todas"] as const;
export const FiltroConversas = Paginacao.extend({
  caixa: z.enum(FILTROS_CAIXA).default("todas"),
  status: z.enum(["abertas", ...STATUS_CONVERSA]).default("abertas"),
  canalId: Id.optional(),
  busca: z.string().trim().max(100).optional(),
});

export const NovaConversaEntrada = z.object({ canalId: Id, contatoId: Id });
export const AtribuirEntrada = z.object({ usuarioId: IdOpcional });
export const StatusConversaEntrada = z.object({ status: z.enum(STATUS_CONVERSA) });

// Mensagens ---------------------------------------------------------------------------------------

export const TIPOS_MENSAGEM = ["texto", "imagem", "audio", "video", "documento", "sistema"] as const;
export const STATUS_MENSAGEM = ["pendente", "enviada", "entregue", "lida", "falhou", "recebida"] as const;

export const MensagemDto = z.object({
  id: Id,
  conversaId: Id,
  direcao: z.enum(["entrada", "saida", "nota"]),
  tipo: z.enum(TIPOS_MENSAGEM),
  texto: z.string().nullable(),
  temMidia: z.boolean(),
  midiaNome: z.string().nullable(),
  midiaMime: z.string().nullable(),
  status: z.enum(STATUS_MENSAGEM),
  erro: z.string().nullable(),
  autorNome: z.string().nullable(),
  automacao: z.string().nullable(),
  criadoEm: DataIso,
});
export type MensagemDto = z.infer<typeof MensagemDto>;

export const EnviarTextoEntrada = z.object({
  texto: texto(4000, "Mensagem"),
  /** Nota interna: fica só na conversa, o cliente não vê. */
  nota: z.boolean().default(false),
});

// Respostas rápidas e automações ------------------------------------------------------------------

/** Variáveis aceitas nas respostas rápidas e mensagens automáticas. */
export const VARIAVEIS_MENSAGEM = ["nome", "vendedor", "produto", "empresa"] as const;

export const RespostaRapidaDto = z.object({ id: Id, atalho: z.string(), texto: z.string(), arquivadoEm: DataIso.nullable() });
export type RespostaRapidaDto = z.infer<typeof RespostaRapidaDto>;
export const RespostaRapidaEntrada = z.object({
  atalho: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{0,29}$/, { error: "Atalho: letras minúsculas, números, - ou _ (ex.: preco)." }),
  texto: texto(2000, "Texto"),
});
export const AtualizarRespostaRapidaEntrada = RespostaRapidaEntrada.partial().extend({ arquivado: z.boolean().optional() });

export const TIPOS_AUTOMACAO = ["boas_vindas", "fora_horario", "follow_up"] as const;
export type TipoAutomacaoId = (typeof TIPOS_AUTOMACAO)[number];
export const NOMES_AUTOMACAO: Record<TipoAutomacaoId, { nome: string; dica: string }> = {
  boas_vindas: { nome: "Boas-vindas", dica: "Enviada na primeira mensagem de um cliente novo." },
  fora_horario: { nome: "Fora do horário", dica: "Enviada quando o cliente escreve fora do horário de atendimento do canal (no máximo uma vez a cada 12 h)." },
  follow_up: { nome: "Follow-up", dica: "Enviada quando o cliente não responde à sua última mensagem depois de algumas horas." },
};

export const AutomacaoDto = z.object({
  tipo: z.enum(TIPOS_AUTOMACAO),
  texto: z.string(),
  horas: z.number().int().nullable(),
  ativa: z.boolean(),
  configurada: z.boolean(),
});
export type AutomacaoDto = z.infer<typeof AutomacaoDto>;
export const AutomacaoEntrada = z.object({
  texto: texto(2000, "Texto"),
  horas: z.number().int().min(1).max(720).nullish(),
  ativa: z.boolean(),
});
export const ParamTipoAutomacao = z.object({ tipo: z.enum(TIPOS_AUTOMACAO) });

/** Troca {nome}, {vendedor}, {produto}, {empresa} pelos valores; variável sem valor vira texto vazio. */
export function preencherVariaveis(modelo: string, valores: Record<string, string | null | undefined>): string {
  return modelo
    .replace(/\{(\w+)\}/g, (inteiro, chave: string) => ((VARIAVEIS_MENSAGEM as readonly string[]).includes(chave) ? (valores[chave] ?? "") : inteiro))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
