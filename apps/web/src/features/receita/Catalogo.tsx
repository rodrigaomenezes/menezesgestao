// Catálogo: ofertas (curso, procedimento, projeto…) e entregas (turma, agenda…) com vagas e participantes.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { EntregaDto, OfertaDto, Pagina, ParticipanteDto } from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { BotaoAlternar, CarregarMais, Campo, Escolha, FiltroArquivados, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";
import { EscolherContato, paraCentavos, paraReais, useTermosReceita } from "./comum";

function FormOferta({ inicial, aoSalvar, aoCancelar }: { inicial?: OfertaDto; aoSalvar(): void; aoCancelar?(): void }) {
  const termos = useTermosReceita();
  const avisar = useAviso();
  const sufixo = inicial?.id ?? "nova";
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [preco, setPreco] = useState(paraReais(inicial?.precoCentavos));
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const envio = useEnvio(async () => {
    const corpo = { nome, descricao: descricao || null, precoCentavos: preco ? paraCentavos(preco) : null };
    if (inicial) await patch(`/ofertas/${inicial.id}`, corpo);
    else await post("/ofertas", corpo);
    avisar(inicial ? "Alterações salvas." : "Cadastro salvo.");
    if (!inicial) {
      setNome("");
      setPreco("");
      setDescricao("");
    }
    aoSalvar();
  });
  return (
    <form onSubmit={envio.enviar} aria-label={inicial ? `Editar ${termos.oferta}` : `Cadastrar ${termos.oferta}`}>
      <div className="grade-campos">
        <Campo rotulo="Nome" nome={`oferta-nome-${sufixo}`} valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Preço (R$, opcional)" nome={`oferta-preco-${sufixo}`} valor={preco} aoMudar={setPreco} />
        <Campo rotulo="Descrição (opcional)" nome={`oferta-desc-${sufixo}`} valor={descricao} aoMudar={setDescricao} />
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <div className="form-linha">
        <button type="submit" className="botao" disabled={envio.enviando}>
          {inicial ? "Salvar" : "Criar"}
        </button>
        {aoCancelar && (
          <button type="button" className="botao botao-secundario" onClick={aoCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

function NovaEntrega({ ofertas, aoCriar }: { ofertas: OfertaDto[]; aoCriar(): void }) {
  const termos = useTermosReceita();
  const avisar = useAviso();
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  const [ofertaId, setOfertaId] = useState("");
  const [nome, setNome] = useState("");
  const [prestadorId, setPrestadorId] = useState("");
  const [capacidade, setCapacidade] = useState("");
  const [inicio, setInicio] = useState("");
  const [horario, setHorario] = useState("");
  useEffect(() => {
    get<Pagina<{ usuarioId: string; nome: string }>>("/usuarios?limite=100").then((p) => setPessoas(p.itens.map((i) => ({ id: i.usuarioId, nome: i.nome }))), () => undefined);
  }, []);
  const envio = useEnvio(async () => {
    await post("/entregas", { ofertaId, nome, prestadorId: prestadorId || null, capacidade: capacidade ? Number(capacidade) : null, inicio: inicio || null, horario: horario || null });
    avisar("Cadastro salvo.");
    setNome("");
    aoCriar();
  });
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-label={`Cadastrar ${termos.entrega}`}>
      <div className="grade-campos">
        <Escolha rotulo={termos.Oferta} nome="entrega-oferta" valor={ofertaId} aoMudar={setOfertaId} vazio="Escolha" obrigatorio opcoes={ofertas.map((o) => ({ valor: o.id, texto: o.nome }))} />
        <Campo rotulo="Nome" nome="entrega-nome" valor={nome} aoMudar={setNome} obrigatorio />
        {pessoas.length > 0 && <Escolha rotulo={termos.Prestador} nome="entrega-prestador" valor={prestadorId} aoMudar={setPrestadorId} vazio="A definir" opcoes={pessoas.map((p) => ({ valor: p.id, texto: p.nome }))} />}
        <Campo rotulo="Vagas (opcional)" nome="entrega-capacidade" tipo="number" valor={capacidade} aoMudar={setCapacidade} />
        <Campo rotulo="Começa em (opcional)" nome="entrega-inicio" tipo="date" valor={inicio} aoMudar={setInicio} />
        <Campo rotulo="Horário (opcional)" nome="entrega-horario" valor={horario} aoMudar={setHorario} />
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Criar
      </button>
    </form>
  );
}

export function Catalogo() {
  const { pode } = useSessao();
  const termos = useTermosReceita();
  const avisar = useAviso();
  const [arquivados, setArquivados] = useState(false);
  const [nova, setNova] = useState(false);
  const [novaEntrega, setNovaEntrega] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const ofertas = usePaginado<OfertaDto>(`/ofertas${query({ arquivados: arquivados ? "sim" : "nao", limite: 50 })}`);
  const entregas = usePaginado<EntregaDto>("/entregas?limite=30");
  useTempoReal(["oferta.", "entrega."], () => (void ofertas.recarregar(), void entregas.recarregar()));
  const alternar = async (o: OfertaDto) => {
    try {
      await patch(`/ofertas/${o.id}`, { arquivar: !o.arquivadoEm });
      avisar(o.arquivadoEm ? "Restaurado." : "Arquivado. Fica em Arquivados.");
      void ofertas.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    }
  };
  return (
    <>
      <Titulo acao={pode("servicos", "criar") && <BotaoAlternar aberto={nova} aoMudar={setNova} texto={`Cadastrar ${termos.oferta}`} />}>Catálogo</Titulo>
      {nova && (
        <section className="cartao">
          <FormOferta aoSalvar={() => (setNova(false), void ofertas.recarregar())} />
        </section>
      )}
      <section className="cartao" aria-labelledby="titulo-ofertas">
        <h2 id="titulo-ofertas">{termos.Ofertas}</h2>
        <FiltroArquivados valor={arquivados} aoMudar={setArquivados} />
        <Mensagem tipo="erro">{ofertas.erro}</Mensagem>
        {!ofertas.carregando && !ofertas.itens.length && <ListaVazia>Nada cadastrado ainda.</ListaVazia>}
        <ul className="lista">
          {ofertas.itens.map((o) =>
            editando === o.id ? (
              <li key={o.id}>
                <FormOferta inicial={o} aoSalvar={() => (setEditando(null), void ofertas.recarregar())} aoCancelar={() => setEditando(null)} />
              </li>
            ) : (
              <li key={o.id} className="item">
                <div className="item-principal">
                  <strong>{o.nome}</strong>
                  <span className="item-detalhe">
                    {o.precoCentavos != null ? formatarDinheiro(o.precoCentavos) : "Sem preço fixo"}
                    {o.descricao && ` · ${o.descricao}`}
                  </span>
                </div>
                {pode("servicos", "editar") && (
                  <div className="item-acoes">
                    {!o.arquivadoEm && (
                      <button type="button" className="botao botao-secundario" onClick={() => setEditando(o.id)}>
                        Editar
                      </button>
                    )}
                    <button type="button" className="botao botao-secundario" onClick={() => void alternar(o)}>
                      {o.arquivadoEm ? "Restaurar" : "Arquivar"}
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
        <CarregarMais visivel={ofertas.temMais} carregando={ofertas.carregando} aoClicar={() => void ofertas.carregarMais()} />
      </section>

      <section className="cartao" aria-labelledby="titulo-entregas">
        <h2 id="titulo-entregas" className="titulo-secao">
          {termos.Entregas}
          {pode("servicos", "criar") && <BotaoAlternar aberto={novaEntrega} aoMudar={setNovaEntrega} texto={`Cadastrar ${termos.entrega}`} />}
        </h2>
        {novaEntrega && <NovaEntrega ofertas={ofertas.itens.filter((o) => !o.arquivadoEm)} aoCriar={() => (setNovaEntrega(false), void entregas.recarregar())} />}
        {!entregas.carregando && !entregas.itens.length && <ListaVazia>Nada cadastrado ainda.</ListaVazia>}
        <ul className="lista">
          {entregas.itens.map((e) => (
            <li key={e.id} className="item">
              <div className="item-principal">
                <Link to={`/entregas/${e.id}`} className="item-link">
                  <strong>{e.nome}</strong>
                </Link>
                <span className="item-detalhe">
                  {e.ofertaNome} · {e.capacidade ? `${e.ocupadas}/${e.capacidade} vagas` : `${e.ocupadas} participante(s)`}
                  {e.prestadorNome && ` · ${e.prestadorNome}`}
                  {e.horario && ` · ${e.horario}`}
                  {e.status === "encerrada" && " · encerrada"}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={entregas.temMais} carregando={entregas.carregando} aoClicar={() => void entregas.carregarMais()} />
      </section>
    </>
  );
}

export function Entrega() {
  const { id = "" } = useParams();
  const { pode } = useSessao();
  const termos = useTermosReceita();
  const avisar = useAviso();
  const [e, setE] = useState<EntregaDto | null>(null);
  const [erro, setErro] = useState("");
  const [contato, setContato] = useState<{ id: string; nome: string } | null>(null);
  const lista = usePaginado<ParticipanteDto>(`/entregas/${id}/participantes?limite=50`);
  const carregar = () => get<EntregaDto>(`/entregas/${id}`).then(setE, (x) => setErro(x instanceof ErroApi ? x.message : "Não foi possível abrir."));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useTempoReal(["entrega.", "venda."], () => (void carregar(), void lista.recarregar()));
  const agir = async (acao: () => Promise<unknown>, aviso: string) => {
    try {
      await acao();
      avisar(aviso);
      void carregar();
      void lista.recarregar();
    } catch (x) {
      avisar(x instanceof ErroApi ? x.message : "Não foi possível concluir.", "erro");
    }
  };
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!e) return <p className="carregando">Carregando…</p>;
  const ativos = lista.itens.filter((p) => p.status === "ativo");
  return (
    <>
      <p className="trilha">
        <Link to="/catalogo">Catálogo</Link>
      </p>
      <Titulo>{e.nome}</Titulo>
      <section className="cartao">
        <dl className="dados">
          <div>
            <dt>{termos.Oferta}</dt>
            <dd>{e.ofertaNome}</dd>
          </div>
          <div>
            <dt>Vagas</dt>
            <dd>{e.capacidade ? `${e.ocupadas} de ${e.capacidade}` : `${e.ocupadas} (sem limite)`}</dd>
          </div>
          <div>
            <dt>{termos.Prestador}</dt>
            <dd>{e.prestadorNome ?? "A definir"}</dd>
          </div>
          {e.horario && (
            <div>
              <dt>Horário</dt>
              <dd>{e.horario}</dd>
            </div>
          )}
        </dl>
        {pode("servicos", "editar") && (
          <button
            type="button"
            className="botao botao-secundario"
            onClick={() => void agir(() => patch(`/entregas/${e.id}`, { status: e.status === "aberta" ? "encerrada" : "aberta" }), e.status === "aberta" ? "Encerrado." : "Reaberto.")}
          >
            {e.status === "aberta" ? "Encerrar" : "Reabrir"}
          </button>
        )}
      </section>
      <section className="cartao" aria-labelledby="titulo-participantes">
        <h2 id="titulo-participantes">Participantes</h2>
        {pode("servicos", "editar") && e.status === "aberta" && (
          <form className="form-linha" onSubmit={(x) => (x.preventDefault(), contato && void agir(() => post(`/entregas/${e.id}/participantes`, { contatoId: contato.id }), "Incluído."))}>
            <EscolherContato rotulo="Incluir contato" nome="entrega-incluir" aoEscolher={setContato} />
            <button type="submit" className="botao" disabled={!contato}>
              Incluir
            </button>
          </form>
        )}
        {!lista.carregando && !ativos.length && <ListaVazia>Ninguém ainda.</ListaVazia>}
        <ul className="lista">
          {ativos.map((p) => (
            <li key={p.id} className="item">
              <div className="item-principal">
                <Link to={`/contatos/${p.contatoId}`}>{p.contatoNome}</Link>
                {p.vendaId && <span className="item-detalhe">pela venda</span>}
              </div>
              {pode("servicos", "editar") && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => void agir(() => post(`/entregas/${e.id}/participantes/${p.id}/retirar`), "Retirado. A vaga ficou livre.")}>
                    Retirar
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
