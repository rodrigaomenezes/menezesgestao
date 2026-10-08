// Caixa de entrada: lista (minhas, sem dono, todas) + conversa aberta. No celular, uma coisa de cada vez.
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ConversaDto } from "@mg/shared";
import { query } from "../../app/api";
import { useDataHora } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Campo, CarregarMais, ListaVazia, Mensagem, usePaginado } from "../../ui/ui";
import { formatarTelefone } from "../crm/comum";
import { Chat } from "./Chat";

const CAIXAS = [
  { id: "minhas", texto: "Minhas" },
  { id: "nao_atribuidas", texto: "Sem dono" },
  { id: "todas", texto: "Todas" },
] as const;

function horaCurta(iso: string | null, dataHora: (i: string) => string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return dataHora(iso).split(",")[0] ?? "";
}

export function Conversas() {
  const { id } = useParams();
  const dataHora = useDataHora();
  const [caixa, setCaixa] = useState<(typeof CAIXAS)[number]["id"]>("todas");
  const [resolvidas, setResolvidas] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const lista = usePaginado<ConversaDto>(`/conversas${query({ caixa, status: resolvidas ? "resolvida" : "abertas", busca: buscaAplicada })}`);
  const recarregar = lista.recarregar;
  const atualizarLista = useCallback(() => void recarregar(), [recarregar]);
  useTempoReal(["mensagem.recebida", "mensagem.criada", "conversa."], atualizarLista);

  return (
    <div className={`caixa ${id ? "caixa-com-conversa" : ""}`}>
      <section className="caixa-lista" aria-label="Conversas">
        <div className="titulo-pagina">
          <h1>Conversas</h1>
        </div>
        <div className="abas" role="tablist" aria-label="Caixa">
          {CAIXAS.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={caixa === c.id} className={caixa === c.id ? "ativa" : ""} onClick={() => setCaixa(c.id)}>
              {c.texto}
            </button>
          ))}
        </div>
        <form className="filtros" role="search" onSubmit={(e) => (e.preventDefault(), setBuscaAplicada(busca))}>
          <Campo rotulo="Buscar por nome ou telefone" nome="busca-conversa" tipo="search" valor={busca} aoMudar={setBusca} />
        </form>
        <label className="marcar">
          <input type="checkbox" checked={resolvidas} onChange={(e) => setResolvidas(e.target.checked)} />
          Ver resolvidas
        </label>
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && (
          <ListaVazia>{caixa === "minhas" ? "Nenhuma conversa com você agora." : "Nenhuma conversa por aqui."}</ListaVazia>
        )}
        <ul className="lista lista-conversas">
          {lista.itens.map((c) => (
            <li key={c.id} className={`item-conversa ${c.id === id ? "selecionada" : ""}`}>
              <Link to={`/conversas/${c.id}`} className="item-link" aria-current={c.id === id ? "page" : undefined}>
                <span className="conversa-linha">
                  <strong>{c.contatoNome ?? formatarTelefone(c.telefone)}</strong>
                  <span className="item-detalhe">{horaCurta(c.ultimaMensagemEm, dataHora)}</span>
                </span>
                <span className="conversa-linha">
                  <span className="item-detalhe conversa-previa">{c.ultimaMensagem ?? "Sem mensagens"}</span>
                  {c.naoLidas > 0 && (
                    <span className="contador" aria-label={`${c.naoLidas} não lida(s)`}>
                      {c.naoLidas}
                    </span>
                  )}
                </span>
                <span className="item-detalhe">
                  {c.atribuidaNome ?? "Sem dono"} · {c.canalNome}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
      <div className="caixa-chat">
        {id ? <Chat id={id} aoMudarLista={atualizarLista} /> : <ListaVazia>Escolha uma conversa para ver as mensagens.</ListaVazia>}
      </div>
    </div>
  );
}
