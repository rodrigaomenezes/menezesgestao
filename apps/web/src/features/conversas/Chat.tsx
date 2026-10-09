// Conversa aberta: cabeçalho (contato, dono, status), mensagens (com mídia e áudio) e campo de resposta
// (texto, "/" para respostas rápidas, nota interna, arquivo e gravação de áudio).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  NOMES_STATUS_CONVERSA,
  preencherVariaveis,
  type ConversaDetalheDto,
  type MensagemDto,
  type Pagina,
  type RespostaRapidaDto,
} from "@mg/shared";
import { ErroApi, enviarArquivo, get, post } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { Mensagem as Aviso } from "../../ui/ui";
import { formatarTelefone, useConfigCrm, useTermos } from "../crm/comum";
import { Audio, Gravador } from "./Gravador";
import { BotaoLigar } from "../telefonia/Telefone";
import { BotaoScripts } from "../operacao/Scripts";
import { BotaoAvaliar } from "../qualidade/Qualidade";

const MARCAS: Record<MensagemDto["status"], { texto: string; rotulo: string }> = {
  pendente: { texto: "🕓", rotulo: "Enviando" },
  enviada: { texto: "✓", rotulo: "Enviada" },
  entregue: { texto: "✓✓", rotulo: "Entregue" },
  lida: { texto: "✓✓", rotulo: "Lida" },
  falhou: { texto: "⚠", rotulo: "Não enviada" },
  recebida: { texto: "", rotulo: "" },
};

function Midia({ m }: { m: MensagemDto }) {
  const src = `/api/mensagens/${m.id}/midia`;
  if (!m.temMidia) {
    if (m.tipo === "texto" || m.tipo === "sistema") return null;
    return <span className="midia-pendente">{m.erro ?? "Baixando arquivo…"}</span>;
  }
  if (m.tipo === "imagem")
    return (
      <a href={src} target="_blank" rel="noopener">
        <img className="midia-imagem" src={src} alt={m.midiaNome ?? "Imagem"} loading="lazy" />
      </a>
    );
  if (m.tipo === "audio") return <Audio src={src} />;
  if (m.tipo === "video") return <video className="midia-video" src={src} controls preload="none" />;
  return (
    <a className="midia-documento" href={src} download={m.midiaNome ?? undefined}>
      📄 {m.midiaNome ?? "Documento"}
    </a>
  );
}

function Balao({ m, aoReenviar }: { m: MensagemDto; aoReenviar(id: string): void }) {
  const dataHora = useDataHora();
  const marca = MARCAS[m.status];
  return (
    <li className={`balao balao-${m.direcao}`}>
      {m.direcao === "nota" && <span className="balao-rotulo">Nota interna{m.autorNome ? ` · ${m.autorNome}` : ""}</span>}
      {m.automacao && <span className="balao-rotulo">Mensagem automática</span>}
      <Midia m={m} />
      {m.texto && <p className="texto-livre">{m.texto}</p>}
      <span className="balao-meta">
        {m.direcao === "saida" && m.autorNome && `${m.autorNome} · `}
        {dataHora(m.criadoEm)}
        {m.direcao === "saida" && (
          <span className={`marca marca-${m.status}`} title={marca.rotulo} aria-label={marca.rotulo}>
            {" "}
            {marca.texto}
          </span>
        )}
      </span>
      {m.status === "falhou" && (
        <span className="balao-erro">
          {m.erro ?? "Não foi possível enviar."}{" "}
          <button type="button" className="link-secundario" onClick={() => aoReenviar(m.id)}>
            Tentar de novo
          </button>
        </span>
      )}
    </li>
  );
}

/** Respostas rápidas: digite "/" no começo para escolher; as variáveis são preenchidas na hora. */
function useRespostas() {
  const [respostas, setRespostas] = useState<RespostaRapidaDto[]>([]);
  useEffect(() => {
    get<RespostaRapidaDto[]>("/respostas-rapidas/ativas").then(setRespostas).catch(() => undefined);
  }, []);
  return respostas;
}

