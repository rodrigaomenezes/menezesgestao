// Interface dos provedores de mensagens (Prompt Mestre §53; especificação, fase 2). O domínio (caixa de entrada,
// deduplicação, automações) nunca fala com a Meta ou com o WhatsApp Web direto: só com esta interface.
import type { ProvedorCanal, StatusCanal } from "../../../infra/esquema.js";

/** O que o domínio sabe de um canal ao chamar o provedor. Credenciais já decifradas, só em memória. */
export interface CanalProvedor {
  id: string;
  empresaId: string;
  provedor: ProvedorCanal;
  identificadorExterno: string | null;
  credenciais: Record<string, string> | null;
}

export interface EstadoConexao {
  status: StatusCanal;
  detalhe?: string | null;
  /** Conteúdo do QR code (texto) enquanto aguarda a leitura. */
  qr?: string | null;
  numero?: string | null;
  identificadorExterno?: string | null;
}

export interface Midia {
  nome: string;
  mime: string;
  conteudo: Buffer;
}

export type ConteudoSaida =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagem" | "video" | "documento"; midia: Midia; legenda?: string | null }
  /** voz = mensagem de voz (Ogg/Opus, aparece como gravada no app). */
  | { tipo: "audio"; midia: Midia; voz: boolean };

/** Destino: o telefone (E.164) ou, quando o cliente só tem id do provedor, esse id. */
export interface Destino {
  telefone: string | null;
  idExterno: string | null;
}

export type TipoConteudoEntrada = "texto" | "imagem" | "audio" | "video" | "documento";

/** Evento de entrada já normalizado, igual para todos os provedores. */
export type EventoEntrada =
  | {
      tipo: "mensagem";
      idExterno: string;
      /** Id do remetente no provedor (wa_id, JID, LID…). */
      remetente: string;
      /** Outros ids que o provedor informou para a mesma pessoa. */
      idsAlternativos: string[];
      telefone: string | null;
      nome: string | null;
      conteudo: TipoConteudoEntrada;
      texto: string | null;
      /** Referência para baixar a mídia depois (o webhook responde rápido; um job baixa). */
      midia: { ref: Record<string, unknown>; mime: string; nome: string | null } | null;
      em: Date;
    }
  | { tipo: "status"; idExterno: string; status: "enviada" | "entregue" | "lida" | "falhou"; erro?: string | null };

export interface RecursosProvedor {
  /** Conecta lendo um QR code no celular. */
  qr: boolean;
  /** Recebe por webhook (endereço público cadastrado no provedor). */
  webhook: boolean;
  /** Janela de 24 h para mensagem livre (fora dela, só modelos aprovados). */
  janela24h: boolean;
}

export interface ProvedorMensagens {
  readonly id: ProvedorCanal;
  readonly recursos: RecursosProvedor;
  conectar(canal: CanalProvedor): Promise<EstadoConexao>;
  desconectar(canal: CanalProvedor): Promise<void>;
  estado(canal: CanalProvedor): Promise<EstadoConexao>;
  enviar(canal: CanalProvedor, destino: Destino, conteudo: ConteudoSaida): Promise<{ idExterno: string }>;
  baixarMidia(canal: CanalProvedor, ref: Record<string, unknown>): Promise<Midia>;
}

/** Erro do provedor com mensagem que a pessoa entende (vai para a mensagem que falhou). */
export class ErroProvedor extends Error {
  constructor(
    mensagem: string,
    /** false = não adianta tentar de novo (ex.: número inválido, fora da janela). */
    public readonly temporario = true,
  ) {
    super(mensagem);
  }
}

/** Quem recebe os eventos que chegam por conexão contínua (QR) — o webhook entrega direto pela rota. */
export type AoReceber = (canal: { id: string; empresaId: string }, eventos: EventoEntrada[]) => Promise<void>;
export type AoMudarEstado = (canal: { id: string; empresaId: string }, estado: EstadoConexao) => Promise<void>;
