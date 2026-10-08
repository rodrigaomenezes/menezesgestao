import { useState } from "react";
import {
  ACOES,
  ESCOPOS,
  MODULOS,
  NOMES_ACOES,
  NOMES_ESCOPOS,
  type Acao,
  type Escopo,
  type Modulo,
  type Permissoes,
} from "@mg/shared";
import { patch, post, query } from "../../app/api";
import { BotaoAlternar, Campo, CarregarMais, Escolha, FiltroArquivados, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";

interface Perfil {
  id: string;
  arquivadoEm: string | null;
  nome: string;
  base: string | null;
  protegido: boolean;
  permissoes: Permissoes;
}

const OPCOES_ESCOPO = ESCOPOS.map((e) => ({ valor: e, texto: NOMES_ESCOPOS[e] }));

/** Ex.: "Ver, Criar (da equipe)" ou "Sem acesso". */
function resumir(acoes: Partial<Record<Acao, Escopo>> | undefined): string {
  const lista = ACOES.filter((a) => acoes?.[a]);
  if (!lista.length) return "Sem acesso";
  const escopos = [...new Set(lista.map((a) => acoes![a]!))];
  const nomes = lista.map((a) => NOMES_ACOES[a]).join(", ");
  return escopos.length === 1 ? `${nomes} (${NOMES_ESCOPOS[escopos[0]].toLowerCase()})` : nomes;
}

function EditorPermissoes({ perfil, podeEditar, aoSalvar }: { perfil: Perfil; podeEditar: boolean; aoSalvar(): void }) {
  const [permissoes, setPermissoes] = useState<Permissoes>(perfil.permissoes);
  const [ok, setOk] = useState("");
  const somenteLeitura = perfil.protegido || !podeEditar;
  const { enviando, erro, enviar } = useEnvio(async () => {
    await patch(`/perfis/${perfil.id}`, { permissoes });
    setOk("Permissões salvas. Elas já valem para quem tem este perfil.");
    aoSalvar();
  });

  function mudar(modulo: Modulo, acao: Acao, escopo: string) {
    setOk("");
    setPermissoes((atual) => {
      const acoes = { ...(atual[modulo] ?? {}) };
      if (escopo) acoes[acao] = escopo as Escopo;
      else delete acoes[acao];
      return { ...atual, [modulo]: acoes };
    });
  }

  return (
    <form className="item-edicao" onSubmit={enviar}>
      {perfil.protegido && (
        <Mensagem tipo="info">O perfil de Dono tem acesso total e não pode ser alterado: assim sempre existe alguém que administra.</Mensagem>
      )}
      <div className="matriz">
        {MODULOS.map((m) => (
          <details key={m.id} className="matriz-modulo">
            <summary>
              <strong>{m.nome}</strong>
              <span className="item-detalhe">{resumir(permissoes[m.id])}</span>
            </summary>
            <div className="matriz-acoes">
              {ACOES.map((a) => (
                <div className="campo" key={a}>
                  <label htmlFor={`${perfil.id}-${m.id}-${a}`}>{NOMES_ACOES[a]}</label>
                  <select
                    id={`${perfil.id}-${m.id}-${a}`}
                    value={permissoes[m.id]?.[a] ?? ""}
                    disabled={somenteLeitura}
                    onChange={(e) => mudar(m.id, a, e.target.value)}
                  >
                    <option value="">Sem acesso</option>
                    {OPCOES_ESCOPO.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.texto}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <Mensagem tipo="sucesso">{ok}</Mensagem>
      {!somenteLeitura && (
        <button type="submit" className="botao" disabled={enviando}>
          {enviando ? "Salvando…" : "Salvar permissões"}
        </button>
      )}
    </form>
  );
}

function NovoPerfil({ perfis, aoCriar }: { perfis: Perfil[]; aoCriar(): void }) {
  const [nome, setNome] = useState("");
  const [copiarDe, setCopiarDe] = useState("");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/perfis", { nome, copiarDe });
    setNome("");
    aoCriar();
  });
  return (
    <form className="cartao" onSubmit={enviar}>
      <h2>Novo perfil</h2>
      <p className="dica">O perfil novo começa com as permissões do perfil escolhido. Depois é só ajustar.</p>
      <div className="grade-campos">
        <Campo rotulo="Nome (ex.: SDR, Supervisor)" nome="perfil-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Escolha rotulo="Partir do perfil" nome="perfil-base" valor={copiarDe} aoMudar={setCopiarDe} obrigatorio vazio="Escolha…"
          opcoes={perfis.map((p) => ({ valor: p.id, texto: p.nome }))} />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        Criar perfil
      </button>
    </form>
  );
}

export function Perfis() {
  const { pode } = useSessao();
  const [aberto, setAberto] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState("");
  const confirmar = useConfirmar();
  const avisar = useAviso();
  const [arquivados, setArquivados] = useState(false);
  const [novo, setNovo] = useState(false);
  const lista = usePaginado<Perfil>(`/perfis${query({ arquivados: arquivados ? "sim" : "nao" })}`);
  useTempoReal(["perfil."], () => void lista.recarregar());
  const administra = pode("usuarios", "administrar");

  async function alternarArquivo(p: Perfil) {
    if (
      !p.arquivadoEm &&
      !(await confirmar({ titulo: "Arquivar perfil", mensagem: `Arquivar o perfil ${p.nome}? Você pode restaurar depois.`, acao: "Arquivar" }))
    ) {
      return;
    }
    setErroAcao("");
    try {
      await post(`/perfis/${p.id}/${p.arquivadoEm ? "restaurar" : "arquivar"}`);
      avisar(p.arquivadoEm ? "Perfil restaurado." : "Perfil arquivado.");
      void lista.recarregar();
    } catch (err) {
      setErroAcao((err as Error).message);
    }
  }

  return (
    <>
      <Titulo acao={administra && <BotaoAlternar aberto={novo} aoMudar={setNovo} texto="Novo perfil" />}>Perfis e permissões</Titulo>
      {administra && novo && (
        <NovoPerfil
          perfis={lista.itens}
          aoCriar={() => {
            setNovo(false);
            void lista.recarregar();
          }}
        />
      )}
      <section className="cartao">
        <FiltroArquivados valor={arquivados} aoMudar={setArquivados} />
        <Mensagem tipo="erro">{lista.erro || erroAcao}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhum perfil.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((p) => (
            <li key={p.id} className="item">
              <div className="item-principal">
                <strong>{p.nome}</strong>
                {p.protegido && <span className="selo">Protegido</span>}
              </div>
              <div className="item-acoes">
                <button type="button" className="botao botao-secundario" onClick={() => setAberto(aberto === p.id ? null : p.id)}>
                  {aberto === p.id ? "Fechar" : administra && !p.protegido ? "Editar permissões" : "Ver permissões"}
                </button>
                {administra && !p.protegido && (
                  <button type="button" className="botao botao-secundario" onClick={() => void alternarArquivo(p)}>
                    {p.arquivadoEm ? "Restaurar" : "Arquivar"}
                  </button>
                )}
              </div>
              {aberto === p.id && <EditorPermissoes perfil={p} podeEditar={administra} aoSalvar={() => void lista.recarregar()} />}
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
