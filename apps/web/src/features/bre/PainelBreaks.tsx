// Breaks do todo ao micro: quantos no período → por categoria, motivo, dia e quem registrou → a lista exata dos
// Breaks → a ficha do contato. Filtros no endereço (prefixo "brk", para conviver com os da BPI na mesma tela).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORIAS_BREAK, MAX_DIAS_ANALISE, type BreakDto, type CategoriaBreak, type PainelBreaksDto } from "@mg/shared";
import { ErroApi, get, query } from "../../app/api";
import { atalhosDePeriodo, nomeDoIntervalo, useFiltrosUrl } from "../../app/filtros-url";
import { useDataHora } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useVocabulario } from "../../app/vocabulario";
import { BarraPeriodo, BarrasPorDia, Destaque, EtiquetasFiltro, Ranking, type Etiqueta } from "../../ui/paineis";
import { CarregarMais, ListaVazia, Mensagem, usePaginado } from "../../ui/ui";
import { hojeNoFuso, useFuso } from "../operacao/comum";

const CHAVES = ["brkInicio", "brkFim", "brkCategoria", "brkMotivo", "brkAutor"] as const;
const NOME_CATEGORIA = Object.fromEntries(CATEGORIAS_BREAK.map((c) => [c.codigo, c.nome])) as Record<CategoriaBreak, string>;
const ehCategoria = (v?: string): v is CategoriaBreak => Boolean(v && v in NOME_CATEGORIA);

