// Vendas: painel do todo ao micro (período → dia, oferta, vendedor → a lista exata), registro (contato × oferta ×
// vendedor, com vaga na entrega), confirmação pelo financeiro e cancelamento. Filtros no endereço.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FORMAS_PAGAMENTO,
  NOMES_FORMAS_PAGAMENTO,
  NOMES_STATUS_VENDA,
  type EntregaDto,
  type OfertaDto,
  type Pagina,
  type PainelVendasDto,
  MAX_DIAS_ANALISE,
  type VendaDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";
import { hojeNoFuso, useFuso } from "../operacao/comum";
import { diaCurto, nomeDoIntervalo, useFiltrosUrl } from "../../app/filtros-url";
import { BarraPeriodo, BarrasPorDia, Destaque, EtiquetasFiltro, Ranking, type Etiqueta } from "../../ui/paineis";
import { EscolherContato, paraCentavos, paraReais } from "./comum";
import { useVocabulario } from "../../app/vocabulario";
import { CobrancasDaVenda, ContaCobranca } from "./Cobranca";

const SELO: Record<string, string> = { confirmada: "selo-ganha", cancelada: "selo-perdida" };

/** Quem confere pagamento (escopo além do próprio) confirma e cancela qualquer venda que vê. */
export function useConfereVendas(): boolean {
  const eu = useEu();
  const e = eu.permissoes.vendas?.editar;
  return Boolean(e && e !== "proprio");
}

export function FormVenda({ contato, aoSalvar }: { contato?: { id: string; nome: string }; aoSalvar(v: VendaDto): void }) {
  const termos = useVocabulario();
  const confere = useConfereVendas();
  const avisar = useAviso();
  const [contatoEscolhido, setContato] = useState(contato ?? null);
  const [ofertas, setOfertas] = useState<OfertaDto[]>([]);
  const [entregas, setEntregas] = useState<EntregaDto[]>([]);
  const [ofertaId, setOfertaId] = useState("");
  const [entregaId, setEntregaId] = useState("");
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<string>("pix");
  const [parcelas, setParcelas] = useState("1");
  const [confirmada, setConfirmada] = useState(false);
  useEffect(() => {
    get<Pagina<OfertaDto>>("/ofertas?limite=100").then((p) => setOfertas(p.itens), () => undefined);
  }, []);
  useEffect(() => {
    setEntregaId("");
    if (!ofertaId) return setEntregas([]);
    const o = ofertas.find((x) => x.id === ofertaId);
    if (o?.precoCentavos != null) setValor(paraReais(o.precoCentavos));
    get<Pagina<EntregaDto>>(`/entregas${query({ ofertaId, status: "aberta", limite: 100 })}`).then((p) => setEntregas(p.itens), () => setEntregas([]));
  }, [ofertaId, ofertas]);
  const envio = useEnvio(async () => {
    if (!contatoEscolhido) throw new ErroApi(400, "DADOS_INVALIDOS", termos.t("Escolha {o contato} da venda."));
    const valorCentavos = paraCentavos(valor);
    if (!valorCentavos) throw new ErroApi(400, "DADOS_INVALIDOS", "Informe o valor da venda (ex.: 1.200,00).");
    const v = await post<VendaDto>("/vendas", {
      contatoId: contatoEscolhido.id,
      ofertaId,
      entregaId: entregaId || null,
      valorCentavos,
      formaPagamento: forma,
      parcelas: Number(parcelas) || 1,
      status: confirmada ? "confirmada" : "pendente",
    });
    avisar(confirmada ? "Venda registrada e confirmada." : "Venda registrada. Ela fica aguardando a confirmação do pagamento.");
    aoSalvar(v);
  });
  return (
    <form onSubmit={envio.enviar} aria-label="Registrar venda">
      {contato ? (
        <p>
          Venda para <strong>{contato.nome}</strong>
        </p>
      ) : (
        <EscolherContato rotulo="Contato" nome="venda-contato" aoEscolher={setContato} />
      )}
      <div className="grade-campos">
        <Escolha rotulo={termos.Oferta} nome="venda-oferta" valor={ofertaId} aoMudar={setOfertaId} vazio="Escolha" obrigatorio opcoes={ofertas.map((o) => ({ valor: o.id, texto: o.nome }))} />
        {entregas.length > 0 && (
          <Escolha
            rotulo={`${termos.Entrega} (opcional)`}
            nome="venda-entrega"
            valor={entregaId}
            aoMudar={setEntregaId}
            vazio="Sem vaga reservada"
            opcoes={entregas.map((e) => ({ valor: e.id, texto: `${e.nome}${e.capacidade ? ` (${e.ocupadas}/${e.capacidade})` : ""}` }))}
          />
        )}
        <Campo rotulo="Valor (R$)" nome="venda-valor" valor={valor} aoMudar={setValor} obrigatorio />
        <Escolha rotulo="Pagamento" nome="venda-forma" valor={forma} aoMudar={setForma} opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f, texto: NOMES_FORMAS_PAGAMENTO[f] }))} />
        <Campo rotulo="Parcelas" nome="venda-parcelas" tipo="number" valor={parcelas} aoMudar={setParcelas} />
      </div>
      {confere && (
        <label className="marcar">
          <input type="checkbox" checked={confirmada} onChange={(e) => setConfirmada(e.target.checked)} />
          Pagamento já confirmado
        </label>
      )}
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        {envio.enviando ? "Salvando…" : "Registrar venda"}
      </button>
    </form>
  );
}

