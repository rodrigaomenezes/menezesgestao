import { useState } from "react";
import { patch, post, query } from "../../app/api";
import { BotaoAlternar, Campo, CarregarMais, FiltroArquivados, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";

interface Unidade {
  id: string;
  nome: string;
  endereco: string | null;
  arquivadoEm: string | null;
}

function FormularioUnidade({ unidade, aoSalvar }: { unidade?: Unidade; aoSalvar(): void }) {
  const [nome, setNome] = useState(unidade?.nome ?? "");
  const [endereco, setEndereco] = useState(unidade?.endereco ?? "");
  const { enviando, erro, enviar } = useEnvio(async () => {
    if (unidade) await patch(`/unidades/${unidade.id}`, { nome, endereco: endereco || null });
    else {
      await post("/unidades", { nome, endereco: endereco || null });
      setNome("");
      setEndereco("");
    }
    aoSalvar();
  });
  const sufixo = unidade?.id ?? "nova";
  return (
    <form className={unidade ? "item-edicao" : "cartao"} onSubmit={enviar}>
      <div className="grade-campos">
        <Campo rotulo="Nome" nome={`unidade-nome-${sufixo}`} valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Endereço" nome={`unidade-endereco-${sufixo}`} valor={endereco} aoMudar={setEndereco} />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        {unidade ? "Salvar" : "Criar unidade"}
      </button>
    </form>
  );
}

export function Unidades() {
  const { pode } = useSessao();
  const [arquivados, setArquivados] = useState(false);
  const [nova, setNova] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState("");
  const confirmar = useConfirmar();
  const avisar = useAviso();
  const lista = usePaginado<Unidade>(`/unidades${query({ arquivados: arquivados ? "sim" : "nao" })}`);
  useTempoReal(["unidade."], () => void lista.recarregar());

  async function alternarArquivo(u: Unidade) {
    if (
      !u.arquivadoEm &&
      !(await confirmar({ titulo: "Arquivar unidade", mensagem: `Arquivar a unidade ${u.nome}? Nada é apagado; você pode restaurar depois.`, acao: "Arquivar" }))
    ) {
      return;
    }
    setErroAcao("");
    try {
      await post(`/unidades/${u.id}/${u.arquivadoEm ? "restaurar" : "arquivar"}`);
      avisar(u.arquivadoEm ? "Unidade restaurada." : "Unidade arquivada.");
    } catch (err) {
      setErroAcao((err as Error).message);
    }
    void lista.recarregar();
  }

  return (
    <>
      <Titulo acao={pode("configuracoes", "criar") && <BotaoAlternar aberto={nova} aoMudar={setNova} texto="Nova unidade" />}>
        Unidades
      </Titulo>
      {nova && (
        <FormularioUnidade
          aoSalvar={() => {
            setNova(false);
            void lista.recarregar();
          }}
        />
      )}
      <section className="cartao">
        <FiltroArquivados valor={arquivados} aoMudar={setArquivados} />
        <Mensagem tipo="erro">{lista.erro || erroAcao}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma unidade aqui.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((u) => (
            <li key={u.id} className="item">
              <div className="item-principal">
                <strong>{u.nome}</strong>
                {u.endereco && <span className="item-detalhe">{u.endereco}</span>}
              </div>
              <div className="item-acoes">
                {pode("configuracoes", "editar") && !u.arquivadoEm && (
                  <button type="button" className="botao botao-secundario" onClick={() => setEditando(editando === u.id ? null : u.id)}>
                    {editando === u.id ? "Fechar" : "Editar"}
                  </button>
                )}
                {pode("configuracoes", "arquivar") && (
                  <button type="button" className="botao botao-secundario" onClick={() => void alternarArquivo(u)}>
                    {u.arquivadoEm ? "Restaurar" : "Arquivar"}
                  </button>
                )}
              </div>
              {editando === u.id && (
                <FormularioUnidade
                  unidade={u}
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
