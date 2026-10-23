// Desempenho do todo ao micro: números do período (clique escolhe o indicador) → por dia (clique aproxima o dia) →
// ranking (clique foca a pessoa) → as ações por trás do número (clique abre o registro). Os filtros ficam no
// endereço: o "voltar" desfaz o último clique e o link pode ser enviado. Metas com o realizado do período.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  INDICADORES,
  IDS_INDICADORES,
  MAX_DIAS_PAINEL,
  NOMES_PERIODOS,
  PERIODOS,
  formatarIndicador,
  type DesempenhoDto,
  type EventoIndicadorDto,
  type IndicadorId,
  type MetaDto,
  type ResumoDesempenhoDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { diaCurto, nomeDoIntervalo, useFiltrosUrl } from "../../app/filtros-url";
import { useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { BarraPeriodo, BarrasPorDia, Destaque, EtiquetasFiltro, Ranking, type Etiqueta } from "../../ui/paineis";
import { BotaoAlternar, CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { hojeNoFuso, horaNoFuso, useFuso } from "./comum";
import { ProgressoMeta } from "./Rotina";
import { useVocabulario } from "../../app/vocabulario";

const CHAVES = ["inicio", "fim", "indicador", "usuarioId"] as const;
const ehIndicador = (v: string | undefined): v is IndicadorId => Boolean(v && (IDS_INDICADORES as readonly string[]).includes(v));

/** Onde abrir a ação: a conversa, o cadastro do contato ou nada. */
function linkDoEvento(e: EventoIndicadorDto): string | null {
  if (e.entidade === "conversa" && e.entidadeId) return `/conversas/${e.entidadeId}`;
  if (e.contatoId) return `/contatos/${e.contatoId}`;
  return null;
}

function NovaMeta({ pessoas, aoCriar }: { pessoas: { id: string; nome: string }[]; aoCriar(): void }) {
  const termos = useVocabulario();
  const eu = useEu();
  const { pode } = useSessao();
  const avisar = useAviso();
  const [equipes, setEquipes] = useState<{ id: string; nome: string }[]>([]);
  const [alvo, setAlvo] = useState("pessoa");
  const [usuarioId, setUsuarioId] = useState("");
  const [equipeId, setEquipeId] = useState("");
  const [indicador, setIndicador] = useState<string>("ligacoes");
  const [periodo, setPeriodo] = useState<string>("dia");
  const [valor, setValor] = useState("");
  useEffect(() => {
    if (pode("usuarios", "ver")) get<{ equipes: { id: string; nome: string }[] }>("/usuarios/opcoes").then((o) => setEquipes(o.equipes), () => undefined);
  }, [pode]);
  const empresaToda = eu.permissoes.desempenho?.criar === "empresa";
  const envio = useEnvio(async () => {
    await post("/metas", {
      alvo,
      usuarioId: alvo === "pessoa" ? usuarioId : null,
      equipeId: alvo === "equipe" ? equipeId : null,
      indicador,
      periodo,
      valor: Number(valor.replace(",", ".")),
    });
    avisar("Meta definida.");
    setValor("");
    aoCriar();
  });
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-label="Nova meta">
      <div className="grade-campos">
        <Escolha
          rotulo="Para quem"
          nome="meta-alvo"
          valor={alvo}
          aoMudar={setAlvo}
          opcoes={[
            { valor: "pessoa", texto: "Uma pessoa" },
            ...(equipes.length ? [{ valor: "equipe", texto: "Uma equipe" }] : []),
            ...(empresaToda ? [{ valor: "empresa", texto: "A empresa toda" }] : []),
          ]}
        />
        {alvo === "pessoa" && <Escolha rotulo="Pessoa" nome="meta-pessoa" valor={usuarioId} aoMudar={setUsuarioId} vazio="Escolha" obrigatorio opcoes={pessoas.map((p) => ({ valor: p.id, texto: p.nome }))} />}
        {alvo === "equipe" && <Escolha rotulo="Equipe" nome="meta-equipe" valor={equipeId} aoMudar={setEquipeId} vazio="Escolha" obrigatorio opcoes={equipes.map((e) => ({ valor: e.id, texto: e.nome }))} />}
        <Escolha rotulo="Indicador" nome="meta-indicador" valor={indicador} aoMudar={setIndicador} opcoes={INDICADORES.map((i) => ({ valor: i.id, texto: termos.t(i.nome) }))} />
        <Escolha rotulo="Período" nome="meta-periodo" valor={periodo} aoMudar={setPeriodo} opcoes={PERIODOS.map((p) => ({ valor: p, texto: NOMES_PERIODOS[p] }))} />
        <Campo rotulo="Meta" nome="meta-valor" tipo="text" valor={valor} aoMudar={setValor} obrigatorio dica={indicador === "valor_vendido" ? "Em reais." : undefined} />
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        {envio.enviando ? "Salvando…" : "Definir meta"}
      </button>
    </form>
  );
}

export function Desempenho() {
  const termos = useVocabulario();
  const eu = useEu();
  const { pode } = useSessao();
  const fuso = useFuso();
  const avisar = useAviso();
  const hoje = hojeNoFuso(fuso);
  const { valores: f, mudar } = useFiltrosUrl(CHAVES, { inicio: hoje, fim: hoje, indicador: "ligacoes" });
  const intervalo = { inicio: f.inicio ?? hoje, fim: f.fim ?? hoje };
  const indicador: IndicadorId = ehIndicador(f.indicador) ? f.indicador : "ligacoes";
  const usuarioId = f.usuarioId;
  const nomeIndicador = (id: IndicadorId) => termos.t(INDICADORES.find((i) => i.id === id)!.nome);
  const formatar = (v: number) => formatarIndicador(indicador, v);

  const [resumo, setResumo] = useState<ResumoDesempenhoDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [novaMeta, setNovaMeta] = useState(false);
  const filtroApi = { inicio: intervalo.inicio, fim: intervalo.fim, usuarioId };
  const chaveFiltro = query({ ...filtroApi, indicador });

  const carregar = () => {
    setCarregando(true);
    return get<ResumoDesempenhoDto>(`/desempenho/resumo${chaveFiltro}`)
      .then((r) => (setResumo(r), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o painel."))
      .finally(() => setCarregando(false));
  };
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveFiltro]);
  const eventos = usePaginado<EventoIndicadorDto>(`/desempenho/eventos${query({ ...filtroApi, indicador, limite: 20 })}`);
  const porPessoa = usePaginado<DesempenhoDto["itens"][number]>(`/desempenho${query({ inicio: intervalo.inicio, fim: intervalo.fim, limite: 30 })}`);
  const metas = usePaginado<MetaDto>(`/metas${query({ data: intervalo.fim, usuarioId, limite: 10 })}`);
  useTempoReal(["meta.", "ligacao.encerrada", "oportunidade.", "tarefa.concluida", "fila.resultado_registrado", "mensagem.criada", "conversa.resolvida", "contato.criado"], () => {
    void carregar();
    void eventos.recarregar();
    void metas.recarregar();
  });

  const podeDefinir = pode("desempenho", "criar") && eu.permissoes.desempenho?.criar !== "proprio";
  const arquivar = async (m: MetaDto) => {
    try {
      await patch(`/metas/${m.id}`, { arquivar: true });
      avisar("Meta arquivada.");
      void metas.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível arquivar.", "erro");
    }
  };

  const periodoPadrao = intervalo.inicio === hoje && intervalo.fim === hoje;
  const etiquetas: Etiqueta[] = [
    { chave: "periodo", texto: nomeDoIntervalo(intervalo, hoje), aoTirar: periodoPadrao ? undefined : () => mudar({ inicio: undefined, fim: undefined }) },
    { chave: "indicador", texto: nomeIndicador(indicador) },
    ...(usuarioId ? [{ chave: "pessoa", texto: resumo?.usuarioNome ?? "Pessoa", aoTirar: () => mudar({ usuarioId: undefined }) }] : []),
  ];
  const umDia = intervalo.inicio === intervalo.fim;

  return (
    <>
      <Titulo acao={podeDefinir && <BotaoAlternar aberto={novaMeta} aoMudar={setNovaMeta} texto="Nova meta" />}>Desempenho e metas</Titulo>
      {novaMeta && <NovaMeta pessoas={porPessoa.itens.map((i) => ({ id: i.usuarioId, nome: i.nome }))} aoCriar={() => (setNovaMeta(false), void metas.recarregar())} />}

      <section className="cartao filtros-painel" aria-label="Filtros do painel">
        <BarraPeriodo hoje={hoje} valor={intervalo} maxDias={MAX_DIAS_PAINEL} aoMudar={(i) => mudar({ inicio: i.inicio, fim: i.fim })} />
        <EtiquetasFiltro itens={etiquetas} aoLimpar={() => mudar({ inicio: undefined, fim: undefined, usuarioId: undefined })} />
      </section>
      <Mensagem tipo="erro">{erro}</Mensagem>

      <div className={`painel${carregando ? " atualizando" : ""}`}>
        <section aria-label="Números do período" className="destaques">
          {INDICADORES.map((i) => (
            <Destaque
              key={i.id}
              rotulo={termos.t(i.nome)}
              valor={formatarIndicador(i.id, resumo?.totais[i.id] ?? 0)}
              atual={resumo?.totais[i.id] ?? 0}
              anterior={resumo?.totaisAnteriores[i.id] ?? 0}
              selecionado={indicador === i.id}
              aoEscolher={() => mudar({ indicador: i.id })}
            />
          ))}
        </section>
        <p className="dica">Toque num número para ver o detalhe dele abaixo. Tudo é contado das ações registradas; ninguém digita resultado.</p>

        <div className="painel-colunas">
          {!umDia && (
            <section className="cartao" aria-labelledby="titulo-por-dia">
              <h2 id="titulo-por-dia">
                {nomeIndicador(indicador)} por dia{resumo?.usuarioNome ? ` — ${resumo.usuarioNome}` : ""}
              </h2>
              {resumo && <BarrasPorDia serie={resumo.serie} formatar={formatar} rotulo={nomeIndicador(indicador)} aoEscolher={(dia) => mudar({ inicio: dia, fim: dia })} />}
            </section>
          )}
          <section className="cartao" aria-labelledby="titulo-ranking">
            <h2 id="titulo-ranking">Quem mais fez</h2>
            {resumo && (
              <Ranking
                itens={resumo.ranking.map((r) => ({ id: r.usuarioId, rotulo: r.nome, valor: r.valor, texto: formatar(r.valor) }))}
                selecionado={usuarioId}
                aoEscolher={(id) => mudar({ usuarioId: id === usuarioId ? undefined : id })}
                vazio="Ninguém fez isso no período."
              />
            )}
            {usuarioId && <p className="dica">Toque de novo na pessoa para ver todos.</p>}
          </section>
        </div>

        <section className="cartao" aria-labelledby="titulo-acoes">
          <h2 id="titulo-acoes">
            O que está por trás do número
            <span className="item-detalhe">
              {" "}
              · {nomeIndicador(indicador)} · {umDia ? diaCurto(intervalo.inicio, true) : `${diaCurto(intervalo.inicio)} a ${diaCurto(intervalo.fim, true)}`}
              {resumo?.usuarioNome ? ` · ${resumo.usuarioNome}` : ""}
            </span>
          </h2>
          <Mensagem tipo="erro">{eventos.erro}</Mensagem>
          {!eventos.carregando && !eventos.itens.length && <ListaVazia>Nenhuma ação deste tipo no período.</ListaVazia>}
          <ul className="lista acoes-indicador">
            {eventos.itens.map((e) => {
              const link = linkDoEvento(e);
              const conteudo = (
                <>
                  <span className="acao-quando">
                    {umDia ? "" : `${diaCurto(new Date(e.criadoEm).toLocaleDateString("en-CA", { timeZone: fuso }))} `}
                    {horaNoFuso(e.criadoEm, fuso)}
                  </span>
                  <span className="acao-o-que">
                    <strong>{e.contatoNome ?? nomeIndicador(indicador)}</strong>
                    {e.detalhe && <span className="item-detalhe"> · {e.detalhe}</span>}
                    {!usuarioId && e.usuarioNome && <span className="item-detalhe"> · {e.usuarioNome}</span>}
                  </span>
                  {e.valor !== 1 && <span className="acao-valor">{formatar(e.valor)}</span>}
                </>
              );
              return (
                <li key={e.id} className="acao-linha">
                  {link ? (
                    <Link to={link} className="acao-link">
                      {conteudo}
                      <span aria-hidden="true" className="acao-seta">›</span>
                    </Link>
                  ) : (
                    <div className="acao-link sem-link">{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <CarregarMais visivel={eventos.temMais} carregando={eventos.carregando} aoClicar={() => void eventos.carregarMais()} />
        </section>
      </div>

      <section className="cartao" aria-labelledby="titulo-metas-periodo">
        <h2 id="titulo-metas-periodo">
          Metas{resumo?.usuarioNome ? ` — ${resumo.usuarioNome}` : ""} <span className="item-detalhe">· realizado até {diaCurto(intervalo.fim, true)}</span>
        </h2>
        <Mensagem tipo="erro">{metas.erro}</Mensagem>
        {!metas.carregando && !metas.itens.length && <ListaVazia>{usuarioId ? "Nenhuma meta desta pessoa." : "Nenhuma meta definida."}</ListaVazia>}
        <div className="metas-grade">
          {metas.itens.map((m) => (
            <div key={m.id} className="meta-linha">
              <ProgressoMeta m={m} />
              {podeDefinir && (
                <button type="button" className="botao-texto botao-arquivar" onClick={() => void arquivar(m)} aria-label={`Arquivar a meta ${nomeIndicador(m.indicador)} — ${m.alvoNome}`}>
                  Arquivar
                </button>
              )}
            </div>
          ))}
        </div>
        <CarregarMais visivel={metas.temMais} carregando={metas.carregando} aoClicar={() => void metas.carregarMais()} />
      </section>

      <details className="cartao tabela-pessoas">
        <summary>
          <h2>Tabela por pessoa</h2>
        </summary>
        <p className="dica">Todos os números de cada pessoa no período. Toque no nome para focar o painel nela.</p>
        <Mensagem tipo="erro">{porPessoa.erro}</Mensagem>
        <div className="tabela-rolagem">
          <table className="tabela-simples">
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                {INDICADORES.map((i) => (
                  <th key={i.id} scope="col">
                    {termos.t(i.nome)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porPessoa.itens.map((p) => (
                <tr key={p.usuarioId}>
                  <th scope="row">
                    <button type="button" className="botao-texto" onClick={() => (mudar({ usuarioId: p.usuarioId }), window.scrollTo({ top: 0, behavior: "smooth" }))}>
                      {p.nome}
                    </button>
                  </th>
                  {INDICADORES.map((i) => (
                    <td key={i.id}>{formatarIndicador(i.id, p.valores[i.id] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CarregarMais visivel={porPessoa.temMais} carregando={porPessoa.carregando} aoClicar={() => void porPessoa.carregarMais()} />
      </details>
    </>
  );
}
