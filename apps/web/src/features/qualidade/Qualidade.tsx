// Monitoramento de qualidade do todo ao micro: avaliações do período e nota média → por pessoa e por critério → a
// lista exata das avaliações. Também os critérios e o botão "Avaliar" usado na ligação e na conversa.
import { useCallback, useEffect, useState } from "react";
import { MAX_DIAS_ANALISE, type AvaliacaoDto, type CriterioDto, type PainelQualidadeDto } from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { atalhosDePeriodo, nomeDoIntervalo, useFiltrosUrl } from "../../app/filtros-url";
import { useDataHora, useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useVocabulario } from "../../app/vocabulario";
import { BarraPeriodo, Destaque, EtiquetasFiltro, Ranking, type Etiqueta } from "../../ui/paineis";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { hojeNoFuso, useFuso } from "../operacao/comum";
import { ListaSqBre } from "./SqBre";

const nota = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Quem gerencia (escopo além do próprio) avalia atendimentos da equipe. */
export function usePodeAvaliar(): boolean {
  const eu = useEu();
  const { pode } = useSessao();
  const e = eu.permissoes.qualidade?.criar;
  return pode("qualidade", "criar") && Boolean(e && e !== "proprio");
}

export function BotaoAvaliar({ alvo, rotulo = "Avaliar" }: { alvo: { conversaId: string } | { ligacaoId: string }; rotulo?: string }) {
  const podeAvaliar = usePodeAvaliar();
  const avisar = useAviso();
  const [aberto, setAberto] = useState(false);
  const [criterios, setCriterios] = useState<CriterioDto[]>([]);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!aberto) return;
    get<{ itens: CriterioDto[] }>("/qualidade/criterios").then((r) => {
      setCriterios(r.itens);
      setNotas(Object.fromEntries(r.itens.map((c) => [c.id, "10"])));
    }, () => undefined);
  }, [aberto]);
  const envio = useEnvio(async () => {
    const a = await post<AvaliacaoDto>("/avaliacoes", { ...alvo, notas: criterios.map((c) => ({ criterioId: c.id, nota: Number(notas[c.id]) })), feedback: feedback || null });
    avisar(`Avaliação enviada: nota ${nota(a.notaFinal)}.`);
    setAberto(false);
    setFeedback("");
  });
  if (!podeAvaliar) return null;
  return (
    <>
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        {rotulo}
      </button>
      {aberto && (
        <Modal aberto titulo="Avaliar atendimento" aoFechar={() => setAberto(false)}>
          <form onSubmit={envio.enviar}>
            {criterios.map((c) => (
              <div key={c.id} className="campo campo-nota">
                <label htmlFor={`nota-${c.id}`}>
                  {c.nome} {c.peso > 1 && <span className="item-detalhe">(peso {c.peso})</span>}
                </label>
                <select id={`nota-${c.id}`} value={notas[c.id] ?? "10"} onChange={(e) => setNotas({ ...notas, [c.id]: e.target.value })}>
                  {Array.from({ length: 11 }, (_, i) => 10 - i).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="campo">
              <label htmlFor="avaliacao-feedback">Feedback para a pessoa</label>
              <textarea id="avaliacao-feedback" rows={3} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </div>
            <Mensagem tipo="erro">{envio.erro}</Mensagem>
            <div className="modal-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => setAberto(false)}>
                Cancelar
              </button>
              <button type="submit" className="botao" disabled={envio.enviando || !criterios.length}>
                Enviar avaliação
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Criterios() {
  const avisar = useAviso();
  const [itens, setItens] = useState<CriterioDto[]>([]);
  const [nome, setNome] = useState("");
  const [peso, setPeso] = useState("1");
  const carregar = useCallback(() => {
    get<{ itens: CriterioDto[] }>("/qualidade/criterios").then((r) => setItens(r.itens), () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const envio = useEnvio(async () => {
    await post("/qualidade/criterios", { nome, peso: Number(peso) || 1, ordem: (itens.at(-1)?.ordem ?? 0) + 10 });
    setNome("");
    avisar("Critério criado.");
    carregar();
  });
  const arquivar = async (c: CriterioDto) => {
    try {
      await patch(`/qualidade/criterios/${c.id}`, { arquivar: true });
      avisar("Critério removido (avaliações antigas guardam o que foi avaliado).");
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível remover.", "erro");
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-criterios">
      <h2 id="titulo-criterios">Critérios</h2>
      <ul className="lista">
        {itens.map((c) => (
          <li key={c.id} className="item">
            <div className="item-principal">
              <strong>{c.nome}</strong>
              <span className="item-detalhe">Peso {c.peso}</span>
            </div>
            <div className="item-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => void arquivar(c)}>
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form className="form-linha" onSubmit={envio.enviar} aria-label="Novo critério">
        <Campo rotulo="Novo critério" nome="criterio-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Peso (1 a 10)" nome="criterio-peso" tipo="number" valor={peso} aoMudar={setPeso} />
        <button type="submit" className="botao" disabled={envio.enviando}>
          Adicionar
        </button>
      </form>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
    </section>
  );
}

const CHAVES = ["inicio", "fim", "avaliadoId", "naoLidas"] as const;

export function Qualidade() {
  const eu = useEu();
  const { pode } = useSessao();
  const termos = useVocabulario();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const fuso = useFuso();
  const hoje = hojeNoFuso(fuso);
  const padrao = atalhosDePeriodo(hoje).find((a) => a.id === "30d")!.intervalo;
  const { valores: f, mudar } = useFiltrosUrl(CHAVES, { inicio: padrao.inicio, fim: padrao.fim });
  const intervalo = { inicio: f.inicio ?? padrao.inicio, fim: f.fim ?? padrao.fim };
  const naoLidas = f.naoLidas === "sim";
  const [painel, setPainel] = useState<PainelQualidadeDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const filtro = query({ inicio: intervalo.inicio, fim: intervalo.fim, avaliadoId: f.avaliadoId });
  const carregar = () => {
    setCarregando(true);
    return get<PainelQualidadeDto>(`/avaliacoes/painel${filtro}`)
      .then((p) => (setPainel(p), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o painel."))
      .finally(() => setCarregando(false));
  };
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);
  const lista = usePaginado<AvaliacaoDto>(`/avaliacoes${query({ inicio: intervalo.inicio, fim: intervalo.fim, avaliadoId: f.avaliadoId, naoLidas: naoLidas ? "sim" : undefined, limite: 30 })}`);
  useTempoReal(["avaliacao."], () => (void carregar(), void lista.recarregar()));
  const lida = async (a: AvaliacaoDto) => {
    try {
      await post(`/avaliacoes/${a.id}/lida`);
      void lista.recarregar();
      void carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível marcar.", "erro");
    }
  };

  const t = painel?.totais;
  const a = painel?.totaisAnteriores;
  const nomePessoa = painel?.pessoas.find((p) => p.usuarioId === f.avaliadoId)?.nome ?? termos.t("{Colaborador}");
  const periodoPadrao = intervalo.inicio === padrao.inicio && intervalo.fim === padrao.fim;
  const etiquetas: Etiqueta[] = [
    { chave: "periodo", texto: nomeDoIntervalo(intervalo, hoje), aoTirar: periodoPadrao ? undefined : () => mudar({ inicio: undefined, fim: undefined }) },
    ...(naoLidas ? [{ chave: "nao-lidas", texto: "Feedback não lido", aoTirar: () => mudar({ naoLidas: undefined }) }] : []),
    ...(f.avaliadoId ? [{ chave: "pessoa", texto: nomePessoa, aoTirar: () => mudar({ avaliadoId: undefined }) }] : []),
  ];
  const semFiltro = periodoPadrao && !f.avaliadoId && !naoLidas;

  return (
    <>
      <Titulo>Qualidade</Titulo>
      <section className="cartao filtros-painel" aria-label="Filtros do painel">
        <BarraPeriodo hoje={hoje} valor={intervalo} maxDias={MAX_DIAS_ANALISE} aoMudar={(i) => mudar({ inicio: i.inicio, fim: i.fim })} />
        <EtiquetasFiltro itens={etiquetas} aoLimpar={() => mudar({ inicio: undefined, fim: undefined, avaliadoId: undefined, naoLidas: undefined })} />
      </section>
      <Mensagem tipo="erro">{erro}</Mensagem>

      <div className={`painel${carregando ? " atualizando" : ""}`}>
        <section aria-label="Números do período" className="destaques">
          <Destaque rotulo="Avaliações" valor={String(t?.avaliacoes ?? 0)} atual={t?.avaliacoes ?? 0} anterior={a?.avaliacoes ?? 0} selecionado={!naoLidas} aoEscolher={() => mudar({ naoLidas: undefined })} />
          <Destaque
            rotulo="Nota média"
            valor={t?.notaMedia === null || t?.notaMedia === undefined ? "—" : nota(t.notaMedia)}
            atual={t?.notaMedia ?? 0}
            anterior={a?.notaMedia ?? 0}
            selecionado={false}
            aoEscolher={() => mudar({ naoLidas: undefined })}
          />
          <Destaque
            rotulo="Feedback não lido"
            menorMelhor
            valor={String(t?.naoLidas ?? 0)}
            atual={t?.naoLidas ?? 0}
            anterior={a?.naoLidas ?? 0}
            selecionado={naoLidas}
            aoEscolher={() => mudar({ naoLidas: naoLidas ? undefined : "sim" })}
          />
        </section>

        <div className="painel-colunas">
          <section className="cartao" aria-labelledby="titulo-qualidade-pessoas">
            <h2 id="titulo-qualidade-pessoas">Nota média por pessoa</h2>
            {painel && (
              <Ranking
                itens={painel.pessoas.map((p) => ({ id: p.usuarioId, rotulo: p.nome, valor: p.notaMedia, texto: `${nota(p.notaMedia)} · ${p.avaliacoes} ${p.avaliacoes === 1 ? "avaliação" : "avaliações"}` }))}
                maximo={10}
                selecionado={f.avaliadoId}
                aoEscolher={(id) => mudar({ avaliadoId: id === f.avaliadoId ? undefined : id })}
                vazio="Ninguém foi avaliado no período."
              />
            )}
          </section>
          <section className="cartao" aria-labelledby="titulo-qualidade-criterios">
            <h2 id="titulo-qualidade-criterios">
              Nota por critério{f.avaliadoId ? ` · ${nomePessoa}` : ""} <span className="item-detalhe">· da mais baixa para a mais alta</span>
            </h2>
            {painel && (
              <Ranking
                numerar={false}
                maximo={10}
                itens={painel.criterios.map((c) => ({ id: c.criterioId, rotulo: c.nome, valor: c.notaMedia, texto: nota(c.notaMedia) }))}
                vazio="Nenhuma avaliação no período."
              />
            )}
          </section>
        </div>

        <section className="cartao" aria-labelledby="titulo-avaliacoes">
          <h2 id="titulo-avaliacoes">
            Avaliações{f.avaliadoId ? ` · ${nomePessoa}` : ""}
            {naoLidas ? " · feedback não lido" : ""}
          </h2>
          <p className="dica">Para avaliar, abra a ligação (em Ligações) ou a conversa e use “Avaliar”.</p>
          <Mensagem tipo="erro">{lista.erro}</Mensagem>
          {!lista.carregando && !lista.itens.length && (
            <ListaVazia>{semFiltro ? "Nenhuma avaliação nos últimos 30 dias." : "Nenhuma avaliação com esses filtros. Tire um filtro acima ou escolha outro período."}</ListaVazia>
          )}
          <ul className="lista">
            {lista.itens.map((a) => (
              <li key={a.id} className={`item ${a.avaliadoId === eu.usuario.id && !a.lidaEm ? "item-nao-lido" : ""}`}>
                <div className="item-principal">
                  <strong>
                    Nota {nota(a.notaFinal)} · {a.avaliadoNome}
                  </strong>
                  <span className="item-detalhe">
                    {a.ligacaoId ? "Ligação" : "Conversa"}
                    {a.contatoNome && ` com ${a.contatoNome}`} · por {a.avaliadorNome} · {dataHora(a.criadoEm)}
                  </span>
                  <span className="item-detalhe">{a.notas.map((n) => `${n.nome}: ${nota(n.nota)}`).join(" · ")}</span>
                  {a.feedback && <p className="texto-livre">{a.feedback}</p>}
                </div>
                {a.avaliadoId === eu.usuario.id && !a.lidaEm && (
                  <div className="item-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => void lida(a)}>
                      Li o feedback
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
        </section>
      </div>
      {pode("bre", "ver") && <ListaSqBre />}
      {pode("qualidade", "administrar") && <Criterios />}
    </>
  );
}
