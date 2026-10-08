// Lista de contatos da carteira: busca, filtro por etiqueta e responsável, lixeira e ações em massa.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ContatoDto, ResultadoAdicionarDto } from "@mg/shared";
import { get, post, query } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { BotaoAlternar, Campo, CarregarMais, Escolha, FiltroArquivados, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { CamposPersonalizados, EscolhaEtiquetas, Etiquetas, formatarTelefone, useConfigCrm, useTermos, type ValoresCampos } from "./comum";

type Config = ReturnType<typeof useConfigCrm>["config"];

function NovoContato({ config, aoCriar }: { config: Config; aoCriar(id: string): void }) {
  const termos = useTermos();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [etiquetaIds, setEtiquetaIds] = useState<string[]>([]);
  const [campos, setCampos] = useState<ValoresCampos>({});
  const { enviando, erro, enviar } = useEnvio(async () => {
    const criado = await post<ContatoDto>("/contatos", {
      nome,
      telefone: telefone || null,
      email: email || null,
      responsavelId: responsavelId || null,
      etiquetaIds,
      campos,
    });
    aoCriar(criado.id);
  });
  const definicoes = config.campos.filter((c) => c.entidade === "contato");

  return (
    <form className="cartao" onSubmit={enviar} aria-label={`Novo ${termos.contato}`}>
      <div className="grade-campos">
        <Campo rotulo="Nome" nome="contato-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Telefone (WhatsApp)" nome="contato-telefone" tipo="tel" valor={telefone} aoMudar={setTelefone} dica="Com DDD. Ex.: (11) 98888-7777" autoComplete="off" />
        <Campo rotulo="E-mail" nome="contato-email" tipo="email" valor={email} aoMudar={setEmail} />
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
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        {enviando ? "Salvando…" : `Cadastrar ${termos.contato}`}
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
  const termos = useTermos();
  const navegar = useNavigate();
  const { config } = useConfigCrm();
  const [criando, setCriando] = useState(false);
  const [arquivados, setArquivados] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [etiquetaId, setEtiquetaId] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
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
            {pode("crm", "criar") && <BotaoAlternar aberto={criando} aoMudar={setCriando} texto={`Novo ${termos.contato}`} />}
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
          <ListaVazia>{arquivados ? "A lixeira está vazia." : buscaAplicada ? "Ninguém encontrado com essa busca." : `Nenhum ${termos.contato} ainda. Cadastre ou importe uma planilha.`}</ListaVazia>
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
