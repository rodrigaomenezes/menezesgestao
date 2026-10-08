// Discador da fila: pega o próximo contato (reserva exclusiva), liga, registra o resultado e segue para o próximo.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  NOMES_STATUS_FILA,
  formatarTelefone,
  type FilaDto,
  type FilaItemDto,
  type FilaLoteDto,
  type HistoricoDto,
  type Pagina,
  type ProximoDto,
  type RegistrarResultadoDto,
  type ResultadoLigacaoDto,
} from "@mg/shared";
import { ErroApi, get, post, query } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Escolha, ListaVazia, Mensagem, Titulo, usePaginado } from "../../ui/ui";
import { paraIso } from "../crm/Contato";
import { BotaoLigar, EscolhaProvedor, useTelefone } from "../telefonia/Telefone";

const TEXTOS_HISTORICO: Record<string, string> = {
  "ligacao.encerrada": "Ligação",
  "fila.resultado_registrado": "Resultado na fila",
  "mensagem.recebida": "Mensagem recebida",
  "nota.criada": "Nota",
  "oportunidade.criada": "Oportunidade criada",
  "contato.criado": "Cadastro criado",
};

function UltimosContatos({ contatoId }: { contatoId: string }) {
  const [itens, setItens] = useState<HistoricoDto[]>([]);
  const dataHora = useDataHora();
  useEffect(() => {
    get<Pagina<HistoricoDto>>(`/contatos/${contatoId}/historico?limite=5`).then((p) => setItens(p.itens), () => undefined);
  }, [contatoId]);
  if (!itens.length) return <p className="item-detalhe">Primeiro contato com esta pessoa.</p>;
  return (
    <ul className="lista-simples">
      {itens.map((h) => (
        <li key={h.id}>
          <strong>{TEXTOS_HISTORICO[h.tipo] ?? "Atividade"}</strong>
          {typeof h.dados.resultado === "string" && ` — ${h.dados.resultado}`} <span className="item-detalhe">{dataHora(h.criadoEm)}</span>
        </li>
      ))}
    </ul>
  );
}