function AcoesVenda({ v, aoMudar }: { v: VendaDto; aoMudar(): void }) {
  const confere = useConfereVendas();
  const eu = useEu();
  const avisar = useAviso();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const mudar = async (corpo: object, aviso: string) => {
    try {
      await patch(`/vendas/${v.id}`, corpo);
      avisar(aviso);
      setCancelando(false);
      aoMudar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    }
  };
  if (v.status === "cancelada" || v.fechada) return null;
  const podeCancelar = confere || (v.vendedorId === eu.usuario.id && v.status === "pendente");
  return (
    <div className="item-acoes">
      {confere && v.status === "pendente" && (
        <button type="button" className="botao" onClick={() => void mudar({ status: "confirmada" }, "Pagamento confirmado.")}>
          Confirmar pagamento
        </button>
      )}
      {podeCancelar && !cancelando && (
        <button type="button" className="botao botao-secundario" onClick={() => setCancelando(true)}>
          Cancelar venda
        </button>
      )}
      {cancelando && (
        <form className="form-linha" onSubmit={(e) => (e.preventDefault(), void mudar({ status: "cancelada", motivoCancelamento: motivo }, "Venda cancelada."))}>
          <Campo rotulo="Motivo do cancelamento" nome={`cancelar-${v.id}`} valor={motivo} aoMudar={setMotivo} obrigatorio />
          <button type="submit" className="botao botao-perigo">
            Cancelar venda
          </button>
        </form>
      )}
    </div>
  );
}

export function LinhaVenda({ v, mostrarContato = true, aoMudar }: { v: VendaDto; mostrarContato?: boolean; aoMudar(): void }) {
  const confere = useConfereVendas();
  return (
    <li className="item">
      <div className="item-principal">
        <strong>
          {formatarDinheiro(v.valorCentavos)} · {v.ofertaNome}
          {v.entregaNome && ` (${v.entregaNome})`}
        </strong>
        <span className="item-detalhe">
          {mostrarContato && (
            <>
              <Link to={`/contatos/${v.contatoId}`}>{v.contatoNome}</Link> ·{" "}
            </>
          )}
          {v.vendedorNome} · {v.dataVenda.split("-").reverse().join("/")} · {NOMES_FORMAS_PAGAMENTO[v.formaPagamento]}
          {v.parcelas > 1 && ` em ${v.parcelas}x`}
        </span>
        <span className="item-detalhe">
          <span className={`selo ${SELO[v.status] ?? ""}`}>{NOMES_STATUS_VENDA[v.status]}</span>
          {v.fechada && <span className="selo">Mês fechado</span>}
          {v.motivoCancelamento && ` Motivo: ${v.motivoCancelamento}`}
        </span>
      </div>
      <CobrancasDaVenda v={v} confere={confere} aoMudar={aoMudar} />
      <AcoesVenda v={v} aoMudar={aoMudar} />
    </li>
  );
}

