// Quadro kanban do funil: arrastar no computador, "Mover para…" no celular. Etapas com campos obrigatórios
// pedem os dados antes de mover; etapa de perda pede o motivo. Quem decide é sempre o servidor.
import { useCallback, useEffect, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { EtapaDto, KanbanDto, OportunidadeDto } from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { BotaoLigar } from "../telefonia/Telefone";
import { CamposPersonalizados, centavosParaTexto, formatarDinheiro, lerDinheiro, useConfigCrm, useTermos, type ValoresCampos } from "./comum";

type Config = ReturnType<typeof useConfigCrm>["config"];

interface PedidoMover {
  o: OportunidadeDto;
  destino: EtapaDto;
}

/** Pede o que a etapa de destino exige (motivo de perda, valor, oferta, campos) e move. */
function ModalMover({ pedido, config, aoFechar, aoMover }: { pedido: PedidoMover; config: Config; aoFechar(): void; aoMover(): void }) {
  const { o, destino } = pedido;
  const exigidos = destino.camposObrigatorios;
  const [motivoPerdaId, setMotivoPerdaId] = useState("");
  const [valor, setValor] = useState(centavosParaTexto(o.valorCentavos));
  const [oferta, setOferta] = useState(o.oferta ?? "");
  const [campos, setCampos] = useState<ValoresCampos>(o.campos as ValoresCampos);
  const definicoes = config.campos.filter((d) => d.entidade === "oportunidade" && exigidos.includes(d.chave));
  const { enviando, erro, enviar } = useEnvio(async () => {
    const alteracoes: Record<string, unknown> = {};
    if (exigidos.includes("valor")) {
      const centavos = lerDinheiro(valor);
      if (centavos === undefined) throw new ErroApi(400, "DADOS_INVALIDOS", "Valor inválido. Use números, por exemplo 1.500,00.");
      alteracoes.valorCentavos = centavos;
    }
    if (exigidos.includes("oferta")) alteracoes.oferta = oferta || null;
    if (definicoes.length) alteracoes.campos = { ...(o.campos as ValoresCampos), ...campos };
    if (Object.keys(alteracoes).length) await patch(`/oportunidades/${o.id}`, alteracoes);
    await post(`/oportunidades/${o.id}/etapa`, { etapaId: destino.id, motivoPerdaId: motivoPerdaId || null });
    aoMover();
  });

  return (
    <Modal aberto titulo={`Mover para “${destino.nome}”`} aoFechar={aoFechar}>
      <form onSubmit={enviar}>
        <p>{o.titulo}</p>
        {destino.tipo === "perdida" && (
          <Escolha rotulo="Motivo da perda" nome="mover-motivo" valor={motivoPerdaId} aoMudar={setMotivoPerdaId} opcoes={config.motivosPerda.map((m) => ({ valor: m.id, texto: m.nome }))} vazio="Escolha…" obrigatorio />
        )}
        {exigidos.includes("valor") && <Campo rotulo="Valor (R$) *" nome="mover-valor" valor={valor} aoMudar={setValor} obrigatorio />}
        {exigidos.includes("oferta") && <Campo rotulo="Oferta *" nome="mover-oferta" valor={oferta} aoMudar={setOferta} obrigatorio />}
        <CamposPersonalizados definicoes={definicoes.map((d) => ({ ...d, obrigatorio: true }))} valores={campos} aoMudar={setCampos} prefixo="mover" />
        <Mensagem tipo="erro">{erro}</Mensagem>
        <div className="modal-acoes">
          <button type="button" className="botao botao-secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao" disabled={enviando}>
            {enviando ? "Movendo…" : "Mover"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Cartao({ o, etapas, podeMover, aoPedirMover }: { o: OportunidadeDto; etapas: EtapaDto[]; podeMover: boolean; aoPedirMover(destino: EtapaDto): void }) {
  const arrastar = (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", o.id);
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <li className={`cartao-kanban ${o.status !== "aberta" ? `cartao-${o.status}` : ""}`} draggable={podeMover} onDragStart={arrastar}>
      <Link to={`/contatos/${o.contatoId}`} className="item-link">
        <strong>{o.titulo}</strong>
      </Link>
      <span className="item-detalhe">{o.contatoNome}</span>
      {o.valorCentavos !== null && <span className="valor">{formatarDinheiro(o.valorCentavos)}</span>}
      {o.responsavelNome && <span className="item-detalhe">{o.responsavelNome}</span>}
      <BotaoLigar alvo={{ contatoId: o.contatoId, oportunidadeId: o.id, nome: o.contatoNome }} rotulo="Ligar" classe="botao botao-secundario botao-pequeno" />
      {podeMover && (
        <label className="mover-para">
          <span className="sr-only">Mover {o.titulo} para</span>
          <select
            value=""
            onChange={(e) => {
              const destino = etapas.find((x) => x.id === e.target.value);
              if (destino) aoPedirMover(destino);
            }}
          >
            <option value="">Mover para…</option>
            {etapas
              .filter((x) => x.id !== o.etapaId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
          </select>
        </label>
      )}
    </li>
  );
}

export function Funil() {
  const { pode } = useSessao();
  const termos = useTermos();
  const avisar = useAviso();
  const { config, carregada } = useConfigCrm();
  const [parametros, setParametros] = useSearchParams();
  const funilId = parametros.get("funil") || config.funis[0]?.id || "";
  const [responsavelId, setResponsavelId] = useState("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [quadro, setQuadro] = useState<KanbanDto | null>(null);
  const [erro, setErro] = useState("");
  const [pedido, setPedido] = useState<PedidoMover | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!funilId) return;
    get<KanbanDto>(`/funis/${funilId}/kanban${query({ responsavelId, busca: buscaAplicada })}`)
      .then((q) => (setQuadro(q), setErro("")))
      .catch((e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o funil."));
  }, [funilId, responsavelId, buscaAplicada]);
  useEffect(carregar, [carregar]);
  useTempoReal(["oportunidade."], carregar);

  const etapas = quadro?.funil.etapas ?? [];
  const todas = quadro?.colunas.flatMap((c) => c.itens) ?? [];

  /** Move direto quando a etapa não exige nada; senão abre o formulário do que falta. */
  const pedirMover = async (o: OportunidadeDto, destino: EtapaDto) => {
    if (o.etapaId === destino.id) return;
    if (destino.tipo === "perdida" || destino.camposObrigatorios.length) {
      setPedido({ o, destino });
      return;
    }
    try {
      await post(`/oportunidades/${o.id}/etapa`, { etapaId: destino.id });
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível mover.", "erro");
    }
  };

  const soltar = (e: DragEvent, destino: EtapaDto) => {
    e.preventDefault();
    setSobre(null);
    const o = todas.find((x) => x.id === e.dataTransfer.getData("text/plain"));
    if (o) void pedirMover(o, destino);
  };

  if (carregada && !config.funis.length) {
    return (
      <>
        <Titulo>Funil</Titulo>
        <ListaVazia>Nenhum funil ativo. {pode("crm", "administrar") ? <Link to="/crm/configuracoes">Crie um funil nas configurações.</Link> : "Peça ao administrador para criar um."}</ListaVazia>
      </>
    );
  }

  const podeMover = pode("crm", "editar");
  return (
    <>
      <Titulo>Funil</Titulo>
      <form className="filtros" role="search" onSubmit={(e) => (e.preventDefault(), setBuscaAplicada(busca))}>
        {config.funis.length > 1 && (
          <Escolha rotulo="Funil" nome="funil" valor={funilId} aoMudar={(v) => setParametros({ funil: v })} opcoes={config.funis.map((f) => ({ valor: f.id, texto: f.nome }))} />
        )}
        {config.responsaveis.length > 1 && (
          <Escolha rotulo="Responsável" nome="kanban-responsavel" valor={responsavelId} aoMudar={setResponsavelId} opcoes={config.responsaveis.map((r) => ({ valor: r.id, texto: r.nome }))} vazio="Todos" />
        )}
        <Campo rotulo={`Buscar ${termos.contato} ou título`} nome="kanban-busca" tipo="search" valor={busca} aoMudar={setBusca} />
      </form>
      <Mensagem tipo="erro">{erro}</Mensagem>
      {quadro && !todas.length && <ListaVazia>Nenhuma oportunidade aqui. Crie uma pela ficha do {termos.contato}.</ListaVazia>}
      <div className="kanban" aria-label="Etapas do funil">
        {quadro?.colunas.map((col) => {
          const et = etapas.find((x) => x.id === col.etapaId);
          if (!et) return null;
          return (
            <section
              key={col.etapaId}
              className={`coluna-kanban ${sobre === et.id ? "coluna-sobre" : ""}`}
              aria-labelledby={`coluna-${et.id}`}
              onDragOver={(e) => (podeMover ? (e.preventDefault(), setSobre(et.id)) : undefined)}
              onDragLeave={() => setSobre(null)}
              onDrop={(e) => soltar(e, et)}
            >
              <header className="coluna-topo">
                <span className="ponto-cor" style={{ background: et.cor }} aria-hidden="true" />
                <h2 id={`coluna-${et.id}`}>{et.nome}</h2>
                <span className="coluna-total">
                  {col.total}
                  {col.valorCentavos > 0 && ` · ${formatarDinheiro(col.valorCentavos)}`}
                </span>
              </header>
              <ul className="lista-kanban">
                {col.itens.map((o) => (
                  <Cartao key={o.id} o={o} etapas={etapas} podeMover={podeMover} aoPedirMover={(d) => void pedirMover(o, d)} />
                ))}
              </ul>
              {col.total > col.itens.length && <p className="item-detalhe">Mostrando {col.itens.length} de {col.total}. Use a busca para achar os demais.</p>}
            </section>
          );
        })}
      </div>
      {pedido && (
        <ModalMover
          pedido={pedido}
          config={config}
          aoFechar={() => setPedido(null)}
          aoMover={() => {
            setPedido(null);
            avisar(`Movida para “${pedido.destino.nome}”.`);
            carregar();
          }}
        />
      )}
    </>
  );
}