function Resultado({ item, ligacaoId, resultados, aoRegistrar }: { item: FilaItemDto; ligacaoId: string | null; resultados: ResultadoLigacaoDto[]; aoRegistrar(r: RegistrarResultadoDto): void }) {
  const [escolhido, setEscolhido] = useState<ResultadoLigacaoDto | null>(null);
  const [quando, setQuando] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const registrar = async (r: ResultadoLigacaoDto) => {
    if (r.acao === "reagendar" && !r.horas && !quando) {
      setEscolhido(r);
      return;
    }
    setEnviando(true);
    setErro("");
    try {
      aoRegistrar(await post<RegistrarResultadoDto>(`/fila-itens/${item.id}/resultado`, { resultadoId: r.id, observacao: observacao || null, retornarEm: paraIso(quando), ligacaoId }));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível registrar.");
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="resultado-fila">
      <h3>Como foi?</h3>
      <div className="campo">
        <label htmlFor="obs-fila">Observação (opcional)</label>
        <textarea id="obs-fila" rows={2} maxLength={2000} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>
      {escolhido && (
        <div className="form-linha">
          <div className="campo">
            <label htmlFor="retornar-em">Ligar de novo em</label>
            <input id="retornar-em" type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </div>
          <button type="button" className="botao" disabled={!quando || enviando} onClick={() => void registrar(escolhido)}>
            Agendar retorno
          </button>
        </div>
      )}
      <div className="botoes-resultado" role="group" aria-label="Resultados">
        {resultados.map((r) => (
          <button key={r.id} type="button" className={`botao ${r.acao === "converter" ? "" : "botao-secundario"}`} disabled={enviando} onClick={() => void registrar(r)}>
            {r.nome}
          </button>
        ))}
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
    </div>
  );
}

function ItensDaFila({ filaId }: { filaId: string }) {
  const [status, setStatus] = useState("");
  const lista = usePaginado<FilaItemDto>(`/filas/${filaId}/itens${query({ status, limite: 30 })}`);
  const dataHora = useDataHora();
  return (
    <section className="cartao" aria-labelledby="titulo-itens">
      <h2 id="titulo-itens">Contatos da fila</h2>
      <Escolha
        rotulo="Situação"
        nome="itens-status"
        valor={status}
        aoMudar={setStatus}
        opcoes={[
          { valor: "pendente", texto: "Na fila" },
          { valor: "reservado", texto: "Em ligação" },
          { valor: "concluido", texto: "Concluídos" },
          { valor: "descartado", texto: "Descartados" },
        ]}
        vazio="Todos (menos descartados)"
      />
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhum contato aqui.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((i) => (
          <li key={i.id} className="item">
            <div className="item-principal">
              <Link to={`/contatos/${i.contatoId}`} className="item-link">
                <strong>{i.contatoNome}</strong>
              </Link>
              <span className="item-detalhe">
                {formatarTelefone(i.telefone)} · {i.tentativas} tentativa(s)
                {i.ultimoResultadoNome && ` · ${i.ultimoResultadoNome}`}
                {i.retornarEm && ` · retorno ${dataHora(i.retornarEm)}`}
                {i.reservadoPorNome && i.status === "reservado" && ` · com ${i.reservadoPorNome}`}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

function Lotes({ filaId }: { filaId: string }) {
  const [lotes, setLotes] = useState<FilaLoteDto[]>([]);
  const dataHora = useDataHora();
  useEffect(() => {
    get<FilaLoteDto[]>(`/filas/${filaId}/lotes`).then(setLotes, () => undefined);
  }, [filaId]);
  if (!lotes.length) return null;
  return (
    <section className="cartao" aria-labelledby="titulo-lotes">
      <h2 id="titulo-lotes">Importações desta fila</h2>
      <ul className="lista">
        {lotes.map((l) => (
          <li key={l.id} className="item">
            <div className="item-principal">
              <strong>{dataHora(l.criadoEm)}</strong>
              <span className="item-detalhe">
                {l.novos} novos · {l.atualizados} atualizados · {l.emOutraFila} já em outra fila · {l.jaLigados} já ligados · {l.ignorados} ignorados
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Discador() {
  const { id = "" } = useParams();
  const { pode } = useSessao();
  const avisar = useAviso();
  const tel = useTelefone();
  const [fila, setFila] = useState<FilaDto | null>(null);
  const [item, setItem] = useState<FilaItemDto | null>(null);
  const [motivo, setMotivo] = useState("");
  const [resultados, setResultados] = useState<ResultadoLigacaoDto[]>([]);
  const [ligacaoId, setLigacaoId] = useState<string | null>(null);
  const [automatico, setAutomatico] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const itemRef = useRef<FilaItemDto | null>(null);
  itemRef.current = item;

  const carregarFila = useCallback(() => {
    get<FilaDto>(`/filas/${id}`).then(setFila, () => undefined);
  }, [id]);
  useEffect(carregarFila, [carregarFila]);
  useTempoReal(["fila."], carregarFila);
  useEffect(() => {
    get<ResultadoLigacaoDto[]>("/telefonia/resultados").then((r) => setResultados(r.filter((x) => !x.arquivadoEm)), () => undefined);
  }, []);
  // A ligação feita daqui termina: guarda o id para o resultado ir junto.
  useEffect(() => tel.aoEncerrar((l) => (l.alvo.filaItemId && l.alvo.filaItemId === itemRef.current?.id ? setLigacaoId(l.id) : undefined)), [tel]);

  const proximo = useCallback(async () => {
    setOcupado(true);
    setMotivo("");
    try {
      const r = await post<ProximoDto>(`/filas/${id}/proximo`);
      setItem(r.item);
      setLigacaoId(null);
      setMotivo(r.motivo ?? "");
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível pegar o próximo.", "erro");
    } finally {
      setOcupado(false);
    }
  }, [id, avisar]);

  const devolver = async () => {
    if (!item) return;
    await post(`/fila-itens/${item.id}/liberar`).catch(() => undefined);
    setItem(null);
    carregarFila();
  };

  const aoRegistrar = (r: RegistrarResultadoDto) => {
    avisar(r.oportunidadeId ? "Convertido! Oportunidade criada no funil." : "Resultado registrado.");
    setItem(null);
    setLigacaoId(null);
    carregarFila();
    if (automatico) void proximo();
  };

  const emLigacao = Boolean(tel.ativa && tel.ativa.estado !== "encerrada");
  return (
    <>
      <p className="trilha">
        <Link to="/filas">Filas</Link>
      </p>
      <Titulo>{fila?.nome ?? "Fila"}</Titulo>
      {fila && (
        <p className="item-detalhe">
          {NOMES_STATUS_FILA[fila.status]} · {fila.prontos} pronto(s) para ligar · {fila.agendados} agendado(s) · {fila.reservados} em ligação
        </p>
      )}
      <section className="cartao discador" aria-labelledby="titulo-discador">
        <h2 id="titulo-discador" className="sr-only">
          Discador
        </h2>
        <div className="form-linha">
          <EscolhaProvedor />
          <label className="marcar">
            <input type="checkbox" checked={automatico} onChange={(e) => setAutomatico(e.target.checked)} />
            Pegar o próximo sozinho
          </label>
        </div>
        {!item && (
          <>
            <button type="button" className="botao botao-largo botao-grande" disabled={ocupado || fila?.status !== "ativa"} onClick={() => void proximo()}>
              {ocupado ? "Buscando…" : "Pegar o próximo"}
            </button>
            {motivo && <Mensagem tipo="info">{motivo}</Mensagem>}
          </>
        )}
        {item && (
          <div className="lead">
            <div className="lead-topo">
              <div>
                <Link to={`/contatos/${item.contatoId}`} className="lead-nome">
                  {item.contatoNome}
                </Link>
                <span className="item-detalhe">
                  {formatarTelefone(item.telefone)} · {item.tentativas} tentativa(s) antes
                  {item.ultimoResultadoNome && ` · último: ${item.ultimoResultadoNome}`}
                </span>
              </div>
              <BotaoLigar alvo={{ filaItemId: item.id, contatoId: item.contatoId, nome: item.contatoNome, numero: item.telefone }} rotulo="Ligar agora" classe="botao botao-grande" />
            </div>
            <UltimosContatos contatoId={item.contatoId} />
            {!emLigacao && <Resultado item={item} ligacaoId={ligacaoId} resultados={resultados} aoRegistrar={aoRegistrar} />}
            {!emLigacao && (
              <button type="button" className="link-secundario" onClick={() => void devolver()}>
                Devolver para a fila sem ligar
              </button>
            )}
          </div>
        )}
      </section>
      {pode("fila", "administrar") && <ItensDaFila filaId={id} />}
      {pode("fila", "administrar") && <Lotes filaId={id} />}
    </>
  );
}
