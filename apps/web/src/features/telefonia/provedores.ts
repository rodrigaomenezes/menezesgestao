// Interface de telefonia no navegador (especificação, fase 3): cada provedor sabe discar, desligar, pôr em
// espera, silenciar e mandar tons (DTMF), e avisa as mudanças de estado. O sistema registra tudo no servidor.
import type { EstadoLigacaoId, MeuTelefoneDto, ProvedorTelefoneId } from "@mg/shared";

export interface RecursosTelefone {
  mudo: boolean;
  espera: boolean;
  dtmf: boolean;
  /** Dá para gravar pelo navegador (só quando o áudio passa por aqui). */
  gravacao: boolean;
}

export interface Chamada {
  desligar(): void;
  espera?(ligar: boolean): void;
  mudo?(ligar: boolean): void;
  dtmf?(tecla: string): void;
  /** Áudio da ligação, quando passa pelo navegador (SIP): para ouvir e gravar. */
  fluxoRemoto?: MediaStream | null;
  fluxoLocal?: MediaStream | null;
  /** Modo treino: a pessoa decide o que acontece. */
  simular?: { atender(): void; naoAtender(): void };
  /** Celular: a pessoa informa como foi ao voltar para o sistema. */
  informar?: (atendeu: boolean, segundos: number) => void;
}

export type AoMudarEstado = (estado: EstadoLigacaoId, detalhe?: string, extra?: { duracaoInformada?: number; fluxoRemoto?: MediaStream }) => void;

export interface ProvedorTelefone {
  readonly id: ProvedorTelefoneId;
  readonly nome: string;
  readonly canal: "simulado" | "celular" | "navegador";
  readonly recursos: RecursosTelefone;
  /** Pronto para discar (ex.: ramal SIP registrado). */
  pronto(): Promise<boolean>;
  discar(numeroE164: string, aoMudar: AoMudarEstado): Promise<Chamada>;
  encerrarSessao?(): void;
}

/** Modo treino: nenhuma ligação de verdade. Discando → chamando → a pessoa escolhe se atendeu. */
export function provedorTreino(): ProvedorTelefone {
  return {
    id: "treino",
    nome: "Modo treino",
    canal: "simulado",
    recursos: { mudo: true, espera: true, dtmf: true, gravacao: false },
    async pronto() {
      return true;
    },
    async discar(_numero, aoMudar) {
      let encerrada = false;
      const passo = (ms: number, fn: () => void) => window.setTimeout(() => !encerrada && fn(), ms);
      aoMudar("discando");
      passo(500, () => aoMudar("tocando"));
      return {
        desligar() {
          if (encerrada) return;
          encerrada = true;
          aoMudar("encerrada", "desligada");
        },
        espera: (ligar) => !encerrada && aoMudar(ligar ? "em_espera" : "em_ligacao"),
        mudo: () => undefined,
        dtmf: () => undefined,
        simular: {
          atender: () => !encerrada && aoMudar("em_ligacao"),
          naoAtender() {
            if (encerrada) return;
            encerrada = true;
            aoMudar("encerrada", "não atendeu");
          },
        },
      };
    },
  };
}

/** Celular do vendedor: abre o discador do aparelho; ao voltar, a pessoa conta como foi (o sistema registra). */
export function provedorCelular(): ProvedorTelefone {
  return {
    id: "celular",
    nome: "Celular",
    canal: "celular",
    recursos: { mudo: false, espera: false, dtmf: false, gravacao: false },
    async pronto() {
      return true;
    },
    async discar(numero, aoMudar) {
      let encerrada = false;
      aoMudar("discando");
      // Abre o discador (no computador, o sistema operacional oferece um app de telefone, se houver).
      const link = document.createElement("a");
      link.href = `tel:${numero}`;
      link.rel = "noopener";
      link.click();
      return {
        desligar() {
          if (encerrada) return;
          encerrada = true;
          aoMudar("encerrada", "encerrada sem informar", { duracaoInformada: 0 });
        },
        informar(atendeu, segundos) {
          if (encerrada) return;
          encerrada = true;
          aoMudar("encerrada", atendeu ? "atendida (celular)" : "não atendeu", { duracaoInformada: atendeu ? Math.max(1, Math.round(segundos)) : 0 });
        },
      };
    },
  };
}

/** SIP/WebRTC (JsSIP), carregado só quando a empresa tem servidor e a pessoa tem ramal. */
export async function provedorSip(config: NonNullable<MeuTelefoneDto["sip"]>): Promise<ProvedorTelefone> {
  const { criarProvedorSip } = await import("./sip");
  return criarProvedorSip(config);
}
