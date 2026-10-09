// Vendas: registro (contato × oferta × vendedor, com vaga na entrega), confirmação pelo financeiro e cancelamento.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FORMAS_PAGAMENTO,
  NOMES_FORMAS_PAGAMENTO,
  NOMES_STATUS_VENDA,
  type EntregaDto,
  type OfertaDto,
  type Pagina,
  type VendaDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";
import { mesAtual, nomeDoMes, somarMeses, useFuso } from "../operacao/comum";
import { EscolherContato, paraCentavos, paraReais, useTermosReceita } from "./comum";

const SELO: Record<string, string> = { confirmada: "selo-ganha", cancelada: "selo-perdida" };

/** Quem confere pagamento (escopo além do próprio) confirma e cancela qualquer venda que vê. */
export function useConfereVendas(): boolean {
  const eu = useEu();
  const e = eu.permissoes.vendas?.editar;
  return Boolean(e && e !== "proprio");
}

export function FormVenda({ contato, aoSalvar }: { contato?: { id: string; nome: string }; aoSalvar(v: VendaDto): void }) {
  const termos = useTermosReceita();
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
    if (!contatoEscolhido) throw new ErroApi(400, "DADOS_INVALIDOS", "Escolha o contato da venda.");
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

export function Vendas() {
  const { pode } = useSessao();
  const fuso = useFuso();
  const [mes, setMes] = useState(() => mesAtual(fuso));
  const [status, setStatus] = useState("");
  const [nova, setNova] = useState(false);
  const lista = usePaginado<VendaDto>(`/vendas${query({ mes, status: status || undefined, limite: 30 })}`);
  useTempoReal(["venda."], () => void lista.recarregar());
  const total = lista.itens.filter((v) => v.status === "confirmada").reduce((t, v) => t + v.valorCentavos, 0);
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
          <FormVenda aoSalvar={() => (setNova(false), void lista.recarregar())} />
        </section>
      )}
      <section className="cartao">
        <div className="navegar-periodo">
          <button type="button" className="botao botao-secundario" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>
            ←
          </button>
          <strong>{nomeDoMes(mes)}</strong>
          <button type="button" className="botao botao-secundario" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>
            →
          </button>
        </div>
        <div className="filtros">
          <Escolha
            rotulo="Situação"
            nome="vendas-status"
            valor={status}
            aoMudar={setStatus}
            vazio="Todas"
            opcoes={Object.entries(NOMES_STATUS_VENDA).map(([valor, texto]) => ({ valor, texto }))}
          />
        </div>
        <p className="numeros-venda">
          Confirmadas nesta lista: <strong>{formatarDinheiro(total)}</strong>
        </p>
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma venda neste mês.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((v) => (
            <LinhaVenda key={v.id} v={v} aoMudar={() => void lista.recarregar()} />
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