function Compositor({ conversa, aoEnviar }: { conversa: ConversaDetalheDto; aoEnviar(): void }) {
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const respostas = useRespostas();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const busca = texto.startsWith("/") && !texto.includes(" ") ? texto.slice(1).toLowerCase() : null;
  const sugestoes = busca === null ? [] : respostas.filter((r) => r.atalho.includes(busca)).slice(0, 6);

  async function executar(acao: () => Promise<unknown>) {
    setEnviando(true);
    setErro("");
    try {
      await acao();
      aoEnviar();
      return true;
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível enviar. Tente de novo.");
      return false;
    } finally {
      setEnviando(false);
    }
  }

  const enviarTexto = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    if (await executar(() => post(`/conversas/${conversa.id}/mensagens`, { texto: t, nota }))) {
      setTexto("");
      setNota(false);
    }
  };

  const enviarArquivoOuAudio = (arquivo: File, legenda = "") =>
    executar(() => enviarArquivo(`/conversas/${conversa.id}/midia`, arquivo, legenda ? { legenda } : {}));

  const teclas = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sugestoes.length && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      setTexto(preencherVariaveis(sugestoes[0].texto, conversa.variaveis));
      return;
    }
    // Enter envia; Shift+Enter quebra a linha (no celular, o botão Enviar).
    if (e.key === "Enter" && !e.shiftKey && !window.matchMedia("(pointer: coarse)").matches) {
      e.preventDefault();
      void enviarTexto();
    }
  };

  return (
    <div className={`compositor ${nota ? "compositor-nota" : ""}`}>
      {sugestoes.length > 0 && (
        <ul className="sugestoes" role="listbox" aria-label="Respostas rápidas">
          {sugestoes.map((r) => (
            <li key={r.id}>
              <button type="button" role="option" aria-selected="false" onClick={() => setTexto(preencherVariaveis(r.texto, conversa.variaveis))}>
                <strong>/{r.atalho}</strong> {r.texto.slice(0, 80)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Aviso tipo="erro">{erro}</Aviso>
      <label className="sr-only" htmlFor="campo-mensagem">
        {nota ? "Nota interna" : "Mensagem"}
      </label>
      <textarea
        id="campo-mensagem"
        rows={2}
        maxLength={4000}
        value={texto}
        placeholder={nota ? "Nota interna (o cliente não vê)" : "Mensagem — digite / para respostas rápidas"}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={teclas}
      />
      <div className="compositor-acoes">
        <label className="marcar">
          <input type="checkbox" checked={nota} onChange={(e) => setNota(e.target.checked)} />
          Nota interna
        </label>
        <span className="espaco" />
        <BotaoScripts contatoId={conversa.contatoId} uso="conversa" variaveis={conversa.variaveis} aoUsar={setTexto} />
        {!nota && (
          <>
            <input
              ref={arquivoRef}
              type="file"
              className="sr-only"
              aria-label="Anexar arquivo"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void enviarArquivoOuAudio(f, texto.trim()).then((ok) => ok && setTexto(""));
              }}
            />
            <button type="button" className="botao botao-secundario botao-icone" aria-label="Anexar arquivo" disabled={enviando} onClick={() => arquivoRef.current?.click()}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path fill="currentColor" d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5Z" />
              </svg>
            </button>
            <Gravador desabilitado={enviando} aoGravar={(f) => void enviarArquivoOuAudio(f)} />
          </>
        )}
        <button type="button" className="botao" disabled={enviando || !texto.trim()} onClick={() => void enviarTexto()}>
          {enviando ? "Enviando…" : nota ? "Salvar nota" : "Enviar"}
        </button>
      </div>
    </div>
  );
}

function Cabecalho({ c, aoMudar }: { c: ConversaDetalheDto; aoMudar(): void }) {
  const { pode, eu } = useSessao();
  const termos = useTermos();
  const avisar = useAviso();
  const { config } = useConfigCrm();
  const agir = async (caminho: string, corpo: unknown, sucesso: string) => {
    try {
      await post(caminho, corpo);
      avisar(sucesso);
      aoMudar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    }
  };
  const podeEditar = pode("conversas", "editar");
  return (
    <header className="chat-topo">
      <Link to="/conversas" className="botao botao-secundario botao-icone chat-voltar" aria-label="Voltar para a lista">
        ←
      </Link>
      <div className="chat-quem">
        <strong>{c.contatoId ? <Link to={`/contatos/${c.contatoId}`}>{c.contatoNome ?? "Sem nome"}</Link> : (c.contatoNome ?? "Sem nome")}</strong>
        <span className="item-detalhe">
          {formatarTelefone(c.telefone)} · {c.canalNome} · {NOMES_STATUS_CONVERSA[c.status]}
        </span>
      </div>
      {c.telefone && (
        <BotaoLigar alvo={{ contatoId: c.contatoId, nome: c.contatoNome, numero: c.telefone }} rotulo="Ligar" classe="botao botao-secundario" />
      )}
      {c.atribuidaA && c.atribuidaA !== eu?.usuario.id && <BotaoAvaliar alvo={{ conversaId: c.id }} />}
      {podeEditar && (
        <div className="chat-acoes">
          <label className="sr-only" htmlFor="atribuir">
            Responsável pela conversa
          </label>
          <select
            id="atribuir"
            value={c.atribuidaA ?? ""}
            onChange={(e) => void agir(`/conversas/${c.id}/atribuir`, { usuarioId: e.target.value || null }, e.target.value ? "Conversa atribuída." : "Conversa devolvida para a fila.")}
          >
            <option value="">Sem dono (fila)</option>
            {!config.responsaveis.some((r) => r.id === eu?.usuario.id) && eu && <option value={eu.usuario.id}>Eu</option>}
            {config.responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id === eu?.usuario.id ? "Eu" : r.nome}
              </option>
            ))}
            {c.atribuidaA && !config.responsaveis.some((r) => r.id === c.atribuidaA) && c.atribuidaA !== eu?.usuario.id && <option value={c.atribuidaA}>{c.atribuidaNome}</option>}
          </select>
          {c.status === "resolvida" ? (
            <button type="button" className="botao botao-secundario" onClick={() => void agir(`/conversas/${c.id}/status`, { status: "aberta" }, "Conversa reaberta.")}>
              Reabrir
            </button>
          ) : (
            <button type="button" className="botao botao-secundario" onClick={() => void agir(`/conversas/${c.id}/status`, { status: "resolvida" }, "Conversa resolvida.")}>
              Resolver
            </button>
          )}
        </div>
      )}
      {c.provedor === "cloud_api" && c.ultimaEntradaEm && Date.now() - new Date(c.ultimaEntradaEm).getTime() > 24 * 3600_000 && (
        <p className="mensagem mensagem-info chat-janela">
          O {termos.contato} não escreve há mais de 24 h: pela API oficial, só ele pode reabrir a conversa (mensagens modelo chegam numa próxima versão).
        </p>
      )}
    </header>
  );
}

