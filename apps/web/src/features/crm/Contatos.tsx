// Lista de contatos da carteira: busca, filtro por etiqueta e responsável, lixeira e ações em massa.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ContatoDto, ResultadoAdicionarDto } from "@mg/shared";
import { ErroApi, get, post, query } from "../../app/api";
import { useFiltrosUrl } from "../../app/filtros-url";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { BotaoAlternar, Campo, CarregarMais, Escolha, FiltroArquivados, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { CamposPersonalizados, EscolhaEtiquetas, Etiquetas, formatarTelefone, useConfigCrm, type ValoresCampos } from "./comum";
import { useVocabulario } from "../../app/vocabulario";

type Config = ReturnType<typeof useConfigCrm>["config"];

function NovoContato({ config, aoCriar }: { config: Config; aoCriar(id: string): void }) {
  const termos = useVocabulario();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [etiquetaIds, setEtiquetaIds] = useState<string[]>([]);
  const [campos, setCampos] = useState<ValoresCampos>({});
  // Telefone repetido nunca cria outro registro: o aviso mostra quem já existe e leva até ele (D-18).
  const [repetido, setRepetido] = useState<{ mensagem: string; contatoId: string | null } | null>(null);
  const envio = useEnvio(async () => {
    setRepetido(null);
    const criado = await post<ContatoDto>("/contatos", {
      nome,
      telefone: telefone || null,
      email: email || null,
      responsavelId: responsavelId || null,
      etiquetaIds,
      campos,
    }).catch((e: unknown) => {
      if (e instanceof ErroApi && e.codigo === "CONFLITO") {
        setRepetido({ mensagem: e.message, contatoId: typeof e.detalhes.contatoId === "string" ? e.detalhes.contatoId : null });
        return null;
      }
      throw e;
    });
    if (criado) aoCriar(criado.id);
  });
  const definicoes = config.campos.filter((c) => c.entidade === "contato");

  return (
    <form className="cartao" onSubmit={envio.enviar} aria-label={termos.t("{Novo contato}")}>
      <div className="grade-campos">
        <Campo rotulo="Nome" nome="contato-nome" valor={nome} aoMudar={setNome} obrigatorio erro={envio.campos.nome} />
        <Campo
          rotulo="Telefone (WhatsApp)"
          nome="contato-telefone"
          tipo="tel"
          valor={telefone}
          aoMudar={setTelefone}
          dica="Com DDD. Ex.: (11) 98888-7777"
          autoComplete="off"
          erro={envio.campos.telefone}
        />
        <Campo rotulo="E-mail" nome="contato-email" tipo="email" valor={email} aoMudar={setEmail} erro={envio.campos.email} />
        {config.responsaveis.length > 1 && (
          <Escolha
            rotulo="Responsável"
            nome="contato-responsavel"
            valor={responsavelId}
            aoMudar={setResponsavelId}
            opcoes={config.responsaveis.map((r) => ({ valor: r.id, texto: r.nome }))}
            vazio="Eu mesmo"
          />
        )}
        <CamposPersonalizados definicoes={definicoes} valores={campos} aoMudar={setCampos} prefixo="novo" />
      </div>
      <EscolhaEtiquetas etiquetas={config.etiquetas} marcadas={etiquetaIds} aoMudar={setEtiquetaIds} />
      {repetido && (
        <p className="mensagem mensagem-aviso" role="alert">
          {repetido.mensagem}{" "}
          {repetido.contatoId && <Link to={`/contatos/${repetido.contatoId}`}>Abrir o existente</Link>}
        </p>
      )}
      <Mensagem tipo="erro">{envio.resumo(["nome", "telefone", "email"])}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        {envio.enviando ? "Salvando…" : termos.t("Cadastrar {contato}")}
      </button>
    </form>
  );
}

/** Barra de ações para os contatos marcados. */
function AcoesEmMassa({ ids, config, arquivados, aoConcluir }: { ids: string[]; config: Config; arquivados: boolean; aoConcluir(): void }) {
  const { pode } = useSessao();
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const [acao, setAcao] = useState("");
  const [alvo, setAlvo] = useState("");
  const [filas, setFilas] = useState<{ id: string; nome: string; status: string }[]>([]);
  const podeFila = pode("fila", "criar") && !arquivados;
  useEffect(() => {
    if (podeFila) get<{ id: string; nome: string; status: string }[]>("/filas").then((l) => setFilas(l.filter((f) => f.status !== "encerrada")), () => undefined);
  }, [podeFila]);
  const { enviando, erro, enviar } = useEnvio(async () => {
    if (acao === "fila") {
      const r = await post<ResultadoAdicionarDto>(`/filas/${alvo}/itens`, { contatoIds: ids });
      const partes = [`${r.adicionados} na fila`];
      if (r.jaNaFila) partes.push(`${r.jaNaFila} já estavam nela`);
      if (r.emOutraFila) partes.push(`${r.emOutraFila} em outra fila`);
      if (r.semTelefone) partes.push(`${r.semTelefone} sem telefone`);
      if (r.naoContatar) partes.push(`${r.naoContatar} pediram para não ser contatados`);
      avisar(`${partes.join(", ")}.`);
      setAcao("");
      setAlvo("");
      aoConcluir();
      return;
    }
    if (acao === "arquivar" && !(await confirmar({ titulo: "Arquivar", mensagem: `Arquivar ${ids.length} registro(s)? Eles vão para a lixeira e podem ser restaurados.`, acao: "Arquivar", perigosa: true }))) return;
    const r = await post<{ afetados: number; ignorados: number }>("/contatos/acoes", {
      ids,
      acao,
      responsavelId: acao === "transferir" ? alvo : undefined,
      etiquetaId: acao === "etiquetar" || acao === "desetiquetar" ? alvo : undefined,
    });
    avisar(`${r.afetados} alterado(s)${r.ignorados ? `, ${r.ignorados} sem mudança` : ""}.`);
    setAcao("");
    setAlvo("");
    aoConcluir();
  });

  const opcoes = [
    ...(pode("crm", "editar") && !arquivados
      ? [
          ...(config.responsaveis.length > 1 ? [{ valor: "transferir", texto: "Transferir para…" }] : []),
          ...(config.etiquetas.length ? [{ valor: "etiquetar", texto: "Pôr etiqueta" }, { valor: "desetiquetar", texto: "Tirar etiqueta" }] : []),
        ]
      : []),
    ...(podeFila && filas.length ? [{ valor: "fila", texto: "Pôr na fila de ligação…" }] : []),
    ...(pode("crm", "arquivar") ? [arquivados ? { valor: "restaurar", texto: "Restaurar" } : { valor: "arquivar", texto: "Arquivar" }] : []),
  ];
  const precisaAlvo = acao === "transferir" || acao === "etiquetar" || acao === "desetiquetar" || acao === "fila";

  return (
    <form className="barra-massa" onSubmit={enviar} aria-label="Ações com os marcados">
      <strong>{ids.length} marcado(s)</strong>
      <Escolha rotulo="Ação" nome="massa-acao" valor={acao} aoMudar={(v) => (setAcao(v), setAlvo(""))} opcoes={opcoes} vazio="Escolha…" obrigatorio />
      {acao === "transferir" && (
        <Escolha rotulo="Para" nome="massa-responsavel" valor={alvo} aoMudar={setAlvo} opcoes={config.responsaveis.map((r) => ({ valor: r.id, texto: r.nome }))} vazio="Escolha…" obrigatorio />
      )}
      {acao === "fila" && (
        <Escolha rotulo="Fila" nome="massa-fila" valor={alvo} aoMudar={setAlvo} opcoes={filas.map((f) => ({ valor: f.id, texto: f.nome }))} vazio="Escolha…" obrigatorio />
      )}
      {(acao === "etiquetar" || acao === "desetiquetar") && (
        <Escolha rotulo="Etiqueta" nome="massa-etiqueta" valor={alvo} aoMudar={setAlvo} opcoes={config.etiquetas.map((e) => ({ valor: e.id, texto: e.nome }))} vazio="Escolha…" obrigatorio />
      )}
      <button type="submit" className="botao" disabled={enviando || !acao || (precisaAlvo && !alvo)}>
        Aplicar
      </button>
      <Mensagem tipo="erro">{erro}</Mensagem>
    </form>
  );
}

export function Contatos() {
  const { pode } = useSessao();
  const termos = useVocabulario();
  const navegar = useNavigate();
  const { config } = useConfigCrm();
  const [criando, setCriando] = useState(false);
  // Filtros no endereço: o link guarda a busca e o "voltar" do navegador volta ao filtro anterior.
  const { valores: f, mudar } = useFiltrosUrl(["busca", "etiquetaId", "responsavelId", "arquivados"] as const);
  const arquivados = f.arquivados === "sim";
  const buscaAplicada = f.busca ?? "";
  const etiquetaId = f.etiquetaId ?? "";
  const responsavelId = f.responsavelId ?? "";
  const [busca, setBusca] = useState(buscaAplicada);
  useEffect(() => setBusca(buscaAplicada), [buscaAplicada]);
  const setArquivados = (v: boolean) => mudar({ arquivados: v ? "sim" : undefined });
  const setBuscaAplicada = (v: string) => mudar({ busca: v.trim() || undefined });
  const setEtiquetaId = (v: string) => mudar({ etiquetaId: v || undefined });
  const setResponsavelId = (v: string) => mudar({ responsavelId: v || undefined });
  const temFiltro = Boolean(buscaAplicada || etiquetaId || responsavelId);
  const [marcados, setMarcados] = useState<string[]>([]);
  const lista = usePaginado<ContatoDto>(
    `/contatos${query({ arquivados: arquivados ? "sim" : "nao", busca: buscaAplicada, etiquetaId, responsavelId })}`,
  );
  useTempoReal(["contato."], () => void lista.recarregar());

  const marcar = (id: string, sim: boolean) => setMarcados((m) => (sim ? [...m, id] : m.filter((x) => x !== id)));
  const podeEmMassa = pode("crm", "editar") || pode("crm", "arquivar");

  return (
    <>
      <Titulo
        acao={
          <div className="acoes-titulo">
            {pode("crm", "criar") && (
              <Link to="/importar" className="botao botao-secundario">
                Importar planilha
              </Link>
            )}
            {pode("crm", "criar") && <BotaoAlternar aberto={criando} aoMudar={setCriando} texto={termos.t("{Novo contato}")} />}
          </div>
        }
      >
        {termos.Contatos}
      </Titulo>
      {criando && <NovoContato config={config} aoCriar={(id) => navegar(`/contatos/${id}`)} />}
      <section className="cartao">
        <FiltroArquivados valor={arquivados} aoMudar={(v) => (setArquivados(v), setMarcados([]))} />
        <form className="filtros" role="search" onSubmit={(e) => (e.preventDefault(), setBuscaAplicada(busca))}>
          <Campo rotulo="Buscar por nome, telefone ou e-mail" nome="busca" tipo="search" valor={busca} aoMudar={setBusca} />
          {config.etiquetas.length > 0 && (
            <Escolha rotulo="Etiqueta" nome="filtro-etiqueta" valor={etiquetaId} aoMudar={setEtiquetaId} opcoes={config.etiquetas.map((e) => ({ valor: e.id, texto: e.nome }))} vazio="Todas" />
          )}
          {config.responsaveis.length > 1 && (
            <Escolha rotulo="Responsável" nome="filtro-responsavel" valor={responsavelId} aoMudar={setResponsavelId} opcoes={config.responsaveis.map((r) => ({ valor: r.id, texto: r.nome }))} vazio="Todos" />
          )}
        </form>
        {marcados.length > 0 && <AcoesEmMassa ids={marcados} config={config} arquivados={arquivados} aoConcluir={() => (setMarcados([]), void lista.recarregar())} />}
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && (
          <ListaVazia>
            {arquivados && !temFiltro ? (
              "A lixeira está vazia."
            ) : temFiltro ? (
              <>
                Ninguém encontrado com esses filtros.{" "}
                <button type="button" className="botao-texto" onClick={() => mudar({ busca: undefined, etiquetaId: undefined, responsavelId: undefined })}>
                  Limpar filtros
                </button>
              </>
            ) : (
              termos.t("{Nenhum contato} ainda. Cadastre ou importe uma planilha.")
            )}
          </ListaVazia>
        )}
        <ul className="lista">
          {lista.itens.map((c) => (
            <li key={c.id} className="item item-contato">
              {podeEmMassa && (
                <input type="checkbox" className="item-marcar" aria-label={`Marcar ${c.nome}`} checked={marcados.includes(c.id)} onChange={(e) => marcar(c.id, e.target.checked)} />
              )}
              <div className="item-principal">
                <Link to={`/contatos/${c.id}`} className="item-link">
                  <strong>{c.nome}</strong>
                </Link>
                <span className="item-detalhe">{[formatarTelefone(c.telefone), c.email].filter(Boolean).join(" · ")}</span>
                <span className="item-detalhe">
                  {c.responsavelNome ?? "Sem responsável"}
                  {c.organizacaoNome && ` · ${c.organizacaoNome}`}
                </span>
                <Etiquetas lista={c.etiquetas} />
              </div>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
