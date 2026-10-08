// Telefone do sistema: um provedor por pessoa (treino, celular ou SIP), uma ligação por vez, painel flutuante
// com estado, tempo, mudo, espera, teclado e gravação (com aviso). Cada mudança de estado vai para o servidor.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  NOMES_ESTADOS_LIGACAO,
  NOMES_PROVEDORES_TELEFONE,
  formatarTelefone,
  type EstadoLigacaoId,
  type LigacaoDto,
  type MeuTelefoneDto,
  type ProvedorTelefoneId,
  type ResultadoLigacaoDto,
} from "@mg/shared";
import { ErroApi, enviarArquivo, get, post } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useAviso } from "../../ui/sobreposicoes";
import { BotaoScripts } from "../operacao/Scripts";
import { provedorCelular, provedorSip, provedorTreino, type Chamada, type ProvedorTelefone } from "./provedores";

export interface AlvoLigacao {
  contatoId?: string | null;
  numero?: string | null;
  oportunidadeId?: string | null;
  filaItemId?: string | null;
  nome?: string | null;
}

interface LigacaoAtiva {
  id: string;
  alvo: AlvoLigacao;
  numero: string;
  provedor: ProvedorTelefoneId;
  estado: EstadoLigacaoId;
  atendidaEm: number | null;
  iniciadaEm: number;
  detalhe: string | null;
}

interface ValorTelefone {
  disponivel: boolean;
  provedores: ProvedorTelefoneId[];
  provedorId: ProvedorTelefoneId;
  escolherProvedor(id: ProvedorTelefoneId): void;
  ligar(alvo: AlvoLigacao): Promise<string | null>;
  ativa: LigacaoAtiva | null;
  /** Avisa quem pediu a ligação (ex.: a fila) quando ela termina. */
  aoEncerrar(fn: (l: LigacaoAtiva) => void): () => void;
}

