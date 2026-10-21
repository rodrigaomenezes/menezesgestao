// Motor BRE (fase 8.1): fila do dia, registro de 30 segundos, reentradas e limites da empresa.
// O servidor aplica todas as regras; a tela só mostra o que ele permite e diz o motivo quando recusa.
import { useCallback, useEffect, useState } from "react";
import {
  CATEGORIAS_BREAK,
  ESTADOS_CLIENTE,
  ESTADOS_EMOCIONAIS,
  PROXIMAS_ACOES,
  RESULTADOS_CONTATO,
  SINS,
  TEMPERATURAS,
  type AnaliseBreDto,
  type ItemFilaBreDto,
  type MotivoBreakDto,
  type ReentradaDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useVocabulario } from "../../app/vocabulario";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";

const opcoes = (l: readonly { codigo: string; nome: string }[]) => l.map((i) => ({ valor: i.codigo, texto: i.nome }));
const daquiA = (dias: number) => new Date(Date.now() + dias * 864e5).toLocaleDateString("en-CA");

/** Registro pós-conversa (BRE-FR-012): os campos obrigatórios em uma tela, pensado para 30 segundos. */
export function BotaoRegistrarBre({ contatoId, conversaId, aoRegistrar }: { contatoId: string; conversaId?: string; aoRegistrar?(): void }) {
  const { pode } = useSessao();
  const termos = useVocabulario();
  const avisar = useAviso();
  const [aberto, setAberto] = useState(false);
  const [inicio, setInicio] = useState(0);
  const [motivos, setMotivos] = useState<MotivoBreakDto[]>([]);
  const [resultado, setResultado] = useState("REPLIED_NO_ADVANCE");
  const [temperatura, setTemperatura] = useState("WARM");
  const [emocao, setEmocao] = useState("");
  const [sins, setSins] = useState<string[]>([]);
  const [proximaAcao, setProximaAcao] = useState("CALL_BACK");
  const [retornoEm, setRetornoEm] = useState(daquiA(3));
  const [comBreak, setComBreak] = useState(false);
  const [categoria, setCategoria] = useState("A_TIME");
  const [motivoId, setMotivoId] = useState("");
  const [comentario, setComentario] = useState("");
  useEffect(() => {
    if (!aberto) return;
    setInicio(Date.now());
    get<{ itens: MotivoBreakDto[] }>("/bre/motivos").then((r) => setMotivos(r.itens.filter((m) => !m.arquivadoEm)), () => undefined);
  }, [aberto]);
  const [avisoIa, setAvisoIa] = useState("");
  const daCategoria = motivos.filter((m) => m.categoria === categoria);
  // A IA só pré-preenche: a pessoa confere e salva (BRE-P-010).
  const sugestao = useEnvio(async () => {
    const a = await post<AnaliseBreDto>(`/bre/conversas/${conversaId}/analisar`);
    setResultado(a.resultado);
    setTemperatura(a.temperatura);
    setEmocao(a.estadoEmocional ?? "");
    setSins(a.sins);
    setProximaAcao(a.proximaAcao);
    if (a.retornoEmDias !== null) setRetornoEm(daquiA(a.retornoEmDias));
    setComBreak(Boolean(a.break));
    if (a.break) {
      setCategoria(a.break.categoria);
      setMotivoId("");
      setComentario(a.break.comentario);
    }
    setAvisoIa([a.resumo, ...a.bloqueios, ...a.incertezas].join(" "));
  });
  const semRetorno = proximaAcao === "CLOSE_NO_INTEREST" || resultado === "OPTED_OUT";
  const envio = useEnvio(async () => {
    const r = await post<{ cicloEncerrado: boolean; tarefas: number }>("/bre/registros", {
      contatoId,
      conversaId: conversaId ?? null,
      resultado,
      temperatura,
      estadoEmocional: emocao || null,
      sins,
      proximaAcao,
      retornoEm: semRetorno ? null : retornoEm,
      break: comBreak ? { categoria, motivoId: motivoId || daCategoria[0]?.id, comentario } : null,
      segundos: Math.round((Date.now() - inicio) / 1000),
    });
    avisar(r.cicloEncerrado ? "Conversa registrada. O ciclo foi encerrado e a reentrada ficou programada." : "Conversa registrada.");
    setAberto(false);
    aoRegistrar?.();
  });
  if (!pode("bre", "criar")) return null;
  return (
    <>
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        Registrar conversa
      </button>
      {aberto && (
        <Modal aberto titulo="Registrar conversa" aoFechar={() => setAberto(false)}>
          <form onSubmit={envio.enviar}>
            {conversaId && (
              <p>
                <button type="button" className="botao botao-secundario" disabled={sugestao.enviando} onClick={() => void sugestao.enviar()}>
                  {sugestao.enviando ? "Analisando…" : "Sugerir com IA"}
                </button>
              </p>
            )}
            <Mensagem tipo="erro">{sugestao.erro}</Mensagem>
            <Mensagem tipo="info">{avisoIa}</Mensagem>
            <div className="grade-campos">
              <Escolha rotulo="Resultado" nome="bre-resultado" valor={resultado} aoMudar={setResultado} opcoes={opcoes(RESULTADOS_CONTATO)} />
              <Escolha rotulo="Temperatura" nome="bre-temperatura" valor={temperatura} aoMudar={setTemperatura} opcoes={opcoes(TEMPERATURAS)} />
              <Escolha rotulo="Estado emocional" nome="bre-emocao" valor={emocao} aoMudar={setEmocao} opcoes={opcoes(ESTADOS_EMOCIONAIS)} vazio="Não percebi" />
              <Escolha rotulo="Próxima ação" nome="bre-acao" valor={proximaAcao} aoMudar={setProximaAcao} opcoes={opcoes(PROXIMAS_ACOES)} />
              {!semRetorno && <Campo rotulo="Data do retorno" nome="bre-retorno" tipo="date" valor={retornoEm} aoMudar={setRetornoEm} obrigatorio />}
            </div>
            <fieldset className="campo grupo-marcar">
              <legend>{termos.t("Os três “sim” que {o|a:contato} {contato} deu")}</legend>
              {SINS.map((s) => (
                <label key={s.codigo}>
                  <input type="checkbox" checked={sins.includes(s.codigo)} onChange={(e) => setSins(e.target.checked ? [...sins, s.codigo] : sins.filter((x) => x !== s.codigo))} /> {s.nome}
                </label>
              ))}
            </fieldset>
            <label className="campo">
              <span>
                <input type="checkbox" checked={comBreak} onChange={(e) => setComBreak(e.target.checked)} /> Houve uma quebra (Break)
              </span>
            </label>
            {comBreak && (
              <div className="grade-campos">
                <Escolha rotulo="Categoria" nome="bre-categoria" valor={categoria} aoMudar={(v) => (setCategoria(v), setMotivoId(""))} opcoes={opcoes(CATEGORIAS_BREAK)} />
                <Escolha rotulo="Motivo" nome="bre-motivo" valor={motivoId || daCategoria[0]?.id || ""} aoMudar={setMotivoId} opcoes={daCategoria.map((m) => ({ valor: m.id, texto: m.nome }))} />
                <div className="campo">
                  <label htmlFor="bre-comentario">{termos.t("O que {o|a:contato} {contato} disse")}</label>
                  <textarea id="bre-comentario" rows={2} maxLength={1000} required value={comentario} onChange={(e) => setComentario(e.target.value)} />
                </div>
              </div>
            )}
            <Mensagem tipo="erro">{envio.erro}</Mensagem>
            <div className="modal-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => setAberto(false)}>
                Cancelar
              </button>
              <button type="submit" className="botao" disabled={envio.enviando}>
                Salvar registro
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

const nomeEstado = (c: string | null) => ESTADOS_CLIENTE.find((e) => e.codigo === c)?.nome ?? "";

function Reentradas() {
  const avisar = useAviso();
  const lista = usePaginado<ReentradaDto>("/bre/reentradas?limite=30");
  const concluir = async (r: ReentradaDto, status: "feita" | "cancelada") => {
    try {
      await patch(`/bre/reentradas/${r.id}`, { status });
      avisar(status === "feita" ? "Reentrada concluída." : "Reentrada cancelada.");
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível salvar.", "erro");
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-reentradas">
      <h2 id="titulo-reentradas">Reentradas programadas</h2>
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma reentrada pendente.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((r) => (
          <li key={r.id} className="item">
            <div className="item-principal">
              <strong>{r.contatoNome}</strong>
              <span className="item-detalhe">
                {r.previstaPara ? new Date(`${r.previstaPara}T12:00:00`).toLocaleDateString("pt-BR") : r.condicao} · {r.motivo}
              </span>
            </div>
            <div className="item-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => void concluir(r, "feita")}>
                Feita
              </button>
              <button type="button" className="botao botao-secundario" onClick={() => void concluir(r, "cancelada")}>
                Cancelar
              </button>
            </div>
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

const LIMITES = [
  { chave: "recenteAte", rotulo: "Recente até (dias)" },
  { chave: "ativoAte", rotulo: "Ativo até (dias)" },
  { chave: "inativoApos", rotulo: "Inativo depois de (dias)" },
  { chave: "tentativasPorCiclo", rotulo: "Tentativas por ciclo" },
  { chave: "horasEntreTentativas", rotulo: "Horas entre tentativas" },
  { chave: "diasSilencioEncerra", rotulo: "Dias de silêncio que encerram o ciclo" },
  { chave: "diasEntreCiclos", rotulo: "Dias entre ciclos sem resposta" },
] as const;

function Limites() {
  const avisar = useAviso();
  const [valores, setValores] = useState<Record<string, string>>({});
  const carregar = useCallback(() => {
    get<Record<string, number>>("/bre/config").then((c) => setValores(Object.fromEntries(LIMITES.map((l) => [l.chave, String(c[l.chave])]))), () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const envio = useEnvio(async () => {
    await put("/bre/config", Object.fromEntries(LIMITES.map((l) => [l.chave, Number(valores[l.chave])])));
    avisar("Limites salvos.");
    carregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-limites">
      <h2 id="titulo-limites">Limites da empresa</h2>
      <form onSubmit={envio.enviar}>
        <div className="grade-campos">
          {LIMITES.map((l) => (
            <Campo key={l.chave} rotulo={l.rotulo} nome={`bre-${l.chave}`} tipo="number" valor={valores[l.chave] ?? ""} aoMudar={(v) => setValores({ ...valores, [l.chave]: v })} obrigatorio />
          ))}
        </div>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <button type="submit" className="botao" disabled={envio.enviando}>
          Salvar limites
        </button>
      </form>
    </section>
  );
}

export function Bre() {
  const { pode } = useSessao();
  const fila = usePaginado<ItemFilaBreDto>("/bre/fila-do-dia?limite=30");
  useTempoReal(["bre."], () => void fila.recarregar());
  return (
    <>
      <Titulo>Motor BRE</Titulo>
      <section className="cartao" aria-labelledby="titulo-fila-bre">
        <h2 id="titulo-fila-bre">Fila do dia</h2>
        <p className="dica">Só aparece quem pode ser contatado hoje: os limites de tentativas, silêncio e “não contatar” já foram aplicados.</p>
        <Mensagem tipo="erro">{fila.erro}</Mensagem>
        {!fila.carregando && !fila.itens.length && <ListaVazia>Ninguém para contatar hoje.</ListaVazia>}
        <ul className="lista">
          {fila.itens.map((i) => (
            <li key={i.id} className="item">
              <div className="item-principal">
                <strong>{i.nome}</strong>
                <span className="item-detalhe">{[nomeEstado(i.estado), i.motivo, i.telefone].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="item-acoes">
                <BotaoRegistrarBre contatoId={i.contatoId} aoRegistrar={() => void fila.recarregar()} />
              </div>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={fila.temMais} carregando={fila.carregando} aoClicar={() => void fila.carregarMais()} />
      </section>
      <Reentradas />
      {pode("bre", "administrar") && <Limites />}
    </>
  );
}
