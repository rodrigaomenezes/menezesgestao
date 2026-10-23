// Peças dos painéis "do todo ao micro": barra de período, etiquetas de filtro, número em destaque, ranking e barras
// por dia. Todo número é clicável e leva a um filtro mais fino; tudo funciona no teclado e em 360 px.
// Sem biblioteca de gráficos: barras são elementos HTML (botões), o que dá foco, leitor de tela e toque grande.
import { useId, useState, type ReactNode } from "react";
import { atalhosDePeriodo, diaCurto, type Intervalo } from "../app/filtros-url";
import { Campo } from "./ui";

/** Período primeiro, com atalhos; "Outro" abre o intervalo livre. */
export function BarraPeriodo({ hoje, valor, aoMudar, maxDias }: { hoje: string; valor: Intervalo; aoMudar(i: Intervalo): void; maxDias: number }) {
  const atalhos = atalhosDePeriodo(hoje);
  const ativo = atalhos.find((a) => a.intervalo.inicio === valor.inicio && a.intervalo.fim === valor.fim);
  const [livre, setLivre] = useState(false);
  const [rascunho, setRascunho] = useState(valor);
  const longo = (Date.parse(rascunho.fim) - Date.parse(rascunho.inicio)) / 86_400_000 >= maxDias;
  return (
    <div className="barra-periodo">
      <div className="atalhos-periodo" role="group" aria-label="Período">
        {atalhos.map((a) => (
          <button key={a.id} type="button" aria-pressed={ativo?.id === a.id} className={ativo?.id === a.id ? "ativa" : ""} onClick={() => (setLivre(false), aoMudar(a.intervalo))}>
            {a.nome}
          </button>
        ))}
        <button type="button" aria-pressed={!ativo || livre} aria-expanded={livre} className={!ativo || livre ? "ativa" : ""} onClick={() => (setRascunho(valor), setLivre(!livre))}>
          {ativo ? "Outro" : `${diaCurto(valor.inicio)} a ${diaCurto(valor.fim)}`}
        </button>
      </div>
      {livre && (
        <form
          className="periodo-livre"
          onSubmit={(e) => {
            e.preventDefault();
            if (rascunho.inicio <= rascunho.fim && !longo) {
              aoMudar(rascunho);
              setLivre(false);
            }
          }}
        >
          <Campo rotulo="De" nome="periodo-inicio" tipo="date" valor={rascunho.inicio} aoMudar={(v) => v && setRascunho((r) => ({ ...r, inicio: v }))} />
          <Campo rotulo="Até" nome="periodo-fim" tipo="date" valor={rascunho.fim} aoMudar={(v) => v && setRascunho((r) => ({ ...r, fim: v }))} />
          <button type="submit" className="botao" disabled={rascunho.inicio > rascunho.fim || longo}>
            Aplicar
          </button>
          {longo && <p className="dica">Escolha até {maxDias} dias.</p>}
        </form>
      )}
    </div>
  );
}

export interface Etiqueta {
  chave: string;
  texto: string;
  /** Sem `aoTirar`, a etiqueta só informa (ex.: o período, que sempre existe). */
  aoTirar?: () => void;
}

/** O caminho do filtro, visível: cada clique vira uma etiqueta; tirar a etiqueta volta um nível. */
export function EtiquetasFiltro({ itens, aoLimpar }: { itens: Etiqueta[]; aoLimpar?: () => void }) {
  if (!itens.length) return null;
  const removiveis = itens.filter((i) => i.aoTirar).length;
  return (
    <div className="etiquetas-filtro" aria-label="Filtros aplicados">
      {itens.map((i) =>
        i.aoTirar ? (
          <button key={i.chave} type="button" className="etiqueta-filtro" onClick={i.aoTirar} aria-label={`Tirar filtro: ${i.texto}`}>
            {i.texto} <span aria-hidden="true">×</span>
          </button>
        ) : (
          <span key={i.chave} className="etiqueta-filtro fixa">
            {i.texto}
          </span>
        ),
      )}
      {aoLimpar && removiveis > 1 && (
        <button type="button" className="botao-texto" onClick={aoLimpar}>
          Limpar filtros
        </button>
      )}
    </div>
  );
}

/** Variação contra o período anterior, em texto (nunca só cor). */
export function variacao(atual: number, anterior: number): { curto: string; texto: string; sentido: "sobe" | "desce" | "igual" } {
  if (atual === anterior) return { curto: "igual", texto: "igual ao período anterior", sentido: "igual" };
  if (!anterior) return { curto: "novo", texto: "novo no período", sentido: "sobe" };
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return { curto: "≈ 0%", texto: "quase igual ao período anterior", sentido: atual > anterior ? "sobe" : "desce" };
  const curto = `${pct > 0 ? "+" : ""}${pct}%`;
  return { curto, texto: `${curto} vs. período anterior`, sentido: pct > 0 ? "sobe" : "desce" };
}