const Contexto = createContext<ValorTelefone | null>(null);
function useRelogio(ativo: boolean): number {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!ativo) return;
    let quadro = 0;
    let ultimo = 0;
    const tique = (t: number) => {
      if (t - ultimo > 500) {
        ultimo = t;
        setAgora(Date.now());
      }
      quadro = requestAnimationFrame(tique);
    };
    quadro = requestAnimationFrame(tique);
    return () => cancelAnimationFrame(quadro);
  }, [ativo]);
  return agora;
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function ProvedorTelefoneSistema({ children }: { children: ReactNode }) {
  const { pode, eu } = useSessao();
  const avisar = useAviso();
  const disponivel = Boolean(eu?.empresa) && pode("telefonia", "criar");
  const [meu, setMeu] = useState<MeuTelefoneDto | null>(null);
  // A escolha vale para a sessão na tela; o padrão é a melhor forma disponível para a pessoa (SIP, se tiver ramal).
  const [provedorId, setProvedorId] = useState<ProvedorTelefoneId>("celular");
  const [ativa, setAtiva] = useState<LigacaoAtiva | null>(null);
  const ativaRef = useRef<LigacaoAtiva | null>(null);
  ativaRef.current = ativa;
  const provedores = useRef(new Map<ProvedorTelefoneId, ProvedorTelefone>());
  const chamada = useRef<Chamada | null>(null);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  const ouvintes = useRef(new Set<(l: LigacaoAtiva) => void>());

  useEffect(() => {
    if (!disponivel) return;
    get<MeuTelefoneDto>("/telefonia/meu")
      .then((m) => {
        setMeu(m);
        setProvedorId((atual) => (m.provedores.includes(atual) ? atual : m.provedores[0]));
      })
      .catch(() => undefined);
  }, [disponivel]);

  useEffect(() => () => provedores.current.forEach((p) => p.encerrarSessao?.()), []);

  const obterProvedor = useCallback(
    async (id: ProvedorTelefoneId): Promise<ProvedorTelefone> => {
      const existente = provedores.current.get(id);
      if (existente) return existente;
      let p: ProvedorTelefone;
      if (id === "sip") {
        if (!meu?.sip) throw new Error("Você não tem ramal SIP. Use o celular ou o modo treino.");
        p = await provedorSip(meu.sip);
      } else p = id === "treino" ? provedorTreino() : provedorCelular();
      provedores.current.set(id, p);
      return p;
    },
    [meu],
  );

  const escolherProvedor = (id: ProvedorTelefoneId) => setProvedorId(id);

  const ligar = useCallback(
    async (alvo: AlvoLigacao): Promise<string | null> => {
      if (ativa && ativa.estado !== "encerrada") {
        avisar("Termine a ligação atual antes de começar outra.", "erro");
        return null;
      }
      try {
        const provedor = await obterProvedor(provedorId);
        if (!(await provedor.pronto())) throw new Error("O ramal não conectou. Confira a internet ou use o celular.");
        const l = await post<LigacaoDto>("/ligacoes", {
          provedor: provedorId,
          contatoId: alvo.contatoId ?? null,
          numero: alvo.numero ?? null,
          oportunidadeId: alvo.oportunidadeId ?? null,
          filaItemId: alvo.filaItemId ?? null,
        });
        const base: LigacaoAtiva = { id: l.id, alvo, numero: l.numero, provedor: provedorId, estado: "criada", atendidaEm: null, iniciadaEm: Date.now(), detalhe: null };
        setAtiva(base);
        // Cada mudança vai para o servidor na ordem em que aconteceu.
        chamada.current = await provedor.discar(l.numero, (estado, detalhe, extra) => {
          setAtiva((a) => (a && a.id === l.id ? { ...a, estado, detalhe: detalhe ?? a.detalhe, atendidaEm: estado === "em_ligacao" && !a.atendidaEm ? Date.now() : a.atendidaEm } : a));
          fila.current = fila.current
            .then(() => post(`/ligacoes/${l.id}/estado`, { estado, detalhe: detalhe ?? null, duracaoInformada: extra?.duracaoInformada ?? null }))
            .catch(() => undefined);
          if (estado === "encerrada") {
            // Depois que o servidor gravou o fim: avisa quem pediu a ligação (ex.: a fila).
            void fila.current.then(() => {
              const a = ativaRef.current;
              if (a?.id === l.id) ouvintes.current.forEach((fn) => fn({ ...a, estado: "encerrada" }));
            });
          }
        });
        return l.id;
      } catch (e) {
        avisar(e instanceof ErroApi || e instanceof Error ? e.message : "Não foi possível ligar.", "erro");
        return null;
      }
    },
    [ativa, avisar, obterProvedor, provedorId],
  );

  const aoEncerrar = useCallback((fn: (l: LigacaoAtiva) => void) => {
    ouvintes.current.add(fn);
    return () => void ouvintes.current.delete(fn);
  }, []);

  const valor: ValorTelefone = { disponivel, provedores: meu?.provedores ?? ["celular", "treino"], provedorId, escolherProvedor, ligar, ativa, aoEncerrar };
  return (
    <Contexto.Provider value={valor}>
      {children}
      {ativa && <PainelLigacao l={ativa} chamada={chamada} meu={meu} aoFechar={() => setAtiva(null)} />}
    </Contexto.Provider>
  );
}

export function useTelefone(): ValorTelefone {
  const v = useContext(Contexto);
  if (!v) throw new Error("useTelefone fora do ProvedorTelefoneSistema");
  return v;
}

/** Grava a ligação (áudio dos dois lados) depois que a pessoa confirma que avisou o cliente. */
function useGravacao(ligacaoId: string) {
  const gravador = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const [gravando, setGravando] = useState(false);
  const iniciar = (remoto: MediaStream, local: MediaStream | null) => {
    const ctx = new AudioContext();
    const destino = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(remoto).connect(destino);
    if (local) ctx.createMediaStreamSource(local).connect(destino);
    const r = new MediaRecorder(destino.stream);
    partes.current = [];
    r.ondataavailable = (e) => e.data.size && partes.current.push(e.data);
    r.onstop = () => {
      void ctx.close();
      if (!partes.current.length) return;
      const tipo = r.mimeType || "audio/webm";
      void enviarArquivo(`/ligacoes/${ligacaoId}/gravacao`, new File(partes.current, "gravacao.webm", { type: tipo })).catch(() => undefined);
    };
    r.start(1000);
    gravador.current = r;
    setGravando(true);
  };
  const parar = () => {
    if (gravador.current?.state === "recording") gravador.current.stop();
    setGravando(false);
  };
  return { gravando, iniciar, parar };
}

