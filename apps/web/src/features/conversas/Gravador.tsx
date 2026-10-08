// Gravação de áudio no navegador (MediaRecorder). O servidor transforma WebM em mensagem de voz do WhatsApp.
import { useEffect, useRef, useState } from "react";

function formatoSuportado(): { mime: string; extensao: string } {
  const candidatos = [
    { mime: "audio/webm;codecs=opus", extensao: "webm" },
    { mime: "audio/ogg;codecs=opus", extensao: "ogg" },
    { mime: "audio/mp4", extensao: "m4a" },
  ];
  return candidatos.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) ?? { mime: "", extensao: "webm" };
}

export function podeGravar(): boolean {
  return typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Botão de gravar: mostra o tempo, permite cancelar ou enviar. */
export function Gravador({ aoGravar, desabilitado }: { aoGravar(arquivo: File): void; desabilitado?: boolean }) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState("");
  const gravador = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const cancelado = useRef(false);
  const inicio = useRef(0);
  const quadro = useRef(0);

  // Contador de tempo da gravação (só na tela; nenhuma rotina de negócio).
  useEffect(() => {
    if (!gravando) return;
    const atualizar = () => {
      setSegundos(Math.floor((Date.now() - inicio.current) / 1000));
      quadro.current = requestAnimationFrame(atualizar);
    };
    quadro.current = requestAnimationFrame(atualizar);
    return () => cancelAnimationFrame(quadro.current);
  }, [gravando]);

  async function comecar() {
    setErro("");
    try {
      const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime, extensao } = formatoSuportado();
      const r = new MediaRecorder(fluxo, mime ? { mimeType: mime } : undefined);
      partes.current = [];
      cancelado.current = false;
      r.ondataavailable = (e) => e.data.size && partes.current.push(e.data);
      r.onstop = () => {
        fluxo.getTracks().forEach((t) => t.stop());
        setGravando(false);
        if (cancelado.current || !partes.current.length) return;
        const tipo = r.mimeType || mime || "audio/webm";
        aoGravar(new File(partes.current, `gravacao.${extensao}`, { type: tipo }));
      };
      gravador.current = r;
      inicio.current = Date.now();
      setSegundos(0);
      r.start();
      setGravando(true);
    } catch {
      setErro("Não foi possível usar o microfone. Permita o acesso no navegador e tente de novo.");
    }
  }

  function parar(cancelar: boolean) {
    cancelado.current = cancelar;
    gravador.current?.stop();
  }

  if (!podeGravar()) return null;
  return (
    <>
      {gravando ? (
        <div className="gravando" role="status">
          <span className="ponto-gravando" aria-hidden="true" />
          {String(Math.floor(segundos / 60)).padStart(2, "0")}:{String(segundos % 60).padStart(2, "0")}
          <button type="button" className="botao botao-secundario" onClick={() => parar(true)}>
            Cancelar
          </button>
          <button type="button" className="botao" onClick={() => parar(false)}>
            Enviar áudio
          </button>
        </div>
      ) : (
        <button type="button" className="botao botao-secundario botao-icone" disabled={desabilitado} onClick={() => void comecar()} aria-label="Gravar áudio">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
          </svg>
        </button>
      )}
      {erro && (
        <p className="mensagem mensagem-erro" role="alert">
          {erro}
        </p>
      )}
    </>
  );
}

/** Player de áudio com controle de velocidade (1×, 1,5×, 2×). */
export function Audio({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [velocidade, setVelocidade] = useState(1);
  const proxima = () => {
    const v = velocidade === 1 ? 1.5 : velocidade === 1.5 ? 2 : 1;
    setVelocidade(v);
    if (ref.current) ref.current.playbackRate = v;
  };
  return (
    <span className="audio">
      <audio ref={ref} controls preload="none" src={src} />
      <button type="button" className="botao-velocidade" onClick={proxima} aria-label={`Velocidade ${velocidade}x. Tocar para mudar.`}>
        {velocidade.toString().replace(".", ",")}×
      </button>
    </span>
  );
}
