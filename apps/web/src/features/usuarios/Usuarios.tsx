import { useEffect, useState } from "react";
import { get, patch, post, query } from "../../app/api";
import {
  BotaoAlternar,
  Campo,
  CarregarMais,
  Escolha,
  FiltroArquivados,
  ListaVazia,
  Mensagem,
  Titulo,
  useEnvio,
  usePaginado,
} from "../../ui/ui";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";

interface Usuario {
  id: string;
  usuarioId: string;
  nome: string;
  email: string;
  status: "convidado" | "ativo";
  perfilId: string;
  perfilNome: string;
  unidadeId: string | null;
  unidadeNome: string | null;
  equipeId: string | null;
  equipeNome: string | null;
  arquivadoEm: string | null;
}

interface Opcoes {
  perfis: { id: string; nome: string }[];
  unidades: { id: string; nome: string }[];
  equipes: { id: string; nome: string }[];
}

const paraOpcoes = (lista: { id: string; nome: string }[]) => lista.map((i) => ({ valor: i.id, texto: i.nome }));

function useOpcoes(): Opcoes {
  const [opcoes, setOpcoes] = useState<Opcoes>({ perfis: [], unidades: [], equipes: [] });
  useEffect(() => {
    get<Opcoes>("/usuarios/opcoes").then(setOpcoes).catch(() => undefined);
  }, []);
  return opcoes;
}

function FormularioConvite({ opcoes, aoConvidar }: { opcoes: Opcoes; aoConvidar(): void }) {
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [perfilId, setPerfilId] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [equipeId, setEquipeId] = useState("");
  const [ok, setOk] = useState("");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/convites", { email, nome, perfilId, unidadeId: unidadeId || null, equipeId: equipeId || null });
    setOk(`Convite enviado para ${email}.`);
    setEmail("");
    setNome("");
    aoConvidar();
  });

  return (
    <form className="cartao" onSubmit={enviar}>
      <div className="grade-campos">
        <Campo rotulo="Nome" nome="convite-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="E-mail" nome="convite-email" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
        <Escolha rotulo="Perfil" nome="convite-perfil" valor={perfilId} aoMudar={setPerfilId} opcoes={paraOpcoes(opcoes.perfis)} vazio="Escolha…" obrigatorio />
        <Escolha rotulo="Unidade" nome="convite-unidade" valor={unidadeId} aoMudar={setUnidadeId} opcoes={paraOpcoes(opcoes.unidades)} vazio="Nenhuma" />
        <Escolha rotulo="Equipe" nome="convite-equipe" valor={equipeId} aoMudar={setEquipeId} opcoes={paraOpcoes(opcoes.equipes)} vazio="Nenhuma" />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <Mensagem tipo="sucesso">{ok}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar convite"}
      </button>
    </form>
  );
}

