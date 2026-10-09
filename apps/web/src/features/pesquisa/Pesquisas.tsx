// Pesquisas: criar com perguntas, copiar o link público, encerrar e ver os resultados agregados.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { NOMES_TIPOS_PERGUNTA, TIPOS_PERGUNTA, type PesquisaDto, type ResultadoPesquisaDto } from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { BotaoAlternar, CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";

interface Rascunho {
  tipo: string;
  texto: string;
  opcoes: string;
  obrigatoria: boolean;
}
const nova = (): Rascunho => ({ tipo: "escolha", texto: "", opcoes: "", obrigatoria: false });

export const linkPublico = (token: string) => `${window.location.origin}/p/${token}`;

function NovaPesquisa({ aoCriar }: { aoCriar(): void }) {
  const avisar = useAviso();
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [perguntas, setPerguntas] = useState<Rascunho[]>([nova()]);
  const mudar = (i: number, campo: keyof Rascunho, valor: string | boolean) => setPerguntas(perguntas.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));
  const envio = useEnvio(async () => {
    await post("/pesquisas", {
      titulo,
      descricao: descricao || null,
      perguntas: perguntas.map((p, i) => ({
        id: `p${i + 1}`,
        tipo: p.tipo,
        texto: p.texto,
        obrigatoria: p.obrigatoria,
        ...(p.tipo === "escolha" ? { opcoes: p.opcoes.split("\n").map((o) => o.trim()).filter(Boolean) } : {}),
      })),
    });
    avisar("Pesquisa criada. Copie o link e envie para os clientes.");
    aoCriar();
  });
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-label="Nova pesquisa">
      <Campo rotulo="Título" nome="pesquisa-titulo" valor={titulo} aoMudar={setTitulo} obrigatorio />
      <Campo rotulo="Texto de abertura (opcional)" nome="pesquisa-descricao" valor={descricao} aoMudar={setDescricao} />
      {perguntas.map((p, i) => (
        <fieldset key={i} className="pergunta-edicao">
          <legend>Pergunta {i + 1}</legend>
          <Campo rotulo="Pergunta" nome={`pergunta-texto-${i}`} valor={p.texto} aoMudar={(v) => mudar(i, "texto", v)} obrigatorio />
          <Escolha rotulo="Tipo de resposta" nome={`pergunta-tipo-${i}`} valor={p.tipo} aoMudar={(v) => mudar(i, "tipo", v)} opcoes={TIPOS_PERGUNTA.map((t) => ({ valor: t, texto: NOMES_TIPOS_PERGUNTA[t] }))} />
          {p.tipo === "escolha" && (
            <div className="campo">
              <label htmlFor={`pergunta-opcoes-${i}`}>Opções (uma por linha)</label>
              <textarea id={`pergunta-opcoes-${i}`} rows={3} required value={p.opcoes} onChange={(e) => mudar(i, "opcoes", e.target.value)} />
            </div>
          )}
          <label className="marcar">
            <input type="checkbox" checked={p.obrigatoria} onChange={(e) => mudar(i, "obrigatoria", e.target.checked)} />
            Obrigatória
          </label>
          {perguntas.length > 1 && (
            <button type="button" className="link-secundario" onClick={() => setPerguntas(perguntas.filter((_, j) => j !== i))}>
              Remover pergunta
            </button>
          )}
        </fieldset>
      ))}
      <button type="button" className="link-secundario" onClick={() => setPerguntas([...perguntas, nova()])}>
        Adicionar pergunta
      </button>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Criar pesquisa
      </button>
    </form>
  );
}