export function PainelBreaks() {
  const termos = useVocabulario();
  const dataHora = useDataHora();
  const fuso = useFuso();
  const hoje = hojeNoFuso(fuso);
  const padrao = atalhosDePeriodo(hoje).find((a) => a.id === "30d")!.intervalo;
  const { valores: f, mudar } = useFiltrosUrl(CHAVES, { brkInicio: padrao.inicio, brkFim: padrao.fim });
  const intervalo = { inicio: f.brkInicio ?? padrao.inicio, fim: f.brkFim ?? padrao.fim };
  const categoria = ehCategoria(f.brkCategoria) ? f.brkCategoria : undefined;
  const [painel, setPainel] = useState<PainelBreaksDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const filtro = query({ inicio: intervalo.inicio, fim: intervalo.fim, categoria, autorId: f.brkAutor });
  const carregar = () => {
    setCarregando(true);
    return get<PainelBreaksDto>(`/bre/breaks/painel${filtro}`)
      .then((p) => (setPainel(p), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar os Breaks."))
      .finally(() => setCarregando(false));
  };
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);
  const lista = usePaginado<BreakDto>(`/bre/breaks${query({ inicio: intervalo.inicio, fim: intervalo.fim, categoria, motivoId: f.brkMotivo, autorId: f.brkAutor, limite: 20 })}`);
  useTempoReal(["bre."], () => (void carregar(), void lista.recarregar()));

  const t = painel?.totais;
  const a = painel?.totaisAnteriores;
  const nomeMotivo = painel?.motivos.find((m) => m.motivoId === f.brkMotivo)?.nome;
  const nomeAutor = painel?.autores.find((p) => p.usuarioId === f.brkAutor)?.nome ?? "Pessoa";
  const periodoPadrao = intervalo.inicio === padrao.inicio && intervalo.fim === padrao.fim;
  const limpar = { brkInicio: undefined, brkFim: undefined, brkCategoria: undefined, brkMotivo: undefined, brkAutor: undefined };
  const etiquetas: Etiqueta[] = [
    { chave: "periodo", texto: nomeDoIntervalo(intervalo, hoje), aoTirar: periodoPadrao ? undefined : () => mudar({ brkInicio: undefined, brkFim: undefined }) },
    ...(categoria ? [{ chave: "categoria", texto: NOME_CATEGORIA[categoria], aoTirar: () => mudar({ brkCategoria: undefined, brkMotivo: undefined }) }] : []),
    ...(f.brkMotivo ? [{ chave: "motivo", texto: `Motivo: ${nomeMotivo ?? "…"}`, aoTirar: () => mudar({ brkMotivo: undefined }) }] : []),
    ...(f.brkAutor ? [{ chave: "autor", texto: nomeAutor, aoTirar: () => mudar({ brkAutor: undefined }) }] : []),
  ];
  const semFiltro = periodoPadrao && !categoria && !f.brkMotivo && !f.brkAutor;

  return (
    <section className="cartao" aria-labelledby="titulo-breaks">
      <h2 id="titulo-breaks">Breaks: onde a venda quebra</h2>
      <BarraPeriodo hoje={hoje} valor={intervalo} maxDias={MAX_DIAS_ANALISE} aoMudar={(i) => mudar({ brkInicio: i.inicio, brkFim: i.fim })} />
      <EtiquetasFiltro itens={etiquetas} aoLimpar={() => mudar(limpar)} />
      <Mensagem tipo="erro">{erro}</Mensagem>
      <div className={`painel${carregando ? " atualizando" : ""}`}>
        <div className="destaques" role="group" aria-label="Números dos Breaks">
          <Destaque rotulo="Breaks" menorMelhor valor={String(t?.breaks ?? 0)} atual={t?.breaks ?? 0} anterior={a?.breaks ?? 0} selecionado={false} aoEscolher={() => mudar({ brkMotivo: undefined })} />
          <Destaque
            rotulo={termos.t("{Contatos} com Break")}
            menorMelhor
            valor={String(t?.contatos ?? 0)}
            atual={t?.contatos ?? 0}
            anterior={a?.contatos ?? 0}
            selecionado={false}
            aoEscolher={() => mudar({ brkMotivo: undefined })}
          />
        </div>
        <div className="painel-colunas">
          <div>
            <h3>Por categoria</h3>
            {painel && (
              <Ranking
                itens={painel.categorias.map((c) => ({ id: c.categoria, rotulo: NOME_CATEGORIA[c.categoria], valor: c.quantidade, texto: String(c.quantidade) }))}
                selecionado={categoria}
                aoEscolher={(id) => mudar({ brkCategoria: id === categoria ? undefined : id, brkMotivo: undefined })}
                vazio="Nenhum Break no período."
              />
            )}
          </div>
          <div>
            <h3>Por motivo{categoria ? ` · ${NOME_CATEGORIA[categoria]}` : ""}</h3>
            {painel && (
              <Ranking
                itens={painel.motivos.map((m) => ({ id: m.motivoId, rotulo: m.nome, valor: m.quantidade, texto: String(m.quantidade) }))}
                selecionado={f.brkMotivo}
                aoEscolher={(id) => mudar({ brkMotivo: id === f.brkMotivo ? undefined : id })}
                vazio="Nenhum motivo no período."
              />
            )}
          </div>
        </div>
        <div className="painel-colunas">
          {intervalo.inicio !== intervalo.fim && (
            <div>
              <h3>Breaks por dia</h3>
              {painel && <BarrasPorDia serie={painel.serie} formatar={(v) => String(v)} rotulo="Breaks" aoEscolher={(dia) => mudar({ brkInicio: dia, brkFim: dia })} />}
            </div>
          )}
          <div>
            <h3>Quem registrou</h3>
            {painel && (
              <Ranking
                itens={painel.autores.map((p) => ({ id: p.usuarioId, rotulo: p.nome, valor: p.quantidade, texto: String(p.quantidade) }))}
                selecionado={f.brkAutor}
                aoEscolher={(id) => mudar({ brkAutor: id === f.brkAutor ? undefined : id })}
                vazio="Ninguém registrou Break no período."
              />
            )}
          </div>
        </div>

        <h3 id="titulo-lista-breaks">
          Os Breaks{categoria ? ` · ${NOME_CATEGORIA[categoria]}` : ""}
          {f.brkMotivo && nomeMotivo ? ` · ${nomeMotivo}` : ""}
        </h3>
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && (
          <ListaVazia>
            {semFiltro ? (
              "Nenhum Break nos últimos 30 dias. Eles aparecem quando alguém registra uma quebra no registro pós-conversa."
            ) : (
              <>
                Nenhum Break com esses filtros.{" "}
                <button type="button" className="botao-texto" onClick={() => mudar(limpar)}>
                  Limpar filtros
                </button>
              </>
            )}
          </ListaVazia>
        )}
        <ul className="lista acoes-indicador" aria-labelledby="titulo-lista-breaks">
          {lista.itens.map((b) => (
            <li key={b.id} className="acao-linha">
              <Link to={`/contatos/${b.contatoId}`} className="acao-link">
                <span className="acao-o-que">
                  <strong>{b.contatoNome}</strong>
                  <span className="item-detalhe">
                    {" "}
                    · {NOME_CATEGORIA[b.categoria]} · {b.motivo}
                  </span>
                  <span className="item-detalhe texto-livre"> · “{b.comentario}”</span>
                  <span className="item-detalhe">
                    {" "}
                    · {dataHora(b.criadoEm)}
                    {b.autorNome ? ` · ${b.autorNome}` : ""}
                  </span>
                </span>
                <span aria-hidden="true" className="acao-seta">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </div>
    </section>
  );
}
