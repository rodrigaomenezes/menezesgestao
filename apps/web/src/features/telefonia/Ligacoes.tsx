// Ligações (minhas ou da equipe, conforme o perfil), com resultado e gravação (link temporário, acesso registrado).
import { useState } from "react";
import { Link } from "react-router-dom";
import { NOMES_ESTADOS_LIGACAO, NOMES_PROVEDORES_TELEFONE, formatarTelefone, type LigacaoDto } from "@mg/shared";
import { ErroApi, post } from "../../app/api";
import { useDataHora } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, ListaVazia, Mensagem, Titulo, usePaginado } from "../../ui/ui";
import { EscolhaProvedor } from "./Telefone";

const duracao = (s: number | null) => (s === null ? "" : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, "0")}s`);

function Gravacao({ l }: { l: LigacaoDto }) {
  const [url, setUrl] = useState<string | null>(null);
  const avisar = useAviso();
  if (!l.temGravacao) return null;
  if (url) return <audio className="gravacao" controls autoPlay src={url} />;
  return (
    <button
      type="button"
      className="botao botao-secundario"
      onClick={async () => {
        try {
          setUrl((await post<{ url: string }>(`/ligacoes/${l.id}/gravacao/acesso`)).url);
        } catch (e) {
          avisar(e instanceof ErroApi ? e.message : "Não foi possível abrir a gravação.", "erro");
        }
      }}
    >
      Ouvir gravação
    </button>
  );
}

export function Ligacoes() {
  const dataHora = useDataHora();
  const lista = usePaginado<LigacaoDto>("/ligacoes?limite=30");
  useTempoReal(["ligacao."], () => void lista.recarregar());
  return (
    <>
      <Titulo>Ligações</Titulo>
      <section className="cartao">
        <EscolhaProvedor />
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma ligação ainda. Ligue pela ficha do contato, pelo funil ou pela fila.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((l) => (
            <li key={l.id} className="item">
              <div className="item-principal">
                <strong>{l.contatoId ? <Link to={`/contatos/${l.contatoId}`}>{l.contatoNome}</Link> : formatarTelefone(l.numero)}</strong>
                <span className="item-detalhe">
                  {formatarTelefone(l.numero)} · {dataHora(l.iniciadaEm)} · {l.usuarioNome}
                </span>
                <span className="item-detalhe">
                  {NOMES_PROVEDORES_TELEFONE[l.provedor]} · {l.estado === "encerrada" ? (l.motivoFim ?? "encerrada") : NOMES_ESTADOS_LIGACAO[l.estado]}
                  {l.duracaoSegundos ? ` · ${duracao(l.duracaoSegundos)}` : ""}
                  {l.resultadoNome && ` · ${l.resultadoNome}`}
                </span>
                {l.observacao && <span className="texto-livre item-detalhe">{l.observacao}</span>}
              </div>
              <Gravacao l={l} />
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
