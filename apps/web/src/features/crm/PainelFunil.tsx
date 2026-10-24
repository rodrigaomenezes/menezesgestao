// Painel do funil do todo ao micro: números do período (entraram, ganhas, perdidas, conversão, ciclo) → onde estão
// as abertas agora (por etapa), por que se perdeu (motivos), quem ganhou (responsáveis) e ganhas por dia → a lista
// exata de oportunidades → a ficha do contato. Filtros no endereço; cada clique vira etiqueta.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MAX_DIAS_ANALISE, type OportunidadeDto, type PainelFunilDto } from "@mg/shared";
import { ErroApi, get, query } from "../../app/api";
import { atalhosDePeriodo, diaCurto, nomeDoIntervalo, useFiltrosUrl } from "../../app/filtros-url";
import { useTempoReal } from "../../app/tempo-real";
import { useVocabulario } from "../../app/vocabulario";
import { BarraPeriodo, BarrasPorDia, Destaque, EtiquetasFiltro, Ranking, type Etiqueta } from "../../ui/paineis";
import { CarregarMais, ListaVazia, Mensagem, usePaginado } from "../../ui/ui";
import { hojeNoFuso, useFuso } from "../operacao/comum";
import { formatarDinheiro } from "./comum";

const CHAVES = ["inicio", "fim", "responsavelId", "lista", "etapaId", "motivoPerdaId"] as const;
/** O que a lista abaixo mostra: cada número e cada barra escolhe uma "lente". */
type Lente = "entraram" | "ganha" | "perdida" | "aberta";
const LENTES: Lente[] = ["entraram", "ganha", "perdida", "aberta"];

