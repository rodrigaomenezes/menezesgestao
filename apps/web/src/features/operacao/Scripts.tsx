// Biblioteca de scripts: tela de cadastro e o botão "Scripts" usado dentro da conversa e da ligação.
import { useEffect, useState } from "react";
import { NOMES_USOS_SCRIPT, USOS_SCRIPT, preencherVariaveis, type Pagina, type ScriptDto } from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { BotaoAlternar, CarregarMais, Campo, Escolha, FiltroArquivados, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { useConfigCrm } from "../crm/comum";

/** Abre os roteiros sugeridos para o contato (os da etapa dele primeiro). */
export function BotaoScripts(props: { contatoId?: string | null; uso: "conversa" | "ligacao"; variaveis: Record<string, string | null | undefined>; aoUsar?(texto: string): void }) {
  const { pode } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<ScriptDto[] | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    if (!aberto) return;
    setItens(null);
    get<Pagina<ScriptDto>>(`/scripts${query({ contatoId: props.contatoId ?? undefined, uso: props.uso, limite: 30 })}`)
      .then((p) => setItens(p.itens))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir os scripts."));
  }, [aberto, props.contatoId, props.uso]);
  if (!pode("scripts", "ver")) return null;
  return (
    <>
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        Scripts
      </button>
      {aberto && (
        <Modal aberto titulo="Scripts" aoFechar={() => setAberto(false)}>
          <Mensagem tipo="erro">{erro}</Mensagem>
          {itens && !itens.length && <ListaVazia>Nenhum script para este momento. O gestor cadastra em Scripts.</ListaVazia>}
          {!itens && !erro && <p className="carregando">Carregando…</p>}
          <ul className="lista scripts">
            {itens?.map((s) => {
              const texto = preencherVariaveis(s.texto, props.variaveis);
              return (
                <li key={s.id} className="item">
                  <div className="item-principal">
                    <strong>{s.titulo}</strong>
                    {s.etapaNome && <span className="selo">{s.etapaNome}</span>}
                    <p className="texto-livre">{texto}</p>
                  </div>
                  {props.aoUsar && (
                    <div className="item-acoes">
                      <button
                        type="button"
                        className="botao botao-secundario"
                        onClick={() => {
                          props.aoUsar?.(texto);
                          setAberto(false);
                        }}
                      >
                        Usar na mensagem
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="modal-acoes">
            <button type="button" className="botao botao-secundario" onClick={() => setAberto(false)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

interface Rascunho {
  titulo: string;
  texto: string;
  uso: string;
  funilId: string;
  etapaId: string;
}
const VAZIO: Rascunho = { titulo: "", texto: "", uso: "todos", funilId: "", etapaId: "" };

function FormScript({ inicial, aoSalvar, aoCancelar }: { inicial?: ScriptDto; aoSalvar(): void; aoCancelar?(): void }) {
  const { config } = useConfigCrm();
  const avisar = useAviso();
  const [r, setR] = useState<Rascunho>(
    inicial ? { titulo: inicial.titulo, texto: inicial.texto, uso: inicial.uso, funilId: inicial.funilId ?? "", etapaId: inicial.etapaId ?? "" } : VAZIO,
  );
  const mudar = (k: keyof Rascunho) => (v: string) => setR((a) => ({ ...a, [k]: v, ...(k === "funilId" ? { etapaId: "" } : {}) }));
  const funil = config.funis.find((f) => f.id === r.funilId);
  const envio = useEnvio(async () => {
    const corpo = { titulo: r.titulo, texto: r.texto, uso: r.uso, funilId: r.funilId || null, etapaId: r.etapaId || null };
    if (inicial) await patch(`/scripts/${inicial.id}`, corpo);
    else await post("/scripts", corpo);
    avisar(inicial ? "Script atualizado." : "Script criado.");
    if (!inicial) setR(VAZIO);
    aoSalvar();
  });
  return (
    <form className="cartao" onSubmit={envio.enviar}>
      <Campo rotulo="Título" nome={`script-titulo-${inicial?.id ?? "novo"}`} valor={r.titulo} aoMudar={mudar("titulo")} obrigatorio />
      <div className="campo">
        <label htmlFor={`script-texto-${inicial?.id ?? "novo"}`}>Texto do roteiro</label>
        <textarea id={`script-texto-${inicial?.id ?? "novo"}`} rows={6} maxLength={20000} required value={r.texto} onChange={(e) => mudar("texto")(e.target.value)} />
        <small className="dica">Use {"{nome}"}, {"{vendedor}"} e {"{empresa}"}: são trocados na hora de usar.</small>
      </div>
      <div className="grade-campos">
        <Escolha rotulo="Onde usar" nome={`script-uso-${inicial?.id ?? "novo"}`} valor={r.uso} aoMudar={mudar("uso")} opcoes={USOS_SCRIPT.map((u) => ({ valor: u, texto: NOMES_USOS_SCRIPT[u] }))} />
        <Escolha rotulo="Funil" nome={`script-funil-${inicial?.id ?? "novo"}`} valor={r.funilId} aoMudar={mudar("funilId")} vazio="Todos os funis" opcoes={config.funis.map((f) => ({ valor: f.id, texto: f.nome }))} />
        {funil && (
          <Escolha rotulo="Etapa" nome={`script-etapa-${inicial?.id ?? "novo"}`} valor={r.etapaId} aoMudar={mudar("etapaId")} vazio="Todas as etapas" opcoes={funil.etapas.map((e) => ({ valor: e.id, texto: e.nome }))} />
        )}
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <div className="form-linha">
        <button type="submit" className="botao" disabled={envio.enviando}>
          {envio.enviando ? "Salvando…" : inicial ? "Salvar" : "Criar script"}
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

export function Scripts() {
  const { pode } = useSessao();
  const avisar = useAviso();
  const [arquivados, setArquivados] = useState(false);
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const lista = usePaginado<ScriptDto>(`/scripts${query({ arquivados: arquivados ? "sim" : "nao", busca: busca || undefined, limite: 30 })}`);
  useTempoReal(["script."], () => void lista.recarregar());
  const podeEditar = pode("scripts", "editar");

  const alternar = async (s: ScriptDto) => {
    try {
      await patch(`/scripts/${s.id}`, { arquivar: !s.arquivadoEm });
      avisar(s.arquivadoEm ? "Script restaurado." : "Script arquivado. Ele fica em Arquivados.");
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    }
  };

  return (
    <>
      <Titulo acao={pode("scripts", "criar") && <BotaoAlternar aberto={novo} aoMudar={setNovo} texto="Novo script" />}>Scripts</Titulo>
      {novo && <FormScript aoSalvar={() => (setNovo(false), void lista.recarregar())} />}
      <section className="cartao">
        <FiltroArquivados valor={arquivados} aoMudar={setArquivados} />
        <div className="filtros">
          <Campo rotulo="Buscar no título ou no texto" nome="scripts-busca" tipo="search" valor={busca} aoMudar={setBusca} />
        </div>
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhum script ainda. Roteiros cadastrados aqui aparecem na conversa e na ligação.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((s) =>
            editando === s.id ? (
              <li key={s.id}>
                <FormScript inicial={s} aoSalvar={() => (setEditando(null), void lista.recarregar())} aoCancelar={() => setEditando(null)} />
              </li>
            ) : (
              <li key={s.id} className="item">
                <div className="item-principal">
                  <strong>{s.titulo}</strong>
                  <span className="item-detalhe">
                    {NOMES_USOS_SCRIPT[s.uso]} · {s.funilNome ? `${s.funilNome}${s.etapaNome ? ` › ${s.etapaNome}` : ""}` : "Todos os funis"}
                  </span>
                  <p className="texto-livre item-detalhe">{s.texto.length > 240 ? `${s.texto.slice(0, 240)}…` : s.texto}</p>
                </div>
                {podeEditar && (
                  <div className="item-acoes">
                    {!s.arquivadoEm && (
                      <button type="button" className="botao botao-secundario" onClick={() => setEditando(s.id)}>
                        Editar
                      </button>
                    )}
                    <button type="button" className="botao botao-secundario" onClick={() => void alternar(s)}>
                      {s.arquivadoEm ? "Restaurar" : "Arquivar"}
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
