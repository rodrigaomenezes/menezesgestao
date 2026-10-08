// Telefone pelo navegador com JsSIP (SIP sobre WebSocket seguro + WebRTC). Separado em arquivo próprio para só
// carregar a biblioteca quando a pessoa tiver ramal. A senha do ramal fica só na memória desta aba.
import JsSIP from "jssip";
import type { MeuTelefoneDto } from "@mg/shared";
import type { AoMudarEstado, Chamada, ProvedorTelefone } from "./provedores";

type ConfigSip = NonNullable<MeuTelefoneDto["sip"]>;

const MOTIVOS: Record<string, string> = {
  Busy: "ocupado",
  "No Answer": "não atendeu",
  Rejected: "recusada",
  Unavailable: "indisponível",
  "Not Found": "número não existe",
  Canceled: "cancelada",
  "Request Timeout": "não atendeu",
  "Connection Error": "falha de conexão",
  "User Denied Media Access": "microfone bloqueado",
};

export function criarProvedorSip(config: ConfigSip): ProvedorTelefone {
  const ua = new JsSIP.UA({
    sockets: [new JsSIP.WebSocketInterface(config.servidor)],
    uri: `sip:${config.login}@${config.dominio}`,
    password: config.senha,
    register: true,
    session_timers: false,
  });
  let registrado = false;
  let falhou = false;
  ua.on("registered", () => {
    registrado = true;
  });
  ua.on("unregistered", () => {
    registrado = false;
  });
  ua.on("registrationFailed", () => {
    falhou = true;
  });
  ua.start();

  return {
    id: "sip",
    nome: "Telefone pelo navegador",
    canal: "navegador",
    recursos: { mudo: true, espera: true, dtmf: true, gravacao: true },
    async pronto() {
      // Espera o registro do ramal por até 8 segundos.
      for (let i = 0; i < 40 && !registrado && !falhou; i++) await new Promise((r) => setTimeout(r, 200));
      return registrado;
    },
    async discar(numero, aoMudar: AoMudarEstado): Promise<Chamada> {
      const destino = `sip:${numero.replace(/\D/g, "")}@${config.dominio}`;
      const chamada: Chamada = { desligar: () => undefined, fluxoRemoto: null, fluxoLocal: null };
      const sessao = ua.call(destino, {
        mediaConstraints: { audio: true, video: false },
        pcConfig: { iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] },
        eventHandlers: {
          progress: () => aoMudar("tocando"),
          confirmed: () => aoMudar("em_ligacao"),
          ended: (e: { cause?: string }) => aoMudar("encerrada", MOTIVOS[e.cause ?? ""] ?? "desligada"),
          failed: (e: { cause?: string }) => aoMudar("encerrada", MOTIVOS[e.cause ?? ""] ?? "falhou"),
          hold: () => aoMudar("em_espera"),
          unhold: () => aoMudar("em_ligacao"),
        },
      });
      aoMudar("discando");
      sessao.connection?.addEventListener("track", (e: RTCTrackEvent) => {
        const fluxo = e.streams[0] ?? new MediaStream([e.track]);
        chamada.fluxoRemoto = fluxo;
        aoMudar("em_ligacao", undefined, { fluxoRemoto: fluxo });
      });
      const local = sessao.connection?.getSenders().map((s) => s.track).filter((t): t is MediaStreamTrack => Boolean(t));
      chamada.fluxoLocal = local?.length ? new MediaStream(local) : null;
      chamada.desligar = () => {
        if (!sessao.isEnded()) sessao.terminate();
      };
      chamada.espera = (ligar) => (ligar ? sessao.hold() : sessao.unhold());
      chamada.mudo = (ligar) => (ligar ? sessao.mute({ audio: true }) : sessao.unmute({ audio: true }));
      chamada.dtmf = (tecla) => sessao.sendDTMF(tecla);
      return chamada;
    },
    encerrarSessao() {
      ua.stop();
    },
  };
}