/** Vendas do contato, na ficha. */
export function VendasDoContato({ contato }: { contato: { id: string; nome: string } }) {
  const { pode } = useSessao();
  const [nova, setNova] = useState(false);
  const lista = usePaginado<VendaDto>(`/vendas${query({ contatoId: contato.id, limite: 10 })}`);
  useTempoReal(["venda."], () => void lista.recarregar());
  if (!pode("vendas", "ver")) return null;
  return (
    <section className="cartao" aria-labelledby="titulo-vendas-contato">
      <h2 id="titulo-vendas-contato" className="titulo-secao">
        Vendas
        {pode("vendas", "criar") && (
          <button type="button" className="botao botao-secundario" onClick={() => setNova(true)}>
            Registrar venda
          </button>
        )}
      </h2>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma venda ainda.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((v) => (
          <LinhaVenda key={v.id} v={v} mostrarContato={false} aoMudar={() => void lista.recarregar()} />
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      {nova && (
        <Modal aberto titulo="Registrar venda" aoFechar={() => setNova(false)}>
          <FormVenda contato={contato} aoSalvar={() => (setNova(false), void lista.recarregar())} />
          <div className="modal-acoes">
            <button type="button" className="botao botao-secundario" onClick={() => setNova(false)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

const CHAVES_VENDAS = ["inicio", "fim", "vendedorId", "ofertaId", "status"] as const;
const STATUS_LISTA: Record<string, string> = { confirmada: "Confirmadas", pendente: "Aguardando pagamento", cancelada: "Canceladas" };

export function Vendas() {
  const termos = useVocabulario();
  const { pode } = useSessao();
  const fuso = useFuso();
  const hoje = hojeNoFuso(fuso);
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const { valores: f, mudar } = useFiltrosUrl(CHAVES_VENDAS, { inicio: inicioMes, fim: hoje });
  const intervalo = { inicio: f.inicio ?? inicioMes, fim: f.fim ?? hoje };
  const status = f.status && STATUS_LISTA[f.status] ? f.status : undefined;
  const [nova, setNova] = useState(false);
  const [painel, setPainel] = useState<PainelVendasDto | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const filtro = query({ inicio: intervalo.inicio, fim: intervalo.fim, vendedorId: f.vendedorId, ofertaId: f.ofertaId });
  const carregar = () => {
    setCarregando(true);
    return get<PainelVendasDto>(`/vendas/painel${filtro}`)
      .then((p) => (setPainel(p), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o painel."))
      .finally(() => setCarregando(false));
  };
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);
  const lista = usePaginado<VendaDto>(`/vendas${query({ inicio: intervalo.inicio, fim: intervalo.fim, vendedorId: f.vendedorId, ofertaId: f.ofertaId, status, limite: 30 })}`);
  useTempoReal(["venda."], () => (void carregar(), void lista.recarregar()));

  const t = painel?.totais;
  const a = painel?.totaisAnteriores;
  const nomeOferta = painel?.ofertas.find((o) => o.ofertaId === f.ofertaId)?.nome ?? termos.t("{Oferta}");
  const nomeVendedor = painel?.vendedores.find((v) => v.usuarioId === f.vendedorId)?.nome ?? termos.t("{Colaborador}");
  const periodoPadrao = intervalo.inicio === inicioMes && intervalo.fim === hoje;
  const etiquetas: Etiqueta[] = [
    { chave: "periodo", texto: nomeDoIntervalo(intervalo, hoje), aoTirar: periodoPadrao ? undefined : () => mudar({ inicio: undefined, fim: undefined }) },
    ...(f.ofertaId ? [{ chave: "oferta", texto: nomeOferta, aoTirar: () => mudar({ ofertaId: undefined }) }] : []),
    ...(f.vendedorId ? [{ chave: "vendedor", texto: nomeVendedor, aoTirar: () => mudar({ vendedorId: undefined }) }] : []),
    ...(status ? [{ chave: "status", texto: STATUS_LISTA[status], aoTirar: () => mudar({ status: undefined }) }] : []),
  ];
  const alternarStatus = (s: string) => mudar({ status: status === s ? undefined : s });
  const reais = (v: number) => formatarDinheiro(Math.round(v * 100));

  return (
    <>
      <Titulo
        acao={
          pode("vendas", "criar") && (
            <button type="button" className="botao" aria-expanded={nova} onClick={() => setNova(!nova)}>
              {nova ? "Cancelar" : "Registrar venda"}
            </button>
          )
        }
      >
        Vendas
      </Titulo>
      {nova && (
        <section className="cartao">
          <FormVenda aoSalvar={() => (setNova(false), void lista.recarregar(), void carregar())} />
        </section>
      )}
      <section className="cartao filtros-painel" aria-label="Filtros do painel">
        <BarraPeriodo hoje={hoje} valor={intervalo} maxDias={MAX_DIAS_ANALISE} aoMudar={(i) => mudar({ inicio: i.inicio, fim: i.fim })} />
        <EtiquetasFiltro itens={etiquetas} aoLimpar={() => mudar({ inicio: undefined, fim: undefined, vendedorId: undefined, ofertaId: undefined, status: undefined })} />
      </section>
      <Mensagem tipo="erro">{erro}</Mensagem>

      <div className={`painel${carregando ? " atualizando" : ""}`}>
        <section aria-label="Números do período" className="destaques">
          <Destaque rotulo="Valor confirmado" valor={formatarDinheiro(t?.valorCentavos ?? 0)} atual={t?.valorCentavos ?? 0} anterior={a?.valorCentavos ?? 0} selecionado={status === "confirmada"} aoEscolher={() => alternarStatus("confirmada")} />
          <Destaque rotulo="Vendas confirmadas" valor={String(t?.quantidade ?? 0)} atual={t?.quantidade ?? 0} anterior={a?.quantidade ?? 0} selecionado={status === "confirmada"} aoEscolher={() => alternarStatus("confirmada")} />
          <Destaque rotulo="Ticket médio" valor={formatarDinheiro(t?.ticketMedioCentavos ?? 0)} atual={t?.ticketMedioCentavos ?? 0} anterior={a?.ticketMedioCentavos ?? 0} selecionado={false} aoEscolher={() => alternarStatus("confirmada")} />
          <Destaque rotulo="Aguardando pagamento" valor={String(t?.aguardando ?? 0)} atual={t?.aguardando ?? 0} anterior={a?.aguardando ?? 0} selecionado={status === "pendente"} aoEscolher={() => alternarStatus("pendente")} />
          <Destaque rotulo="Canceladas" valor={String(t?.canceladas ?? 0)} atual={t?.canceladas ?? 0} anterior={a?.canceladas ?? 0} selecionado={status === "cancelada"} aoEscolher={() => alternarStatus("cancelada")} menorMelhor />
        </section>
        <p className="dica">Toque num número para ver a lista dele abaixo. O painel conta só as vendas confirmadas.</p>

        <div className="painel-colunas">
          {intervalo.inicio !== intervalo.fim && (
            <section className="cartao" aria-labelledby="titulo-vendas-dia">
              <h2 id="titulo-vendas-dia">Valor confirmado por dia</h2>
              {painel && <BarrasPorDia serie={painel.serie} formatar={reais} rotulo="Valor confirmado" aoEscolher={(dia) => mudar({ inicio: dia, fim: dia })} />}
            </section>
          )}
          <section className="cartao" aria-labelledby="titulo-vendas-ofertas">
            <h2 id="titulo-vendas-ofertas">{termos.t("Por {oferta}")}</h2>
            {painel && (
              <Ranking
                itens={painel.ofertas.map((o) => ({ id: o.ofertaId, rotulo: o.nome, valor: o.valorCentavos, texto: `${formatarDinheiro(o.valorCentavos)} · ${o.quantidade}` }))}
                selecionado={f.ofertaId}
                aoEscolher={(id) => mudar({ ofertaId: id === f.ofertaId ? undefined : id })}
                vazio="Nenhuma venda confirmada no período."
              />
            )}
          </section>
        </div>
        {(painel?.vendedores.length ?? 0) > 1 || f.vendedorId ? (
          <section className="cartao" aria-labelledby="titulo-vendas-vendedores">
            <h2 id="titulo-vendas-vendedores">{termos.t("Por {colaborador}")}</h2>
            {painel && (
              <Ranking
                itens={painel.vendedores.map((v) => ({ id: v.usuarioId, rotulo: v.nome, valor: v.valorCentavos, texto: `${formatarDinheiro(v.valorCentavos)} · ${v.quantidade}` }))}
                selecionado={f.vendedorId}
                aoEscolher={(id) => mudar({ vendedorId: id === f.vendedorId ? undefined : id })}
                vazio="Nenhuma venda confirmada no período."
              />
            )}
          </section>
        ) : null}

        <section className="cartao" aria-labelledby="titulo-lista-vendas">
          <h2 id="titulo-lista-vendas">
            {status ? STATUS_LISTA[status] : "Todas as vendas"}{" "}
            <span className="item-detalhe">
              · {intervalo.inicio === intervalo.fim ? diaCurto(intervalo.inicio, true) : `${diaCurto(intervalo.inicio)} a ${diaCurto(intervalo.fim, true)}`}
            </span>
          </h2>
          <Mensagem tipo="erro">{lista.erro}</Mensagem>
          {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma venda com esses filtros.</ListaVazia>}
          <ul className="lista">
            {lista.itens.map((v) => (
              <LinhaVenda key={v.id} v={v} aoMudar={() => (void lista.recarregar(), void carregar())} />
            ))}
          </ul>
          <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
        </section>
      </div>
      {pode("vendas", "administrar") && <ContaCobranca />}
    </>
  );
}