function LinhaUsuario({ u, opcoes, aoMudar }: { u: Usuario; opcoes: Opcoes; aoMudar(): void }) {
  const { pode } = useSessao();
  const confirmar = useConfirmar();
  const avisar = useAviso();
  const [editando, setEditando] = useState(false);
  const [perfilId, setPerfilId] = useState(u.perfilId);
  const [unidadeId, setUnidadeId] = useState(u.unidadeId ?? "");
  const [equipeId, setEquipeId] = useState(u.equipeId ?? "");
  const salvar = useEnvio(async () => {
    await patch(`/usuarios/${u.id}`, { perfilId, unidadeId: unidadeId || null, equipeId: equipeId || null });
    setEditando(false);
    avisar("Alteração salva.");
    aoMudar();
  });
  const arquivar = useEnvio(async () => {
    const acao = u.arquivadoEm ? "restaurar" : "arquivar";
    if (
      acao === "arquivar" &&
      !(await confirmar({
        titulo: "Arquivar pessoa",
        mensagem: `Arquivar ${u.nome}? A pessoa perde o acesso a esta empresa, mas nada é apagado.`,
        acao: "Arquivar",
        perigosa: true,
      }))
    ) {
      return;
    }
    await post(`/usuarios/${u.id}/${acao}`);
    avisar(acao === "arquivar" ? `Cadastro de ${u.nome} arquivado.` : `Cadastro de ${u.nome} restaurado.`);
    aoMudar();
  });

  return (
    <li className="item">
      <div className="item-principal">
        <strong>{u.nome}</strong>
        <span className="item-detalhe">{u.email}</span>
        <span className="item-detalhe">
          {u.perfilNome}
          {u.unidadeNome && ` · ${u.unidadeNome}`}
          {u.equipeNome && ` · ${u.equipeNome}`}
        </span>
        {u.status === "convidado" && <span className="selo">Convite pendente</span>}
      </div>
      <div className="item-acoes">
        {pode("usuarios", "editar") && !u.arquivadoEm && (
          <button type="button" className="botao botao-secundario" onClick={() => setEditando((v) => !v)}>
            {editando ? "Fechar" : "Editar"}
          </button>
        )}
        {pode("usuarios", "arquivar") && (
          <button type="button" className="botao botao-secundario" disabled={arquivar.enviando} onClick={() => void arquivar.enviar()}>
            {u.arquivadoEm ? "Restaurar" : "Arquivar"}
          </button>
        )}
      </div>
      <Mensagem tipo="erro">{arquivar.erro}</Mensagem>
      {editando && (
        <form className="item-edicao" onSubmit={salvar.enviar}>
          <div className="grade-campos">
            <Escolha rotulo="Perfil" nome={`perfil-${u.id}`} valor={perfilId} aoMudar={setPerfilId} opcoes={paraOpcoes(opcoes.perfis)} />
            <Escolha rotulo="Unidade" nome={`unidade-${u.id}`} valor={unidadeId} aoMudar={setUnidadeId} opcoes={paraOpcoes(opcoes.unidades)} vazio="Nenhuma" />
            <Escolha rotulo="Equipe" nome={`equipe-${u.id}`} valor={equipeId} aoMudar={setEquipeId} opcoes={paraOpcoes(opcoes.equipes)} vazio="Nenhuma" />
          </div>
          <Mensagem tipo="erro">{salvar.erro}</Mensagem>
          <button type="submit" className="botao" disabled={salvar.enviando}>
            Salvar
          </button>
        </form>
      )}
    </li>
  );
}

export function Usuarios() {
  const { pode } = useSessao();
  const [arquivados, setArquivados] = useState(false);
  const [convidando, setConvidando] = useState(false);
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const opcoes = useOpcoes();
  const lista = usePaginado<Usuario>(`/usuarios${query({ arquivados: arquivados ? "sim" : "nao", busca: buscaAplicada })}`);
  useTempoReal(["usuario."], () => void lista.recarregar());

  return (
    <>
      <Titulo acao={pode("usuarios", "criar") && <BotaoAlternar aberto={convidando} aoMudar={setConvidando} texto="Convidar pessoa" />}>
        Usuários
      </Titulo>
      {convidando && <FormularioConvite opcoes={opcoes} aoConvidar={() => void lista.recarregar()} />}
      <section className="cartao">
        <FiltroArquivados valor={arquivados} aoMudar={setArquivados} />
        <form className="busca" role="search" onSubmit={(e) => (e.preventDefault(), setBuscaAplicada(busca))}>
          <Campo rotulo="Buscar por nome ou e-mail" nome="busca" tipo="search" valor={busca} aoMudar={setBusca} />
        </form>
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && (
          <ListaVazia>{arquivados ? "Nenhuma pessoa arquivada." : "Nenhuma pessoa encontrada."}</ListaVazia>
        )}
        <ul className="lista">
          {lista.itens.map((u) => (
            <LinhaUsuario key={u.id} u={u} opcoes={opcoes} aoMudar={() => void lista.recarregar()} />
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