export function Pesquisas() {
  const { pode } = useSessao();
  const avisar = useAviso();
  const [criando, setCriando] = useState(false);
  const lista = usePaginado<PesquisaDto>("/pesquisas?limite=30");
  useTempoReal(["pesquisa."], () => void lista.recarregar());
  const copiar = async (p: PesquisaDto) => {
    try {
      await navigator.clipboard.writeText(linkPublico(p.token));
      avisar("Link copiado.");
    } catch {
      avisar(`Copie o link: ${linkPublico(p.token)}`);
    }
  };
  return (
    <>
      <Titulo acao={pode("pesquisa", "criar") && <BotaoAlternar aberto={criando} aoMudar={setCriando} texto="Nova pesquisa" />}>Pesquisas</Titulo>
      {criando && <NovaPesquisa aoCriar={() => (setCriando(false), void lista.recarregar())} />}
      <section className="cartao">
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma pesquisa ainda.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((p) => (
            <li key={p.id} className="item">
              <div className="item-principal">
                <Link to={`/pesquisas/${p.id}`} className="item-link">
                  <strong>{p.titulo}</strong>
                </Link>
                <span className="item-detalhe">
                  {p.respostas} resposta(s) · {p.aberta ? "recebendo respostas" : "encerrada"}
                </span>
              </div>
              <div className="item-acoes">
                <button type="button" className="botao botao-secundario" onClick={() => void copiar(p)}>
                  Copiar link
                </button>
              </div>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}

export function ResultadoPesquisa() {
  const { id = "" } = useParams();
  const { pode } = useSessao();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const [p, setP] = useState<PesquisaDto | null>(null);
  const [r, setR] = useState<ResultadoPesquisaDto | null>(null);
  const [erro, setErro] = useState("");
  const carregar = () => {
    get<PesquisaDto>(`/pesquisas/${id}`).then(setP, (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir."));
    get<ResultadoPesquisaDto>(`/pesquisas/${id}/resultados`).then(setR, () => undefined);
  };
  useEffect(carregar, [id]);
  useTempoReal(["pesquisa."], (a) => (a.entidadeId === id ? carregar() : undefined));
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!p || !r) return <p className="carregando">Carregando…</p>;
  const alternar = async () => {
    try {
      await patch(`/pesquisas/${id}`, { aberta: !p.aberta });
      avisar(p.aberta ? "Pesquisa encerrada: o link não recebe mais respostas." : "Pesquisa reaberta.");
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    }
  };
  return (
    <>
      <p className="trilha">
        <Link to="/pesquisas">Pesquisas</Link>
      </p>
      <Titulo>{p.titulo}</Titulo>
      <section className="cartao">
        <p>
          <strong>{r.total}</strong> resposta(s) · criada em {dataHora(p.criadoEm)}
        </p>
        <p className="copiar">
          Link público: <code>{linkPublico(p.token)}</code>
        </p>
        {pode("pesquisa", "editar") && (
          <button type="button" className="botao botao-secundario" onClick={() => void alternar()}>
            {p.aberta ? "Encerrar pesquisa" : "Reabrir pesquisa"}
          </button>
        )}
      </section>
      {r.perguntas.map((q) => (
        <section key={q.id} className="cartao" aria-label={q.texto}>
          <h2>{q.texto}</h2>
          <p className="item-detalhe">{q.respondidas} resposta(s)</p>
          {q.opcoes && (
            <ul className="lista-simples resultado-opcoes">
              {q.opcoes.map((o) => {
                const pctOpcao = q.respondidas ? Math.round((o.total / q.respondidas) * 100) : 0;
                return (
                  <li key={o.opcao}>
                    <div className="meta-topo">
                      <span>{o.opcao}</span>
                      <strong>
                        {o.total} ({pctOpcao}%)
                      </strong>
                    </div>
                    <progress max={100} value={pctOpcao} aria-label={`${o.opcao}: ${pctOpcao}%`} />
                  </li>
                );
              })}
            </ul>
          )}
          {q.media !== undefined && <p>Média: {q.media === null ? "—" : q.media.toLocaleString("pt-BR")}</p>}
          {q.ultimas && (q.ultimas.length ? <ul className="lista-simples">{q.ultimas.map((t, i) => <li key={i} className="texto-livre">{t}</li>)}</ul> : <ListaVazia>Sem respostas escritas.</ListaVazia>)}
        </section>
      ))}
    </>
  );
}
