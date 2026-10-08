import { useEffect, useState } from "react";
import { get, patch, post, query, type Pagina } from "../../app/api";
import { BotaoAlternar, Campo, CarregarMais, Escolha, FiltroArquivados, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";

interface Equipe {
  id: string;
  nome: string;
  unidadeId: string | null;
  unidadeNome: string | null;
  gestorId: string | null;
  gestorNome: string | null;
  arquivadoEm: string | null;
}

type Opcao = { valor: string; texto: string };

function useOpcoesEquipe() {
  const [unidades, setUnidades] = useState<Opcao[]>([]);
  const [pessoas, setPessoas] = useState<Opcao[]>([]);
  useEffect(() => {
    get<{ unidades: { id: string; nome: string }[] }>("/usuarios/opcoes")
      .then((o) => setUnidades(o.unidades.map((u) => ({ valor: u.id, texto: u.nome }))))
      .catch(() => undefined);
    get<Pagina<{ usuarioId: string; nome: string }>>("/usuarios?limite=100")
      .then((p) => setPessoas(p.itens.map((u) => ({ valor: u.usuarioId, texto: u.nome }))))
      .catch(() => undefined);
  }, []);
  return { unidades, pessoas };
}

function FormularioEquipe(props: { equipe?: Equipe; unidades: Opcao[]; pessoas: Opcao[]; aoSalvar(): void }) {
  const [nome, setNome] = useState(props.equipe?.nome ?? "");
  const [unidadeId, setUnidadeId] = useState(props.equipe?.unidadeId ?? "");
  const [gestorId, setGestorId] = useState(props.equipe?.gestorId ?? "");
  const { enviando, erro, enviar } = useEnvio(async () => {
    const corpo = { nome, unidadeId: unidadeId || null, gestorId: gestorId || null };
    if (props.equipe) await patch(`/equipes/${props.equipe.id}`, corpo);
    else {
      await post("/equipes", corpo);
      setNome("");
    }
    props.aoSalvar();
  });
  const sufixo = props.equipe?.id ?? "nova";
  return (
    <form className={props.equipe ? "item-edicao" : "cartao"} onSubmit={enviar}>
      <div className="grade-campos">
        <Campo rotulo="Nome da equipe" nome={`equipe-nome-${sufixo}`} valor={nome} aoMudar={setNome} obrigatorio />
        <Escolha rotulo="Unidade" nome={`equipe-unidade-${sufixo}`} valor={unidadeId} aoMudar={setUnidadeId} opcoes={props.unidades} vazio="Nenhuma" />
        <Escolha rotulo="Gestor" nome={`equipe-gestor-${sufixo}`} valor={gestorId} aoMudar={setGestorId} opcoes={props.pessoas} vazio="Sem gestor" />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        {props.equipe ? "Salvar" : "Criar equipe"}
      </button>
    </form>
  );
}

export function Equipes() {
  const { pode } = useSessao();
  const [arquivados, setArquivados] = useState(false);
  const [nova, setNova] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const { unidades, pessoas } = useOpcoesEquipe();
  const lista = usePaginado<Equipe>(`/equipes${query({ arquivados: arquivados ? "sim" : "nao" })}`);
  useTempoReal(["equipe."], () => void lista.recarregar());
  const [erroAcao, setErroAcao] = useState("");
  const confirmar = useConfirmar();
  const avisar = useAviso();

  async function alternarArquivo(e: Equipe) {
    if (
      !e.arquivadoEm &&
      !(await confirmar({ titulo: "Arquivar equipe", mensagem: `Arquivar a equipe ${e.nome}? Nada é apagado; você pode restaurar depois.`, acao: "Arquivar" }))
    ) {
      return;
    }
    setErroAcao("");
    try {
      await post(`/equipes/${e.id}/${e.arquivadoEm ? "restaurar" : "arquivar"}`);
      avisar(e.arquivadoEm ? "Equipe restaurada." : "Equipe arquivada.");
    } catch (err) {
      setErroAcao((err as Error).message);
    }
    void lista.recarregar();
  }

  return (
    <>
      <Titulo acao={pode("usuarios", "criar") && <BotaoAlternar aberto={nova} aoMudar={setNova} texto="Nova equipe" />}>Equipes</Titulo>
      {nova && (
        <FormularioEquipe
          unidades={unidades}
          pessoas={pessoas}
          aoSalvar={() => {
            setNova(false);
            void lista.recarregar();
          }}
        />
      )}
      <section className="cartao">
        <FiltroArquivados valor={arquivados} aoMudar={setArquivados} />
        <Mensagem tipo="erro">{lista.erro || erroAcao}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma equipe aqui.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((e) => (
            <li key={e.id} className="item">
              <div className="item-principal">
                <strong>{e.nome}</strong>
                <span className="item-detalhe">
                  {e.gestorNome ? `Gestor: ${e.gestorNome}` : "Sem gestor"}
                  {e.unidadeNome && ` · ${e.unidadeNome}`}
                </span>
              </div>
              <div className="item-acoes">
                {pode("usuarios", "editar") && !e.arquivadoEm && (
                  <button type="button" className="botao botao-secundario" onClick={() => setEditando(editando === e.id ? null : e.id)}>
                    {editando === e.id ? "Fechar" : "Editar"}
                  </button>
                )}
                {pode("usuarios", "arquivar") && (
                  <button type="button" className="botao botao-secundario" onClick={() => void alternarArquivo(e)}>
                    {e.arquivadoEm ? "Restaurar" : "Arquivar"}
                  </button>
                )}
              </div>
              {editando === e.id && (
                <FormularioEquipe
                  equipe={e}
                  unidades={unidades}
                  pessoas={pessoas}
                  aoSalvar={() => {
                    setEditando(null);
                    void lista.recarregar();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