export function PainelFunil({ funilId }: { funilId: string }) {
  const termos = useVocabulario();
  const fuso = useFuso();
  const hoje = hojeNoFuso(fuso);
  const padrao = atalhosDePeriodo(hoje).find((a) => a.id === "30d")!.intervalo;
  const { valores: f, mudar } = useFiltrosUrl(CHAVES, { inicio: padrao.inicio, fim: padrao.fim, lista: "ganha" });
  const intervalo = { inicio: f.inicio ?? padrao.inicio, fim: f.fim ?? padrao.fim };
  const lente: Lente = LENTES.includes(f.lista as Lente) ? (f.lista as Lente) : "ganha";
  const [painel, setPainel] = useState<PainelFunilDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const filtro = query({ funilId, inicio: intervalo.inicio, fim: intervalo.fim, responsavelId: f.responsavelId });
  const carregar = () => {
    setCarregando(true);
    return get<PainelFunilDto>(`/funil/painel${filtro}`)
      .then((p) => (setPainel(p), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o painel."))
      .finally(() => setCarregando(false));
  };
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  // A lista exata por trás do que foi clicado.
  const filtroLista =
    lente === "entraram"
      ? { criadaDe: intervalo.inicio, criadaAte: intervalo.fim }
      : lente === "aberta"
        ? { status: "aberta", etapaId: f.etapaId }
        : { status: lente, fechadaDe: intervalo.inicio, fechadaAte: intervalo.fim, motivoPerdaId: lente === "perdida" ? f.motivoPerdaId : undefined };
  const lista = usePaginado<OportunidadeDto>(`/oportunidades${query({ funilId, responsavelId: f.responsavelId, ...filtroLista, limite: 20 })}`);
  useTempoReal(["oportunidade."], () => (void carregar(), void lista.recarregar()));

  const t = painel?.totais;
  const a = painel?.totaisAnteriores;
  const escolher = (l: Lente, extra: { etapaId?: string; motivoPerdaId?: string } = {}) => mudar({ lista: l, etapaId: extra.etapaId, motivoPerdaId: extra.motivoPerdaId });
  const nomeEtapa = painel?.etapas.find((e) => e.etapaId === f.etapaId)?.nome;
  const nomeMotivo = painel?.motivos.find((m) => (m.motivoPerdaId ?? "") === (f.motivoPerdaId ?? ""))?.nome;
  const nomeResponsavel = painel?.responsaveis.find((r) => r.usuarioId === f.responsavelId)?.nome ?? "Responsável";
  const periodoPadrao = intervalo.inicio === padrao.inicio && intervalo.fim === padrao.fim;
  const TITULOS: Record<Lente, string> = {
    entraram: termos.t("{Oportunidades} que entraram"),
    ganha: termos.t("{Oportunidades} ganh{os|as:oportunidades}"),
    perdida: termos.t("{Oportunidades} perdid{os|as:oportunidades}"),
    aberta: termos.t("Abert{os|as:oportunidades} agora"),
  };
  const etiquetas: Etiqueta[] = [
    { chave: "periodo", texto: nomeDoIntervalo(intervalo, hoje), aoTirar: periodoPadrao ? undefined : () => mudar({ inicio: undefined, fim: undefined }) },
    { chave: "lente", texto: TITULOS[lente] },
    ...(f.etapaId && lente === "aberta" ? [{ chave: "etapa", texto: `Etapa: ${nomeEtapa ?? "…"}`, aoTirar: () => mudar({ etapaId: undefined }) }] : []),
    ...(f.motivoPerdaId && lente === "perdida" ? [{ chave: "motivo", texto: `Motivo: ${nomeMotivo ?? "…"}`, aoTirar: () => mudar({ motivoPerdaId: undefined }) }] : []),
    ...(f.responsavelId ? [{ chave: "responsavel", texto: nomeResponsavel, aoTirar: () => mudar({ responsavelId: undefined }) }] : []),
  ];

  return (
    <>
      <section className="cartao filtros-painel" aria-label="Filtros do painel">
        <BarraPeriodo hoje={hoje} valor={intervalo} maxDias={MAX_DIAS_ANALISE} aoMudar={(i) => mudar({ inicio: i.inicio, fim: i.fim })} />
        <EtiquetasFiltro itens={etiquetas} aoLimpar={() => mudar({ inicio: undefined, fim: undefined, responsavelId: undefined, etapaId: undefined, motivoPerdaId: undefined })} />
      </section>
      <Mensagem tipo="erro">{erro}</Mensagem>

      <div className={`painel${carregando ? " atualizando" : ""}`}>
        <section aria-label="Números do período" className="destaques">
          <Destaque rotulo={TITULOS.entraram} valor={String(t?.entraram ?? 0)} atual={t?.entraram ?? 0} anterior={a?.entraram ?? 0} selecionado={lente === "entraram"} aoEscolher={() => escolher("entraram")} />
          <Destaque rotulo={TITULOS.ganha} valor={String(t?.ganhas ?? 0)} atual={t?.ganhas ?? 0} anterior={a?.ganhas ?? 0} selecionado={lente === "ganha"} aoEscolher={() => escolher("ganha")} />
          <Destaque rotulo="Valor ganho" valor={formatarDinheiro(t?.valorGanhoCentavos ?? 0)} atual={t?.valorGanhoCentavos ?? 0} anterior={a?.valorGanhoCentavos ?? 0} selecionado={false} aoEscolher={() => escolher("ganha")} />
          <Destaque rotulo={TITULOS.perdida} valor={String(t?.perdidas ?? 0)} atual={t?.perdidas ?? 0} anterior={a?.perdidas ?? 0} selecionado={lente === "perdida"} aoEscolher={() => escolher("perdida")} menorMelhor />
          <Destaque
            rotulo="Conversão"
            valor={t?.conversao === null || t?.conversao === undefined ? "—" : `${t.conversao.toLocaleString("pt-BR")}%`}
            atual={t?.conversao ?? 0}
            anterior={a?.conversao ?? 0}
            selecionado={false}
            aoEscolher={() => escolher("ganha")}
          />
          <Destaque
            rotulo="Dias até ganhar (média)"
            menorMelhor
            valor={t?.cicloMedioDias === null || t?.cicloMedioDias === undefined ? "—" : t.cicloMedioDias.toLocaleString("pt-BR")}
            atual={t?.cicloMedioDias ?? 0}
            anterior={a?.cicloMedioDias ?? 0}
            selecionado={false}
            aoEscolher={() => escolher("ganha")}
          />
        </section>
        <p className="dica">Conversão = ganhas ÷ (ganhas + perdidas) no período. Toque num número ou numa barra para ver a lista abaixo.</p>

        <div className="painel-colunas">
          <section className="cartao" aria-labelledby="titulo-etapas-agora">
            <h2 id="titulo-etapas-agora">{TITULOS.aberta}, por etapa</h2>
            {painel && (
              <Ranking
                numerar={false}
                itens={painel.etapas.map((e) => ({ id: e.etapaId, rotulo: e.nome, valor: e.quantidade, texto: `${e.quantidade}${e.valorCentavos ? ` · ${formatarDinheiro(e.valorCentavos)}` : ""}` }))}
                selecionado={lente === "aberta" ? f.etapaId : undefined}
                aoEscolher={(id) => escolher("aberta", { etapaId: lente === "aberta" && id === f.etapaId ? undefined : id })}
                vazio="Nenhuma etapa aberta neste funil."
              />
            )}
          </section>
          <section className="cartao" aria-labelledby="titulo-motivos">
            <h2 id="titulo-motivos">Por que perdemos</h2>
            {painel && (
              <Ranking
                itens={painel.motivos.map((m) => ({ id: m.motivoPerdaId ?? "", rotulo: m.nome, valor: m.quantidade, texto: String(m.quantidade) }))}
                selecionado={lente === "perdida" ? (f.motivoPerdaId ?? undefined) : undefined}
                aoEscolher={(id) => escolher("perdida", { motivoPerdaId: lente === "perdida" && id === f.motivoPerdaId ? undefined : id || undefined })}
                vazio="Nenhuma perda no período."
              />
            )}
          </section>
        </div>

        <div className="painel-colunas">
          {intervalo.inicio !== intervalo.fim && (
            <section className="cartao" aria-labelledby="titulo-ganhas-dia">
              <h2 id="titulo-ganhas-dia">{TITULOS.ganha} por dia</h2>
              {painel && <BarrasPorDia serie={painel.serie} formatar={(v) => String(v)} rotulo={TITULOS.ganha} aoEscolher={(dia) => mudar({ inicio: dia, fim: dia, lista: "ganha" })} />}
            </section>
          )}
          <section className="cartao" aria-labelledby="titulo-quem-ganhou">
            <h2 id="titulo-quem-ganhou">Quem ganhou</h2>
            {painel && (
              <Ranking
                itens={painel.responsaveis.map((r) => ({ id: r.usuarioId, rotulo: r.nome, valor: r.valorCentavos, texto: `${formatarDinheiro(r.valorCentavos)} · ${r.ganhas}` }))}
                selecionado={f.responsavelId}
                aoEscolher={(id) => mudar({ responsavelId: id === f.responsavelId ? undefined : id })}
                vazio="Ninguém ganhou no período."
              />
            )}
          </section>
        </div>

        <section className="cartao" aria-labelledby="titulo-lista-funil">
          <h2 id="titulo-lista-funil">
            {TITULOS[lente]}
            {lente === "aberta" && nomeEtapa ? ` · ${nomeEtapa}` : ""}
            {lente === "perdida" && f.motivoPerdaId && nomeMotivo ? ` · ${nomeMotivo}` : ""}{" "}
            {lente !== "aberta" && (
              <span className="item-detalhe">
                · {intervalo.inicio === intervalo.fim ? diaCurto(intervalo.inicio, true) : `${diaCurto(intervalo.inicio)} a ${diaCurto(intervalo.fim, true)}`}
              </span>
            )}
          </h2>
          <Mensagem tipo="erro">{lista.erro}</Mensagem>
          {!lista.carregando && !lista.itens.length && <ListaVazia>Nada com esses filtros.</ListaVazia>}
          <ul className="lista acoes-indicador">
            {lista.itens.map((o) => (
              <li key={o.id} className="acao-linha">
                <Link to={`/contatos/${o.contatoId}`} className="acao-link">
                  <span className="acao-quando">{diaCurto(new Date(o.fechadaEm ?? o.criadoEm).toLocaleDateString("en-CA", { timeZone: fuso }))}</span>
                  <span className="acao-o-que">
                    <strong>{o.contatoNome}</strong>
                    <span className="item-detalhe"> · {o.titulo}</span>
                    {o.responsavelNome && <span className="item-detalhe"> · {o.responsavelNome}</span>}
                  </span>
                  <span className="acao-valor">{formatarDinheiro(o.valorCentavos)}</span>
                  <span aria-hidden="true" className="acao-seta">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
        </section>
      </div>
    </>
  );
}
