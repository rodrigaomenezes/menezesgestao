// Ligações do todo ao micro: números do período (feitas, atendidas, taxa, tempo falado) → por dia, por resultado e
// por pessoa → a lista exata, com resultado e gravação (link temporário, acesso registrado). Filtros no endereço.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MAX_DIAS_ANALISE, NOMES_ESTADOS_LIGACAO, NOMES_PROVEDORES_TELEFONE, formatarTelefone, type LigacaoDto, type PainelLigacoesDto } from "@mg/shared";
import { ErroApi, get, post, query } from "../../app/api";
import { atalhosDePeriodo, nomeDoIntervalo, useFiltrosUrl } from "../../app/filtros-url";
import { useDataHora, useEu } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { BarraPeriodo, BarrasPorDia, Destaque, EtiquetasFiltro, Ranking, type Etiqueta } from "../../ui/paineis";
import { useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, ListaVazia, Mensagem, Titulo, usePaginado } from "../../ui/ui";
import { EscolhaProvedor } from "./Telefone";
import { BotaoAvaliar } from "../qualidade/Qualidade";
import { useVocabulario } from "../../app/vocabulario";
import { hojeNoFuso, useFuso } from "../operacao/comum";

const duracao = (s: number | null) => (s === null ? "" : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, "0")}s`);
/** Tempo falado em horas e minutos (o segundo não importa num total). */
const tempoFalado = (s: number) => {
  const min = Math.round(s / 60);
  return min < 60 ? `${min}min` : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}min`;
};

const CHAVES = ["inicio", "fim", "usuarioId", "situacao", "resultadoId", "semResultado"] as const;
type Situacao = "atendida" | "nao_atendida";

function Gravacao({ l }: { l: LigacaoDto }) {
  const [url, setUrl] = useState<string | null>(null);
  const avisar = useAviso();
  if (!l.temGravacao) return null;
  if (url) return <audio className="gravacao" controls autoPlay src={url} />;
  return (
    <button
      type="button"
      className="botao botao-secundario"
      onClick={async () => {
        try {
          setUrl((await post<{ url: string }>(`/ligacoes/${l.id}/gravacao/acesso`)).url);
        } catch (e) {
          avisar(e instanceof ErroApi ? e.message : "Não foi possível abrir a gravação.", "erro");
        }
      }}
    >
      Ouvir gravação
    </button>
  );
}