export function Chat({ id, aoMudarLista }: { id: string; aoMudarLista(): void }) {
  const [conversa, setConversa] = useState<ConversaDetalheDto | null>(null);
  const [mensagens, setMensagens] = useState<MensagemDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const lista = useRef<HTMLOListElement>(null);
  const noFim = useRef(true);
  const avisar = useAviso();

  const carregarConversa = useCallback(() => {
    get<ConversaDetalheDto>(`/conversas/${id}`)
      .then((c) => {
        setConversa(c);
        setErro("");
        if (c.naoLidas) void post(`/conversas/${id}/lida`).then(aoMudarLista, () => undefined);
      })
      .catch((e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir a conversa."));
  }, [id, aoMudarLista]);

  /** Recarrega a página mais recente e junta com as anteriores já carregadas. */
  const carregarRecentes = useCallback(() => {
    get<Pagina<MensagemDto>>(`/conversas/${id}/mensagens?limite=30`)
      .then((p) => {
        setMensagens((atuais) => {
          const porId = new Map(atuais.map((m) => [m.id, m]));
          for (const m of p.itens) porId.set(m.id, m);
          return [...porId.values()].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id));
        });
        setCursor((c) => c ?? p.proximoCursor);
      })
      .catch(() => undefined);
  }, [id]);

  useEffect(() => {
    setMensagens([]);
    setCursor(null);
    noFim.current = true;
    carregarConversa();
    carregarRecentes();
  }, [carregarConversa, carregarRecentes]);

  useTempoReal(["mensagem.", "conversa."], (a) => {
    if (a.entidadeId !== id) return;
    carregarRecentes();
    if (a.tipo.startsWith("conversa.") || a.tipo === "mensagem.recebida") carregarConversa();
  });

  const anteriores = async () => {
    if (!cursor) return;
    const p = await get<Pagina<MensagemDto>>(`/conversas/${id}/mensagens?limite=30&cursor=${encodeURIComponent(cursor)}`);
    noFim.current = false;
    setMensagens((atuais) => [...p.itens.reverse(), ...atuais]);
    setCursor(p.proximoCursor);
  };

  // Mantém a última mensagem à vista quando chega algo novo (se a pessoa já estava no fim).
  useLayoutEffect(() => {
    const el = lista.current;
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  }, [mensagens]);

  const reenviar = async (mensagemId: string) => {
    try {
      await post(`/mensagens/${mensagemId}/reenviar`);
      carregarRecentes();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível reenviar.", "erro");
    }
  };

  const ordenadas = useMemo(() => mensagens, [mensagens]);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!conversa) return <p className="carregando">Carregando…</p>;

  return (
    <section className="chat" aria-label={`Conversa com ${conversa.contatoNome ?? "cliente"}`}>
      <Cabecalho c={conversa} aoMudar={() => (carregarConversa(), aoMudarLista())} />
      <ol
        className="mensagens"
        ref={lista}
        onScroll={(e) => {
          const el = e.currentTarget;
          noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {cursor && (
          <li className="carregar-anteriores">
            <button type="button" className="link-secundario" onClick={() => void anteriores()}>
              Carregar mensagens anteriores
            </button>
          </li>
        )}
        {ordenadas.map((m) => (
          <Balao key={m.id} m={m} aoReenviar={(i) => void reenviar(i)} />
        ))}
      </ol>
      <Compositor
        conversa={conversa}
        aoEnviar={() => {
          noFim.current = true;
          carregarRecentes();
          aoMudarLista();
        }}
      />
    </section>
  );
}