function PainelLigacao({ l, chamada, meu, aoFechar }: { l: LigacaoAtiva; chamada: React.RefObject<Chamada | null>; meu: MeuTelefoneDto | null; aoFechar(): void }) {
  const { eu } = useSessao();
  const agora = useRelogio(l.estado !== "encerrada");
  const audio = useRef<HTMLAudioElement>(null);
  const [mudo, setMudo] = useState(false);
  const [teclado, setTeclado] = useState(false);
  const gravacao = useGravacao(l.id);
  const encerrada = l.estado === "encerrada";
  const c = chamada.current;

  // Áudio do outro lado (SIP).
  useEffect(() => {
    if (audio.current && c?.fluxoRemoto && audio.current.srcObject !== c.fluxoRemoto) {
      audio.current.srcObject = c.fluxoRemoto;
      void audio.current.play().catch(() => undefined);
    }
  });
  useEffect(() => {
    if (encerrada) gravacao.parar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encerrada]);

  const segundos = l.atendidaEm ? (agora - l.atendidaEm) / 1000 : 0;
  const podeGravar = Boolean(meu?.gravacaoAtiva && c?.fluxoRemoto && l.estado === "em_ligacao");

  return (
    <section className="painel-ligacao" role="dialog" aria-label="Ligação em andamento" aria-live="polite">
      <audio ref={audio} autoPlay hidden />
      <header className="painel-topo">
        <strong>{l.alvo.nome ?? formatarTelefone(l.numero)}</strong>
        <span className="item-detalhe">
          {formatarTelefone(l.numero)} · {NOMES_PROVEDORES_TELEFONE[l.provedor]}
        </span>
        <span className={`estado-ligacao estado-${l.estado}`}>
          {NOMES_ESTADOS_LIGACAO[l.estado]}
          {l.atendidaEm && !encerrada && ` · ${mmss(segundos)}`}
          {encerrada && l.detalhe && ` · ${l.detalhe}`}
        </span>
      </header>

      {!encerrada && c?.simular && (l.estado === "tocando" || l.estado === "discando") && (
        <div className="painel-acoes">
          <span className="item-detalhe">Modo treino:</span>
          <button type="button" className="botao botao-secundario" onClick={() => c.simular?.atender()}>
            Simular: atendeu
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => c.simular?.naoAtender()}>
            Simular: não atendeu
          </button>
        </div>
      )}

      {!encerrada && c?.informar && <VolteiDoCelular desde={l.iniciadaEm} aoInformar={(a, s) => c.informar?.(a, s)} />}

      {podeGravar && !gravacao.gravando && c?.fluxoRemoto && (
        <div className="painel-gravacao">
          <p>
            Antes de gravar, avise: <em>“{meu?.avisoGravacao}”</em>
          </p>
          <button type="button" className="botao botao-secundario" onClick={() => c.fluxoRemoto && gravacao.iniciar(c.fluxoRemoto, c.fluxoLocal ?? null)}>
            Avisei — começar a gravar
          </button>
        </div>
      )}
      {gravacao.gravando && (
        <p className="gravando" role="status">
          <span className="ponto-gravando" aria-hidden="true" /> Gravando
        </p>
      )}

      {!encerrada && (
        <div className="painel-acoes">
          <BotaoScripts contatoId={l.alvo.contatoId} uso="ligacao" variaveis={{ nome: l.alvo.nome, vendedor: eu?.usuario.nome, empresa: eu?.empresa?.nome }} />
          {c?.mudo && (
            <button type="button" className="botao botao-secundario" aria-pressed={mudo} onClick={() => (c.mudo?.(!mudo), setMudo(!mudo))}>
              {mudo ? "Ativar som" : "Mudo"}
            </button>
          )}
          {c?.espera && (l.estado === "em_ligacao" || l.estado === "em_espera") && (
            <button type="button" className="botao botao-secundario" aria-pressed={l.estado === "em_espera"} onClick={() => c.espera?.(l.estado !== "em_espera")}>
              {l.estado === "em_espera" ? "Retomar" : "Espera"}
            </button>
          )}
          {c?.dtmf && l.estado === "em_ligacao" && (
            <button type="button" className="botao botao-secundario" aria-expanded={teclado} onClick={() => setTeclado((t) => !t)}>
              Teclado
            </button>
          )}
          <button type="button" className="botao botao-perigo" onClick={() => c?.desligar()}>
            Desligar
          </button>
        </div>
      )}
      {teclado && !encerrada && (
        <div className="teclado" role="group" aria-label="Teclado">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((t) => (
            <button key={t} type="button" className="botao botao-secundario" onClick={() => c?.dtmf?.(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {encerrada && (l.alvo.filaItemId ? <p className="dica">Registre o resultado na fila.</p> : <ResultadoLigacao ligacaoId={l.id} aoConcluir={aoFechar} />)}
      {encerrada && l.alvo.filaItemId && (
        <button type="button" className="botao botao-secundario" onClick={aoFechar}>
          Fechar
        </button>
      )}
    </section>
  );
}

/** Celular: a ligação acontece fora do sistema; ao voltar, a pessoa conta como foi. */
function VolteiDoCelular({ desde, aoInformar }: { desde: number; aoInformar(atendeu: boolean, segundos: number): void }) {
  const [minutos, setMinutos] = useState("");
  const [voltou, setVoltou] = useState(false);
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === "visible") {
        setVoltou(true);
        setMinutos((m) => m || String(Math.max(1, Math.round((Date.now() - desde) / 60_000))));
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [desde]);
  return (
    <div className="painel-celular">
      <p>{voltou ? "Como foi a ligação?" : "Ligando pelo celular… quando terminar, volte aqui e conte como foi."}</p>
      <div className="form-linha">
        <div className="campo">
          <label htmlFor="duracao-celular">Duração (minutos)</label>
          <input id="duracao-celular" type="number" min={0} max={240} value={minutos} onChange={(e) => setMinutos(e.target.value)} />
        </div>
        <button type="button" className="botao" onClick={() => aoInformar(true, Number(minutos || 1) * 60)}>
          Atendeu
        </button>
        <button type="button" className="botao botao-secundario" onClick={() => aoInformar(false, 0)}>
          Não atendeu
        </button>
      </div>
    </div>
  );
}

function ResultadoLigacao({ ligacaoId, aoConcluir }: { ligacaoId: string; aoConcluir(): void }) {
  const [resultados, setResultados] = useState<ResultadoLigacaoDto[]>([]);
  const [resultadoId, setResultadoId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const avisar = useAviso();
  useEffect(() => {
    get<ResultadoLigacaoDto[]>("/telefonia/resultados").then((r) => setResultados(r.filter((x) => !x.arquivadoEm)), () => undefined);
  }, []);
  const salvar = async () => {
    try {
      await post(`/ligacoes/${ligacaoId}/finalizar`, { resultadoId: resultadoId || null, observacao: observacao || null });
      avisar("Ligação registrada.");
      aoConcluir();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível salvar.");
    }
  };
  return (
    <div className="painel-resultado">
      <div className="campo">
        <label htmlFor="resultado-ligacao">Resultado</label>
        <select id="resultado-ligacao" value={resultadoId} onChange={(e) => setResultadoId(e.target.value)}>
          <option value="">Sem resultado</option>
          {resultados.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="obs-ligacao">Observação</label>
        <textarea id="obs-ligacao" rows={2} value={observacao} maxLength={2000} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      {erro && (
        <p className="mensagem mensagem-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="painel-acoes">
        <button type="button" className="botao" onClick={() => void salvar()}>
          Salvar
        </button>
        <button type="button" className="botao botao-secundario" onClick={aoConcluir}>
          Fechar sem resultado
        </button>
      </div>
    </div>
  );
}

/** Botão "Ligar" para qualquer tela (contato, funil, conversa, fila). Sem telefonia, abre o discador do aparelho. */
export function BotaoLigar({ alvo, rotulo = "Ligar", classe = "botao" }: { alvo: AlvoLigacao & { numero?: string | null }; rotulo?: string; classe?: string }) {
  const tel = useTelefone();
  if (!tel.disponivel) {
    return alvo.numero ? (
      <a className={classe} href={`tel:${alvo.numero}`}>
        {rotulo}
      </a>
    ) : null;
  }
  return (
    <button type="button" className={classe} disabled={Boolean(tel.ativa && tel.ativa.estado !== "encerrada")} onClick={() => void tel.ligar(alvo)}>
      {rotulo}
    </button>
  );
}

/** Escolha da forma de ligar (vale enquanto a tela estiver aberta). */
export function EscolhaProvedor() {
  const tel = useTelefone();
  if (!tel.disponivel) return null;
  return (
    <div className="campo">
      <label htmlFor="provedor-telefone">Ligar por</label>
      <select id="provedor-telefone" value={tel.provedorId} onChange={(e) => tel.escolherProvedor(e.target.value as ProvedorTelefoneId)}>
        {tel.provedores.map((p) => (
          <option key={p} value={p}>
            {NOMES_PROVEDORES_TELEFONE[p]}
          </option>
        ))}
      </select>
    </div>
  );
}