export function Ligacoes() {
  const termos = useVocabulario();
  const eu = useEu();
  const dataHora = useDataHora();
  const fuso = useFuso();
  const hoje = hojeNoFuso(fuso);
  const padrao = atalhosDePeriodo(hoje).find((a) => a.id === "7d")!.intervalo;
  const { valores: f, mudar } = useFiltrosUrl(CHAVES, { inicio: padrao.inicio, fim: padrao.fim });
  const intervalo = { inicio: f.inicio ?? padrao.inicio, fim: f.fim ?? padrao.fim };
  const situacao = f.situacao === "atendida" || f.situacao === "nao_atendida" ? (f.situacao as Situacao) : undefined;
  const [painel, setPainel] = useState<PainelLigacoesDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const filtro = query({ inicio: intervalo.inicio, fim: intervalo.fim, usuarioId: f.usuarioId });
  const carregar = () => {
    setCarregando(true);
    return get<PainelLigacoesDto>(`/ligacoes/painel${filtro}`)
      .then((p) => (setPainel(p), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o painel."))
      .finally(() => setCarregando(false));
  };
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);
  const lista = usePaginado<LigacaoDto>(
    `/ligacoes${query({ inicio: intervalo.inicio, fim: intervalo.fim, usuarioId: f.usuarioId, situacao, resultadoId: f.resultadoId, semResultado: f.semResultado === "sim" ? "sim" : undefined, limite: 30 })}`,
  );
  useTempoReal(["ligacao."], () => (void carregar(), void lista.recarregar()));

  const t = painel?.totais;
  const a = painel?.totaisAnteriores;
  const escolherSituacao = (s?: Situacao) => mudar({ situacao: s, resultadoId: undefined, semResultado: undefined });
  const resultadoEscolhido = f.semResultado === "sim" ? "" : f.resultadoId;
  const nomeResultado = painel?.resultados.find((r) => (r.resultadoId ?? "") === (resultadoEscolhido ?? "-"))?.nome;
  const nomePessoa = painel?.pessoas.find((p) => p.usuarioId === f.usuarioId)?.nome ?? termos.t("{Colaborador}");
  const periodoPadrao = intervalo.inicio === padrao.inicio && intervalo.fim === padrao.fim;
  const TITULOS = { todas: "Ligações feitas", atendida: "Atendidas", nao_atendida: "Não atendidas" };
  const titulo = TITULOS[situacao ?? "todas"];
  const etiquetas: Etiqueta[] = [
    { chave: "periodo", texto: nomeDoIntervalo(intervalo, hoje), aoTirar: periodoPadrao ? undefined : () => mudar({ inicio: undefined, fim: undefined }) },
    ...(situacao ? [{ chave: "situacao", texto: TITULOS[situacao], aoTirar: () => escolherSituacao(undefined) }] : []),
    ...(resultadoEscolhido !== undefined ? [{ chave: "resultado", texto: `Resultado: ${nomeResultado ?? "…"}`, aoTirar: () => mudar({ resultadoId: undefined, semResultado: undefined }) }] : []),
    ...(f.usuarioId ? [{ chave: "pessoa", texto: nomePessoa, aoTirar: () => mudar({ usuarioId: undefined }) }] : []),
  ];
  const serie = (painel?.serie ?? []).map((p) => ({ dia: p.dia, valor: situacao === "atendida" ? p.atendidas : situacao === "nao_atendida" ? p.feitas - p.atendidas : p.feitas }));
  const vazio = (
    <ListaVazia>
      {periodoPadrao && !f.usuarioId && !situacao && resultadoEscolhido === undefined
        ? termos.t("Nenhuma ligação nos últimos 7 dias. Ligue pela ficha {do contato}, pelo funil ou pela fila.")
        : "Nenhuma ligação com esses filtros. Tire um filtro acima ou escolha outro período."}
    </ListaVazia>
  );

  return (
    <>
      <Titulo>Ligações</Titulo>
      <section className="cartao">
        <EscolhaProvedor />
      </section>
      <section className="cartao filtros-painel" aria-label="Filtros do painel">
        <BarraPeriodo hoje={hoje} valor={intervalo} maxDias={MAX_DIAS_ANALISE} aoMudar={(i) => mudar({ inicio: i.inicio, fim: i.fim })} />
        <EtiquetasFiltro itens={etiquetas} aoLimpar={() => mudar({ inicio: undefined, fim: undefined, usuarioId: undefined, situacao: undefined, resultadoId: undefined, semResultado: undefined })} />
      </section>
      <Mensagem tipo="erro">{erro}</Mensagem>

      <div className={`painel${carregando ? " atualizando" : ""}`}>
        <section aria-label="Números do período" className="destaques">
          <Destaque rotulo={TITULOS.todas} valor={String(t?.feitas ?? 0)} atual={t?.feitas ?? 0} anterior={a?.feitas ?? 0} selecionado={!situacao} aoEscolher={() => escolherSituacao(undefined)} />
          <Destaque rotulo={TITULOS.atendida} valor={String(t?.atendidas ?? 0)} atual={t?.atendidas ?? 0} anterior={a?.atendidas ?? 0} selecionado={situacao === "atendida"} aoEscolher={() => escolherSituacao("atendida")} />
          <Destaque
            rotulo={TITULOS.nao_atendida}
            menorMelhor
            valor={String((t?.feitas ?? 0) - (t?.atendidas ?? 0))}
            atual={(t?.feitas ?? 0) - (t?.atendidas ?? 0)}
            anterior={(a?.feitas ?? 0) - (a?.atendidas ?? 0)}
            selecionado={situacao === "nao_atendida"}
            aoEscolher={() => escolherSituacao("nao_atendida")}
          />
          <Destaque
            rotulo="Taxa de atendimento"
            valor={t?.taxaAtendimento === null || t?.taxaAtendimento === undefined ? "—" : `${t.taxaAtendimento.toLocaleString("pt-BR")}%`}
            atual={t?.taxaAtendimento ?? 0}
            anterior={a?.taxaAtendimento ?? 0}
            selecionado={false}
            aoEscolher={() => escolherSituacao("atendida")}
          />
          <Destaque rotulo="Tempo falado" valor={tempoFalado(t?.segundosFalados ?? 0)} atual={t?.segundosFalados ?? 0} anterior={a?.segundosFalados ?? 0} selecionado={false} aoEscolher={() => escolherSituacao("atendida")} />
          <Destaque
            rotulo="Duração média"
            valor={t?.duracaoMediaSegundos === null || t?.duracaoMediaSegundos === undefined ? "—" : duracao(t.duracaoMediaSegundos)}
            atual={t?.duracaoMediaSegundos ?? 0}
            anterior={a?.duracaoMediaSegundos ?? 0}
            selecionado={false}
            aoEscolher={() => escolherSituacao("atendida")}
          />
        </section>
        <p className="dica">Taxa de atendimento = atendidas ÷ feitas. Toque num número ou numa barra para ver a lista abaixo.</p>

        <div className="painel-colunas">
          {intervalo.inicio !== intervalo.fim && (
            <section className="cartao" aria-labelledby="titulo-ligacoes-dia">
              <h2 id="titulo-ligacoes-dia">{titulo} por dia</h2>
              {painel && <BarrasPorDia serie={serie} formatar={(v) => String(v)} rotulo={titulo} aoEscolher={(dia) => mudar({ inicio: dia, fim: dia })} />}
            </section>
          )}
          <section className="cartao" aria-labelledby="titulo-ligacoes-resultado">
            <h2 id="titulo-ligacoes-resultado">Por resultado</h2>
            {painel && (
              <Ranking
                itens={painel.resultados.map((r) => ({ id: r.resultadoId ?? "", rotulo: r.nome, valor: r.quantidade, texto: String(r.quantidade) }))}
                selecionado={resultadoEscolhido}
                aoEscolher={(id) =>
                  id === resultadoEscolhido
                    ? mudar({ resultadoId: undefined, semResultado: undefined })
                    : mudar({ resultadoId: id || undefined, semResultado: id ? undefined : "sim", situacao: undefined })
                }
                vazio="Nenhuma ligação encerrada no período."
              />
            )}
          </section>
        </div>

        <section className="cartao" aria-labelledby="titulo-ligacoes-pessoas">
          <h2 id="titulo-ligacoes-pessoas">Quem mais ligou</h2>
          {painel && (
            <Ranking
              itens={painel.pessoas.map((p) => ({ id: p.usuarioId, rotulo: p.nome, valor: p.feitas, texto: `${p.feitas} · ${p.atendidas} atend. · ${tempoFalado(p.segundosFalados)}` }))}
              selecionado={f.usuarioId}
              aoEscolher={(id) => mudar({ usuarioId: id === f.usuarioId ? undefined : id })}
              vazio="Ninguém ligou no período."
            />
          )}
        </section>

        <section className="cartao" aria-labelledby="titulo-lista-ligacoes">
          <h2 id="titulo-lista-ligacoes">
            {titulo}
            {resultadoEscolhido !== undefined && nomeResultado ? ` · ${nomeResultado}` : ""}
          </h2>
          <Mensagem tipo="erro">{lista.erro}</Mensagem>
          {!lista.carregando && !lista.itens.length && vazio}
          <ul className="lista">
            {lista.itens.map((l) => (
              <li key={l.id} className="item">
                <div className="item-principal">
                  <strong>{l.contatoId ? <Link to={`/contatos/${l.contatoId}`}>{l.contatoNome}</Link> : formatarTelefone(l.numero)}</strong>
                  <span className="item-detalhe">
                    {formatarTelefone(l.numero)} · {dataHora(l.iniciadaEm)} · {l.usuarioNome}
                  </span>
                  <span className="item-detalhe">
                    {termos.t(NOMES_PROVEDORES_TELEFONE[l.provedor])} · {l.estado === "encerrada" ? (l.motivoFim ?? "encerrada") : NOMES_ESTADOS_LIGACAO[l.estado]}
                    {l.duracaoSegundos ? ` · ${duracao(l.duracaoSegundos)}` : ""}
                    {l.resultadoNome && ` · ${l.resultadoNome}`}
                  </span>
                  {l.observacao && <span className="texto-livre item-detalhe">{l.observacao}</span>}
                </div>
                <div className="item-acoes">
                  <Gravacao l={l} />
                  {l.estado === "encerrada" && l.usuarioId !== eu.usuario.id && <BotaoAvaliar alvo={{ ligacaoId: l.id }} />}
                </div>
              </li>
            ))}
          </ul>
          <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
        </section>
      </div>
    </>
  );
}
