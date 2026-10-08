// Ficha do contato: dados, etiquetas, oportunidades, tarefas, notas e linha do tempo (histórico).
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ContatoDto, HistoricoDto, NotaDto, OportunidadeDto, TarefaDto } from "@mg/shared";
import { ErroApi, get, patch, post, put, query } from "../../app/api";
import { useDataHora, useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { Campo, CarregarMais, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import {
  CamposPersonalizados,
  EscolhaEtiquetas,
  Etiquetas,
  ValoresDosCampos,
  formatarDinheiro,
  formatarTelefone,
  lerDinheiro,
  linkWhatsApp,
  useConfigCrm,
  useTermos,
  type ValoresCampos,
} from "./comum";

type Config = ReturnType<typeof useConfigCrm>["config"];

function EditarContato({ c, config, aoSalvar }: { c: ContatoDto; config: Config; aoSalvar(): void }) {
  const [nome, setNome] = useState(c.nome);
  const [telefone, setTelefone] = useState(formatarTelefone(c.telefone));
  const [email, setEmail] = useState(c.email ?? "");
  const [origem, setOrigem] = useState(c.origem ?? "");
  const [responsavelId, setResponsavelId] = useState(c.responsavelId ?? "");
  const [naoContatar, setNaoContatar] = useState(c.naoContatar);
  const [campos, setCampos] = useState<ValoresCampos>(c.campos as ValoresCampos);
  const [etiquetaIds, setEtiquetaIds] = useState(c.etiquetas.map((e) => e.id));
  const { enviando, erro, enviar } = useEnvio(async () => {
    await patch(`/contatos/${c.id}`, {
      nome,
      telefone: telefone || null,
      email: email || null,
      origem: origem || null,
      responsavelId: responsavelId || null,
      naoContatar,
      campos,
    });
    await put(`/contatos/${c.id}/etiquetas`, { etiquetaIds });
    aoSalvar();
  });
  return (
    <form className="item-edicao" onSubmit={enviar}>
      <div className="grade-campos">
        <Campo rotulo="Nome" nome="editar-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Telefone (WhatsApp)" nome="editar-telefone" tipo="tel" valor={telefone} aoMudar={setTelefone} />
        <Campo rotulo="E-mail" nome="editar-email" tipo="email" valor={email} aoMudar={setEmail} />
        <Campo rotulo="Origem" nome="editar-origem" valor={origem} aoMudar={setOrigem} dica="Ex.: Instagram, indicação, site" />
        {config.responsaveis.length > 0 && (
          <Escolha rotulo="Responsável" nome="editar-responsavel" valor={responsavelId} aoMudar={setResponsavelId} opcoes={config.responsaveis.map((r) => ({ valor: r.id, texto: r.nome }))} vazio="Sem responsável" />
        )}
        <CamposPersonalizados definicoes={config.campos.filter((d) => d.entidade === "contato")} valores={campos} aoMudar={setCampos} prefixo="editar" />
      </div>
      <label className="marcar">
        <input type="checkbox" checked={naoContatar} onChange={(e) => setNaoContatar(e.target.checked)} />
        Não deseja ser contatado (LGPD)
      </label>
      <EscolhaEtiquetas etiquetas={config.etiquetas} marcadas={etiquetaIds} aoMudar={setEtiquetaIds} />
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        {enviando ? "Salvando…" : "Salvar"}
      </button>
    </form>
  );
}

function Oportunidades({ contato, config }: { contato: ContatoDto; config: Config }) {
  const { pode } = useSessao();
  const termos = useTermos();
  const lista = usePaginado<OportunidadeDto>(`/oportunidades${query({ contatoId: contato.id, limite: 20 })}`);
  useTempoReal(["oportunidade."], (a) => void (a.entidadeId && lista.itens.some((o) => o.id === a.entidadeId) ? lista.recarregar() : undefined));
  const [criando, setCriando] = useState(false);
  const [funilId, setFunilId] = useState("");
  const [titulo, setTitulo] = useState("");
  const [valor, setValor] = useState("");
  const funil = config.funis.find((f) => f.id === (funilId || config.funis[0]?.id));
  const criar = useEnvio(async () => {
    const valorCentavos = lerDinheiro(valor);
    if (valorCentavos === undefined) throw new ErroApi(400, "DADOS_INVALIDOS", "Valor inválido. Use números, por exemplo 1.500,00.");
    await post("/oportunidades", { contatoId: contato.id, funilId: funil?.id, titulo, valorCentavos });
    setCriando(false);
    setTitulo("");
    setValor("");
    void lista.recarregar();
  });
  const etapa = (id: string) => config.funis.flatMap((f) => f.etapas).find((e) => e.id === id);

  return (
    <section className="cartao" aria-labelledby="titulo-oportunidades">
      <div className="titulo-secao">
        <h2 id="titulo-oportunidades">{termos.Oportunidades}</h2>
        {pode("crm", "criar") && !contato.arquivadoEm && config.funis.length > 0 && (
          <button type="button" className="botao botao-secundario" aria-expanded={criando} onClick={() => setCriando((v) => !v)}>
            {criando ? "Cancelar" : "Nova"}
          </button>
        )}
      </div>
      {criando && (
        <form className="item-edicao" onSubmit={criar.enviar}>
          <div className="grade-campos">
            <Campo rotulo="Título" nome="op-titulo" valor={titulo} aoMudar={setTitulo} obrigatorio dica="Ex.: Matrícula 2027, Plano anual" />
            {config.funis.length > 1 && (
              <Escolha rotulo="Funil" nome="op-funil" valor={funilId || config.funis[0].id} aoMudar={setFunilId} opcoes={config.funis.map((f) => ({ valor: f.id, texto: f.nome }))} />
            )}
            <Campo rotulo="Valor (R$)" nome="op-valor" valor={valor} aoMudar={setValor} dica="Opcional" />
          </div>
          <Mensagem tipo="erro">{criar.erro}</Mensagem>
          <button type="submit" className="botao" disabled={criar.enviando}>
            Criar
          </button>
        </form>
      )}
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma em andamento.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((o) => (
          <li key={o.id} className="item">
            <div className="item-principal">
              <strong>{o.titulo}</strong>
              <span className="item-detalhe">
                {etapa(o.etapaId)?.nome ?? "—"}
                {o.valorCentavos !== null && ` · ${formatarDinheiro(o.valorCentavos)}`}
              </span>
              {o.status !== "aberta" && <span className={`selo selo-${o.status}`}>{o.status === "ganha" ? "Ganha" : "Perdida"}</span>}
            </div>
            <div className="item-acoes">
              <Link className="botao botao-secundario" to={`/funil?funil=${o.funilId}`}>
                Ver no funil
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

export function LinhaTarefa({ t, aoMudar, mostrarContato }: { t: TarefaDto; aoMudar(): void; mostrarContato?: boolean }) {
  const { pode } = useSessao();
  const dataHora = useDataHora();
  const concluir = useEnvio(async () => {
    await patch(`/tarefas/${t.id}`, { concluida: !t.concluidaEm });
    aoMudar();
  });
  const atrasada = !t.concluidaEm && t.venceEm && new Date(t.venceEm).getTime() < Date.now();
  return (
    <li className={`item ${atrasada ? "item-atrasado" : ""}`}>
      <label className="tarefa">
        <input type="checkbox" checked={Boolean(t.concluidaEm)} disabled={!pode("crm", "editar") || concluir.enviando} onChange={() => void concluir.enviar()} />
        <span className="tarefa-texto">
          <strong className={t.concluidaEm ? "riscado" : ""}>{t.titulo}</strong>
          <span className="item-detalhe">
            {t.venceEm ? `${atrasada ? "Atrasada · " : ""}vence ${dataHora(t.venceEm)}` : "Sem prazo"}
            {t.responsavelNome && ` · ${t.responsavelNome}`}
          </span>
        </span>
      </label>
      {mostrarContato && t.contatoId && (
        <Link className="item-detalhe" to={`/contatos/${t.contatoId}`}>
          {t.contatoNome}
        </Link>
      )}
      <Mensagem tipo="erro">{concluir.erro}</Mensagem>
    </li>
  );
}

/** Converte o "datetime-local" do formulário (hora do aparelho) para ISO UTC. */
export function paraIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function Tarefas({ contato }: { contato: ContatoDto }) {
  const { pode } = useSessao();
  const lista = usePaginado<TarefaDto>(`/tarefas${query({ contatoId: contato.id, situacao: "abertas", limite: 20 })}`);
  useTempoReal(["tarefa."], () => void lista.recarregar());
  const [titulo, setTitulo] = useState("");
  const [vence, setVence] = useState("");
  const criar = useEnvio(async () => {
    await post("/tarefas", { contatoId: contato.id, titulo, venceEm: paraIso(vence) });
    setTitulo("");
    setVence("");
    void lista.recarregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-tarefas">
      <h2 id="titulo-tarefas">Tarefas</h2>
      {pode("crm", "criar") && !contato.arquivadoEm && (
        <form className="form-linha" onSubmit={criar.enviar}>
          <Campo rotulo="Nova tarefa" nome="tarefa-titulo" valor={titulo} aoMudar={setTitulo} obrigatorio dica="Ex.: Ligar para confirmar visita" />
          <Campo rotulo="Prazo" nome="tarefa-vence" tipo="datetime-local" valor={vence} aoMudar={setVence} />
          <button type="submit" className="botao" disabled={criar.enviando}>
            Adicionar
          </button>
        </form>
      )}
      <Mensagem tipo="erro">{criar.erro}</Mensagem>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma tarefa aberta.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((t) => (
          <LinhaTarefa key={t.id} t={t} aoMudar={() => void lista.recarregar()} />
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

function Nota({ n, aoMudar }: { n: NotaDto; aoMudar(): void }) {
  const eu = useEu();
  const { pode } = useSessao();
  const dataHora = useDataHora();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(n.texto);
  const salvar = useEnvio(async () => {
    await patch(`/notas/${n.id}`, { texto });
    setEditando(false);
    aoMudar();
  });
  const podeEditar = n.autorId === eu.usuario.id || pode("crm", "administrar");
  return (
    <li className="item nota">
      {editando ? (
        <form className="item-principal" onSubmit={salvar.enviar}>
          <label className="sr-only" htmlFor={`nota-${n.id}`}>
            Texto da nota
          </label>
          <textarea id={`nota-${n.id}`} value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} required maxLength={5000} />
          <Mensagem tipo="erro">{salvar.erro}</Mensagem>
          <div className="item-acoes">
            <button type="submit" className="botao" disabled={salvar.enviando}>
              Salvar
            </button>
            <button type="button" className="botao botao-secundario" onClick={() => (setEditando(false), setTexto(n.texto))}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="item-principal">
          <p className="texto-livre">{n.texto}</p>
          <span className="item-detalhe">
            {n.autorNome ?? "—"} · {dataHora(n.criadoEm)}
            {n.atualizadoEm !== n.criadoEm && " · editada"}
          </span>
        </div>
      )}
      {!editando && podeEditar && (
        <button type="button" className="botao botao-secundario" onClick={() => setEditando(true)}>
          Editar
        </button>
      )}
    </li>
  );
}

function Notas({ contato }: { contato: ContatoDto }) {
  const { pode } = useSessao();
  const lista = usePaginado<NotaDto>(`/contatos/${contato.id}/notas?limite=20`);
  const [texto, setTexto] = useState("");
  const criar = useEnvio(async () => {
    await post(`/contatos/${contato.id}/notas`, { texto });
    setTexto("");
    void lista.recarregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-notas">
      <h2 id="titulo-notas">Notas</h2>
      {pode("crm", "editar") && !contato.arquivadoEm && (
        <form onSubmit={criar.enviar}>
          <div className="campo">
            <label htmlFor="nova-nota">Nova nota</label>
            <textarea id="nova-nota" value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} required maxLength={5000} />
          </div>
          <Mensagem tipo="erro">{criar.erro}</Mensagem>
          <button type="submit" className="botao" disabled={criar.enviando || !texto.trim()}>
            Salvar nota
          </button>
        </form>
      )}
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma nota.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((n) => (
          <Nota key={n.id} n={n} aoMudar={() => void lista.recarregar()} />
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

const TEXTOS_EVENTO: Record<string, string> = {
  "contato.criado": "Cadastro criado",
  "contato.atualizado": "Dados alterados",
  "contato.arquivado": "Enviado para a lixeira",
  "contato.restaurado": "Restaurado da lixeira",
  "contato.responsavel_alterado": "Responsável alterado",
  "contato.etiquetas_alteradas": "Etiquetas alteradas",
  "oportunidade.criada": "Oportunidade criada",
  "oportunidade.atualizada": "Oportunidade alterada",
  "oportunidade.etapa_alterada": "Mudou de etapa",
  "oportunidade.ganha": "Oportunidade ganha",
  "oportunidade.perdida": "Oportunidade perdida",
  "oportunidade.arquivada": "Oportunidade arquivada",
  "oportunidade.restaurada": "Oportunidade restaurada",
  "tarefa.criada": "Tarefa criada",
  "tarefa.atualizada": "Tarefa alterada",
  "tarefa.concluida": "Tarefa concluída",
  "tarefa.reaberta": "Tarefa reaberta",
  "nota.criada": "Nota escrita",
  "tarefa.arquivada": "Tarefa arquivada",
  "tarefa.restaurada": "Tarefa restaurada",
  "nota.atualizada": "Nota editada",
  "nota.arquivada": "Nota arquivada",
};

function detalheEvento(h: HistoricoDto): string {
  const d = h.dados as Record<string, unknown>;
  if (h.tipo === "oportunidade.etapa_alterada" && d.etapaNova) return `${String(d.titulo ?? "")}: ${String(d.etapaAnterior ?? "—")} → ${String(d.etapaNova)}`;
  if (typeof d.titulo === "string") return d.titulo;
  if (d.importacaoId) return "pela importação de planilha";
  return "";
}

function Historico({ contatoId }: { contatoId: string }) {
  const dataHora = useDataHora();
  const lista = usePaginado<HistoricoDto>(`/contatos/${contatoId}/historico?limite=30`);
  useTempoReal(["contato.", "oportunidade.", "tarefa.", "nota."], () => void lista.recarregar());
  return (
    <section className="cartao" aria-labelledby="titulo-historico">
      <h2 id="titulo-historico">Histórico</h2>
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      <ol className="linha-tempo">
        {lista.itens.map((h) => (
          <li key={h.id}>
            <strong>{TEXTOS_EVENTO[h.tipo] ?? "Atividade registrada"}</strong>
            {detalheEvento(h) && <span> — {detalheEvento(h)}</span>}
            <span className="item-detalhe">
              {dataHora(h.criadoEm)}
              {h.atorNome && ` · ${h.atorNome}`}
            </span>
          </li>
        ))}
      </ol>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

/** Abre a conversa do sistema (canal da empresa); sem canal ativo ou sem permissão, cai no wa.me. */
function ConversarNoCanal({ contatoId, telefone }: { contatoId: string; telefone: string }) {
  const { pode } = useSessao();
  const navegar = useNavigate();
  const avisar = useAviso();
  const [canais, setCanais] = useState<{ id: string; nome: string; status: string }[] | null>(null);
  const [canalId, setCanalId] = useState("");
  useEffect(() => {
    if (pode("conversas", "criar")) get<{ id: string; nome: string; status: string }[]>("/canais/ativos").then(setCanais, () => setCanais([]));
  }, [pode]);
  const conectados = (canais ?? []).filter((c) => c.status === "conectado");
  if (!conectados.length) {
    return (
      <a className="botao botao-secundario" href={linkWhatsApp(telefone)} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
    );
  }
  const abrir = async (id: string) => {
    try {
      const c = await post<{ id: string }>("/conversas", { canalId: id, contatoId });
      navegar(`/conversas/${c.id}`);
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível abrir a conversa.", "erro");
    }
  };
  if (conectados.length === 1) {
    return (
      <button type="button" className="botao botao-secundario" onClick={() => void abrir(conectados[0].id)}>
        Conversar
      </button>
    );
  }
  return (
    <span className="form-linha">
      <label className="sr-only" htmlFor="canal-conversa">
        Canal
      </label>
      <select id="canal-conversa" value={canalId} onChange={(e) => setCanalId(e.target.value)}>
        <option value="">Conversar por…</option>
        {conectados.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
      <button type="button" className="botao botao-secundario" disabled={!canalId} onClick={() => void abrir(canalId)}>
        Conversar
      </button>
    </span>
  );
}

export function Contato() {
  const { id = "" } = useParams();
  const { pode } = useSessao();
  const termos = useTermos();
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const { config } = useConfigCrm();
  const [contato, setContato] = useState<ContatoDto | null>(null);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState(false);

  const carregar = useCallback(() => {
    get<ContatoDto>(`/contatos/${id}`)
      .then((c) => (setContato(c), setErro("")))
      .catch((e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir."));
  }, [id]);
  useEffect(carregar, [carregar]);
  useTempoReal(["contato."], (a) => (a.entidadeId === id ? carregar() : undefined));

  const arquivar = useEnvio(async () => {
    if (!contato) return;
    const acao = contato.arquivadoEm ? "restaurar" : "arquivar";
    if (acao === "arquivar" && !(await confirmar({ titulo: `Arquivar ${termos.contato}`, mensagem: `${contato.nome} vai para a lixeira. O histórico fica guardado e você pode restaurar quando quiser.`, acao: "Arquivar", perigosa: true }))) return;
    await post(`/contatos/${id}/${acao}`);
    avisar(acao === "arquivar" ? "Enviado para a lixeira." : "Restaurado.");
    carregar();
  });

  if (erro) {
    return (
      <>
        <Titulo>{termos.Contato}</Titulo>
        <Mensagem tipo="erro">{erro}</Mensagem>
        <Link to="/contatos">Voltar para a lista</Link>
      </>
    );
  }
  if (!contato) return <p className="carregando">Carregando…</p>;

  return (
    <>
      <p className="trilha">
        <Link to="/contatos">{termos.Contatos}</Link>
      </p>
      <Titulo>{contato.nome}</Titulo>
      {contato.arquivadoEm && <Mensagem tipo="info">Este cadastro está na lixeira. Restaure para voltar a trabalhar com ele.</Mensagem>}
      <section className="cartao">
        <div className="contato-resumo">
          {contato.telefone && (
            <div className="acoes-contato">
              <a className="botao" href={`tel:${contato.telefone}`}>
                Ligar {formatarTelefone(contato.telefone)}
              </a>
              {!contato.naoContatar && <ConversarNoCanal contatoId={contato.id} telefone={contato.telefone} />}
            </div>
          )}
          <dl className="dados">
            {contato.email && (
              <div>
                <dt>E-mail</dt>
                <dd>{contato.email}</dd>
              </div>
            )}
            <div>
              <dt>Responsável</dt>
              <dd>{contato.responsavelNome ?? "Sem responsável"}</dd>
            </div>
            {contato.origem && (
              <div>
                <dt>Origem</dt>
                <dd>{contato.origem}</dd>
              </div>
            )}
            {contato.organizacaoNome && (
              <div>
                <dt>Empresa</dt>
                <dd>{contato.organizacaoNome}</dd>
              </div>
            )}
          </dl>
          {contato.naoContatar && <span className="selo selo-perdida">Não deseja ser contatado</span>}
          <Etiquetas lista={contato.etiquetas} />
          <ValoresDosCampos definicoes={config.campos.filter((d) => d.entidade === "contato")} valores={contato.campos} />
        </div>
        <div className="item-acoes">
          {pode("crm", "editar") && !contato.arquivadoEm && (
            <button type="button" className="botao botao-secundario" aria-expanded={editando} onClick={() => setEditando((v) => !v)}>
              {editando ? "Fechar edição" : "Editar"}
            </button>
          )}
          {pode("crm", "arquivar") && (
            <button type="button" className="botao botao-secundario" disabled={arquivar.enviando} onClick={() => void arquivar.enviar()}>
              {contato.arquivadoEm ? "Restaurar" : "Arquivar"}
            </button>
          )}
        </div>
        <Mensagem tipo="erro">{arquivar.erro}</Mensagem>
        {editando && (
          <EditarContato
            c={contato}
            config={config}
            aoSalvar={() => {
              setEditando(false);
              avisar("Alterações salvas.");
              carregar();
            }}
          />
        )}
      </section>
      <div className="duas-colunas">
        <div>
          <Oportunidades contato={contato} config={config} />
          <Tarefas contato={contato} />
          <Notas contato={contato} />
        </div>
        <Historico contatoId={contato.id} />
      </div>
    </>
  );
}
