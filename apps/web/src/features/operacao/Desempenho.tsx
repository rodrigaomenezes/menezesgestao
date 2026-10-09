// Desempenho por pessoa (calculado dos eventos) e metas com o realizado do período.
import { useEffect, useState } from "react";
import {
  INDICADORES,
  NOMES_PERIODOS,
  PERIODOS,
  formatarIndicador,
  type DesempenhoDto,
  type IndicadorId,
  type MetaDto,
  type PeriodoId,
} from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { BotaoAlternar, CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { hojeNoFuso, useFuso } from "./comum";
import { ProgressoMeta } from "./Rotina";

const NOMES_PERIODO_PAINEL: Record<PeriodoId, string> = { dia: "Dia", semana: "Semana", mes: "Mês" };

function NovaMeta({ pessoas, aoCriar }: { pessoas: { id: string; nome: string }[]; aoCriar(): void }) {
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
        <Escolha rotulo="Indicador" nome="meta-indicador" valor={indicador} aoMudar={setIndicador} opcoes={INDICADORES.map((i) => ({ valor: i.id, texto: i.nome }))} />
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
  const eu = useEu();
  const { pode } = useSessao();
  const fuso = useFuso();
  const avisar = useAviso();
  const [periodo, setPeriodo] = useState<PeriodoId>("dia");
  const [data, setData] = useState(() => hojeNoFuso(fuso));
  const [painel, setPainel] = useState<DesempenhoDto | null>(null);
  const [mais, setMais] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [novaMeta, setNovaMeta] = useState(false);
  const metas = usePaginado<MetaDto>(`/metas${query({ data, limite: 50 })}`);

  const carregar = (cursor?: string) =>
    get<DesempenhoDto>(`/desempenho${query({ periodo, data, cursor, limite: 30 })}`)
      .then((p) => {
        setPainel((a) => (cursor && a ? { ...p, itens: [...a.itens, ...p.itens] } : p));
        setMais(p.proximoCursor);
        setErro("");
      })
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o painel."));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, data]);
  useTempoReal(["meta.", "ligacao.encerrada", "oportunidade.", "tarefa.concluida", "fila.resultado_registrado"], () => {
    void carregar();
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

  return (
    <>
      <Titulo acao={podeDefinir && <BotaoAlternar aberto={novaMeta} aoMudar={setNovaMeta} texto="Nova meta" />}>Desempenho e metas</Titulo>
      {novaMeta && <NovaMeta pessoas={painel?.itens.map((i) => ({ id: i.usuarioId, nome: i.nome })) ?? []} aoCriar={() => (setNovaMeta(false), void metas.recarregar())} />}
      <section className="cartao">
        <div className="abas" role="tablist" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={periodo === p} className={periodo === p ? "ativa" : ""} onClick={() => setPeriodo(p)}>
              {NOMES_PERIODO_PAINEL[p]}
            </button>
          ))}
        </div>
        <div className="filtros">
          <Campo rotulo="Data de referência" nome="desempenho-data" tipo="date" valor={data} aoMudar={(v) => v && setData(v)} />
        </div>
        <p className="dica">Números contados das ações registradas no sistema (ligações, mensagens, funil, fila, tarefas). Ninguém digita resultado.</p>
      </section>

      <section className="cartao" aria-labelledby="titulo-metas-periodo">
        <h2 id="titulo-metas-periodo">Metas</h2>
        <Mensagem tipo="erro">{metas.erro}</Mensagem>
        {!metas.carregando && !metas.itens.length && <ListaVazia>Nenhuma meta definida.</ListaVazia>}
        {metas.itens.map((m) => (
          <div key={m.id} className="meta-linha">
            <ProgressoMeta m={m} />
            {podeDefinir && (
              <button type="button" className="link-secundario" onClick={() => void arquivar(m)}>
                Arquivar
              </button>
            )}
          </div>
        ))}
        <CarregarMais visivel={metas.temMais} carregando={metas.carregando} aoClicar={() => void metas.carregarMais()} />
      </section>

      <section className="cartao" aria-labelledby="titulo-por-pessoa">
        <h2 id="titulo-por-pessoa">
          Por pessoa {painel && <span className="item-detalhe">({painel.inicio === painel.fim ? painel.inicio.split("-").reverse().join("/") : `${painel.inicio.split("-").reverse().join("/")} a ${painel.fim.split("-").reverse().join("/")}`})</span>}
        </h2>
        <Mensagem tipo="erro">{erro}</Mensagem>
        <ul className="lista desempenho">
          {painel?.itens.map((p) => (
            <li key={p.usuarioId} className="item">
              <div className="item-principal">
                <strong>{p.nome}</strong>
                <dl className="indicadores">
                  {INDICADORES.map((i) => (
                    <div key={i.id} className={p.valores[i.id] ? "" : "zerado"}>
                      <dt>{i.nome}</dt>
                      <dd>{formatarIndicador(i.id as IndicadorId, p.valores[i.id] ?? 0)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={Boolean(mais)} carregando={false} aoClicar={() => void carregar(mais ?? undefined)} />
      </section>
    </>
  );
}