/** Número em destaque, clicável: escolhe o indicador que os gráficos abaixo mostram. */
export function Destaque({
  rotulo,
  valor,
  atual,
  anterior,
  selecionado,
  aoEscolher,
}: {
  rotulo: string;
  valor: string;
  atual: number;
  anterior: number;
  selecionado: boolean;
  aoEscolher(): void;
}) {
  const v = variacao(atual, anterior);
  return (
    <button type="button" className={`destaque${selecionado ? " selecionado" : ""}${atual ? "" : " zerado"}`} aria-pressed={selecionado} onClick={aoEscolher}>
      <span className="destaque-rotulo">{rotulo}</span>
      <strong className="destaque-valor">{valor}</strong>
      <span className={`destaque-variacao ${v.sentido}`} title={v.texto}>
        <span aria-hidden="true">{v.sentido === "sobe" ? "↑ " : v.sentido === "desce" ? "↓ " : "= "}</span>
        {v.curto}
        <span className="destaque-variacao-extra"> {v.texto.slice(v.curto.length).trim() || ""}</span>
      </span>
    </button>
  );
}

export interface ItemRanking {
  id: string;
  rotulo: string;
  valor: number;
  texto: string;
}

/** Ranking em barras horizontais (maior primeiro). Clicar numa barra filtra pela pessoa/categoria. */
export function Ranking({ itens, selecionado, aoEscolher, vazio }: { itens: ItemRanking[]; selecionado?: string; aoEscolher(id: string): void; vazio: ReactNode }) {
  if (!itens.length) return <p className="lista-vazia">{vazio}</p>;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  return (
    <ol className="ranking-barras">
      {itens.map((i, n) => (
        <li key={i.id}>
          <button
            type="button"
            className={`barra-h${selecionado === i.id ? " selecionada" : ""}${selecionado && selecionado !== i.id ? " apagada" : ""}`}
            aria-pressed={selecionado === i.id}
            aria-label={`${n + 1}º ${i.rotulo}: ${i.texto}`}
            onClick={() => aoEscolher(i.id)}
          >
            <span className="barra-h-rotulo">
              <span className="barra-h-posicao">{n + 1}º</span> {i.rotulo}
            </span>
            <span className="barra-h-trilho">
              <span className="barra-h-valor" style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} />
            </span>
            <span className="barra-h-numero">{i.texto}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * Barras por dia (colunas). Clicar num dia aproxima o painel para aquele dia. O valor aparece ao passar o mouse,
 * ao focar pelo teclado e no dia escolhido; "Ver como tabela" mostra todos os números sem depender do gráfico.
 */
export function BarrasPorDia({
  serie,
  formatar,
  rotulo,
  aoEscolher,
}: {
  serie: { dia: string; valor: number }[];
  formatar(v: number): string;
  rotulo: string;
  aoEscolher(dia: string): void;
}) {
  const [foco, setFoco] = useState<string | null>(null);
  const [tabela, setTabela] = useState(false);
  const idTabela = useId();
  const max = Math.max(...serie.map((p) => p.valor), 0);
  const total = serie.reduce((s, p) => s + p.valor, 0);
  const emFoco = serie.find((p) => p.dia === foco);
  const marcarCada = serie.length > 14 ? Math.ceil(serie.length / 7) : 1;
  return (
    <div className="barras-dia">
      <div className="barras-dia-topo">
        <p className="barras-dia-leitura" aria-live="polite">
          {emFoco ? (
            <>
              <strong>{formatar(emFoco.valor)}</strong> em {diaCurto(emFoco.dia, true)}
            </>
          ) : (
            <>
              <strong>{formatar(total)}</strong> no período · maior dia: {formatar(max)}
            </>
          )}
        </p>
        <button type="button" className="botao-texto" aria-expanded={tabela} aria-controls={idTabela} onClick={() => setTabela(!tabela)}>
          {tabela ? "Ver gráfico" : "Ver como tabela"}
        </button>
      </div>
      {tabela ? (
        <table className="tabela-simples" id={idTabela}>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">{rotulo}</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((p) => (
              <tr key={p.dia}>
                <td>
                  <button type="button" className="botao-texto" onClick={() => aoEscolher(p.dia)}>
                    {diaCurto(p.dia, true)}
                  </button>
                </td>
                <td>{formatar(p.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="barras-dia-grade" role="group" aria-label={`${rotulo} por dia`} onMouseLeave={() => setFoco(null)}>
          {serie.map((p, n) => (
            <button
              key={p.dia}
              type="button"
              className={`coluna${foco === p.dia ? " em-foco" : ""}${p.valor ? "" : " vazia"}`}
              aria-label={`${diaCurto(p.dia, true)}: ${formatar(p.valor)}. Abrir o dia.`}
              onMouseEnter={() => setFoco(p.dia)}
              onFocus={() => setFoco(p.dia)}
              onBlur={() => setFoco(null)}
              onClick={() => aoEscolher(p.dia)}
            >
              <span className="coluna-barra" style={{ height: max ? `${Math.max(p.valor ? 3 : 0, (p.valor / max) * 100)}%` : "0%" }} />
              <span className="coluna-dia" aria-hidden="true">
                {n % marcarCada === 0 || n === serie.length - 1 ? diaCurto(p.dia).slice(0, 2) : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
