import { useState } from "react";
import { Link } from "react-router-dom";
import { post } from "../api";
import { CarregarMais, ListaVazia, Mensagem, Titulo, formatarDataHora, usePaginado } from "../componentes/ui";
import { useTempoReal } from "../tempo-real";

interface Notificacao {
  id: string;
  titulo: string;
  texto: string | null;
  link: string | null;
  lidaEm: string | null;
  criadoEm: string;
}

export function Notificacoes() {
  const lista = usePaginado<Notificacao>("/notificacoes");
  const [erro, setErro] = useState("");
  useTempoReal(["notificacao."], () => void lista.recarregar());

  async function acao(caminho: string) {
    setErro("");
    try {
      await post(caminho);
      void lista.recarregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <Titulo
        acao={
          <button type="button" className="botao botao-secundario" onClick={() => void acao("/notificacoes/lidas")}>
            Marcar todas como lidas
          </button>
        }
      >
        Notificações
      </Titulo>
      <section className="cartao">
        <Mensagem tipo="erro">{lista.erro || erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Você não tem notificações.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((n) => (
            <li key={n.id} className={`item ${n.lidaEm ? "" : "nao-lida"}`}>
              <div className="item-principal">
                <strong>{n.titulo}</strong>
                {n.texto && <span>{n.texto}</span>}
                <span className="item-detalhe">{formatarDataHora(n.criadoEm)}</span>
                {n.link?.startsWith("/") && <Link to={n.link}>Abrir</Link>}
              </div>
              {!n.lidaEm && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => void acao(`/notificacoes/${n.id}/lida`)}>
                    Marcar como lida
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
