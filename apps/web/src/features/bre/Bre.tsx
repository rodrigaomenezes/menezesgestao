// Motor BRE (fase 8.1): fila do dia, registro de 30 segundos, reentradas e limites da empresa.
// O servidor aplica todas as regras; a tela só mostra o que ele permite e diz o motivo quando recusa.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CATEGORIAS_BREAK,
  CHECKLIST_ENCERRAMENTO,
  CRITERIOS_ENCERRAMENTO,
  ESCALONAMENTOS,
  PILARES_BPI,
  ESTADOS_CLIENTE,
  ESTADOS_EMOCIONAIS,
  PROXIMAS_ACOES,
  RESULTADOS_CONTATO,
  SINS,
  TEMPERATURAS,
  TIPOS_REENTRADA,
  type AnaliseBreDto,
  type BpiDto,
  type BpiRespostaDto,
  type ConcordanciaDto,
  type InteligenciaContatoDto,
  type EscalonamentoDto,
  type ItemFilaBreDto,
  type MotivoBreakDto,
  type ReentradaDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, put, query } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useVocabulario } from "../../app/vocabulario";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { AutomacaoBre } from "./Automacao";
import { useFiltrosUrl } from "../../app/filtros-url";
import { Ranking } from "../../ui/paineis";
import { esperarResultado } from "./espera";
import { PainelBreaks } from "./PainelBreaks";
import { CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";

const opcoes = (l: readonly { codigo: string; nome: string }[]) => l.map((i) => ({ valor: i.codigo, texto: i.nome }));
const daquiA = (dias: number) => new Date(Date.now() + dias * 864e5).toLocaleDateString("en-CA");

/** Registro pós-conversa (BRE-FR-012): os campos obrigatórios em uma tela, pensado para 30 segundos. */
export function BotaoRegistrarBre({ contatoId, conversaId, aoRegistrar }: { contatoId: string; conversaId?: string; aoRegistrar?(): void }) {
  const { pode } = useSessao();
  const termos = useVocabulario();
  const avisar = useAviso();
  const [aberto, setAberto] = useState(false);
  const [inicio, setInicio] = useState(0);
  const [motivos, setMotivos] = useState<MotivoBreakDto[]>([]);
  const [resultado, setResultado] = useState("REPLIED_NO_ADVANCE");
  const [temperatura, setTemperatura] = useState("WARM");
  const [emocao, setEmocao] = useState("");
  const [sins, setSins] = useState<string[]>([]);
  const [proximaAcao, setProximaAcao] = useState("CALL_BACK");
  const [retornoEm, setRetornoEm] = useState(daquiA(3));
  const [comBreak, setComBreak] = useState(false);
  const [categoria, setCategoria] = useState("A_TIME");
  const [motivoId, setMotivoId] = useState("");
  const [comentario, setComentario] = useState("");
  const [inteligencia, setInteligencia] = useState<InteligenciaContatoDto | null>(null);
  useEffect(() => {
    if (!aberto) return;
    setInicio(Date.now());
    get<{ itens: MotivoBreakDto[] }>("/bre/motivos").then((r) => setMotivos(r.itens.filter((m) => !m.arquivadoEm)), () => undefined);
    get<InteligenciaContatoDto>(`/bre/contatos/${contatoId}/inteligencia`).then(setInteligencia, () => setInteligencia(null));
  }, [aberto, contatoId]);
  const [avisoIa, setAvisoIa] = useState("");
  const [escalonar, setEscalonar] = useState("");
  const daCategoria = motivos.filter((m) => m.categoria === categoria);
  // A IA só pré-preenche: a pessoa confere e salva (BRE-P-010).
  const sugestao = useEnvio(async () => {
    const pedido = await post<AnaliseBreDto>(`/bre/conversas/${conversaId}/analisar`);
    const r = await esperarResultado(() => get<AnaliseBreDto>(`/bre/analises/${pedido.id}`));
    if (r.status !== "pronta" || !r.sugestao) {
      setAvisoIa(r.status === "processando" ? "A IA está demorando. Preencha o registro ou tente de novo daqui a pouco." : (r.erro ?? "A IA não conseguiu analisar."));
      return;
    }
    const a = r.sugestao;
    setResultado(a.resultado);
    setTemperatura(a.temperatura);
    setEmocao(a.estadoEmocional ?? "");
    setSins(a.sins);
    setProximaAcao(a.proximaAcao);
    if (a.retornoEmDias !== null) setRetornoEm(daquiA(a.retornoEmDias));
    setComBreak(Boolean(a.break));
    if (a.break) {
      setCategoria(a.break.categoria);
      setMotivoId("");
      setComentario(a.break.comentario);
    }
    setEscalonar(a.escalonamento ?? "");
    setAvisoIa([a.resumo, ...a.bloqueios, ...a.incertezas].join(" "));
  });
  const semRetorno = proximaAcao === "CLOSE_NO_INTEREST" || resultado === "OPTED_OUT";
  const envio = useEnvio(async () => {
    const r = await post<{ cicloEncerrado: boolean; tarefas: number }>("/bre/registros", {
      contatoId,
      conversaId: conversaId ?? null,
      resultado,
      temperatura,
      estadoEmocional: emocao || null,
      sins,
      proximaAcao,
      retornoEm: semRetorno ? null : retornoEm,
      break: comBreak ? { categoria, motivoId: motivoId || daCategoria[0]?.id, comentario } : null,
      escalonamento: escalonar || null,
      segundos: Math.round((Date.now() - inicio) / 1000),
    });
    avisar(r.cicloEncerrado ? "Conversa registrada. O ciclo foi encerrado e a reentrada ficou programada." : "Conversa registrada.");
    setAberto(false);
    aoRegistrar?.();
  });
  if (!pode("bre", "criar")) return null;
  return (
    <>
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        Registrar conversa
      </button>
      {aberto && (
        <Modal aberto titulo="Registrar conversa" aoFechar={() => setAberto(false)}>
          <form onSubmit={envio.enviar}>
            {conversaId && (
              <p>
                <button type="button" className="botao botao-secundario" disabled={sugestao.enviando} onClick={() => void sugestao.enviar()}>
                  {sugestao.enviando ? "Analisando… (pode levar alguns segundos)" : "Sugerir com IA"}
                </button>
              </p>
            )}
            <Mensagem tipo="erro">{sugestao.erro}</Mensagem>
            <Mensagem tipo="info">{avisoIa}</Mensagem>
            {inteligencia && inteligencia.faltando.length > 0 && (
              <p className="dica">
                Falta saber ({inteligencia.preenchidos} de {inteligencia.campos}): {inteligencia.faltando.join(", ")}.
              </p>
            )}
            <div className="grade-campos">
              <Escolha rotulo="Resultado" nome="bre-resultado" valor={resultado} aoMudar={setResultado} opcoes={opcoes(RESULTADOS_CONTATO)} />
              <Escolha rotulo="Temperatura" nome="bre-temperatura" valor={temperatura} aoMudar={setTemperatura} opcoes={opcoes(TEMPERATURAS)} />
              <Escolha rotulo="Estado emocional" nome="bre-emocao" valor={emocao} aoMudar={setEmocao} opcoes={opcoes(ESTADOS_EMOCIONAIS)} vazio="Não percebi" />
              <Escolha rotulo="Próxima ação" nome="bre-acao" valor={proximaAcao} aoMudar={setProximaAcao} opcoes={opcoes(PROXIMAS_ACOES)} />
              <Escolha rotulo="Precisa de uma pessoa?" nome="bre-escalonar" valor={escalonar} aoMudar={setEscalonar} opcoes={opcoes(ESCALONAMENTOS)} vazio="Não" />
              {!semRetorno && <Campo rotulo="Data do retorno" nome="bre-retorno" tipo="date" valor={retornoEm} aoMudar={setRetornoEm} obrigatorio />}
            </div>
            <fieldset className="campo grupo-marcar">
              <legend>{termos.t("Os três “sim” que {o|a:contato} {contato} deu")}</legend>
              {SINS.map((s) => (
                <label key={s.codigo}>
                  <input type="checkbox" checked={sins.includes(s.codigo)} onChange={(e) => setSins(e.target.checked ? [...sins, s.codigo] : sins.filter((x) => x !== s.codigo))} /> {s.nome}
                </label>
              ))}
            </fieldset>
            <label className="campo">
              <span>
                <input type="checkbox" checked={comBreak} onChange={(e) => setComBreak(e.target.checked)} /> Houve uma quebra (Break)
              </span>
            </label>
            {comBreak && (
              <div className="grade-campos">
                <Escolha rotulo="Categoria" nome="bre-categoria" valor={categoria} aoMudar={(v) => (setCategoria(v), setMotivoId(""))} opcoes={opcoes(CATEGORIAS_BREAK)} />
                <Escolha rotulo="Motivo" nome="bre-motivo" valor={motivoId || daCategoria[0]?.id || ""} aoMudar={setMotivoId} opcoes={daCategoria.map((m) => ({ valor: m.id, texto: m.nome }))} />
                <div className="campo">
                  <label htmlFor="bre-comentario">{termos.t("O que {o|a:contato} {contato} disse")}</label>
                  <textarea id="bre-comentario" rows={2} maxLength={1000} required value={comentario} onChange={(e) => setComentario(e.target.value)} />
                </div>
              </div>
            )}
            <Mensagem tipo="erro">{envio.erro}</Mensagem>
            <div className="modal-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => setAberto(false)}>
                Cancelar
              </button>
              <button type="submit" className="botao" disabled={envio.enviando}>
                Salvar registro
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

const nomeEstado = (c: string | null) => ESTADOS_CLIENTE.find((e) => e.codigo === c)?.nome ?? "";

function Reentradas() {
  const avisar = useAviso();
  const lista = usePaginado<ReentradaDto>("/bre/reentradas?limite=30");
  const concluir = async (r: ReentradaDto, status: "feita" | "cancelada") => {
    try {
      await patch(`/bre/reentradas/${r.id}`, { status });
      avisar(status === "feita" ? "Reentrada concluída." : "Reentrada cancelada.");
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível salvar.", "erro");
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-reentradas">
      <h2 id="titulo-reentradas">Reentradas programadas</h2>
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma reentrada pendente.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((r) => (
          <li key={r.id} className="item">
            <div className="item-principal">
              <strong>{r.contatoNome}</strong>
              <span className="item-detalhe">
                {r.previstaPara ? new Date(`${r.previstaPara}T12:00:00`).toLocaleDateString("pt-BR") : r.condicao} · {r.motivo}
              </span>
            </div>
            <div className="item-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => void concluir(r, "feita")}>
                Feita
              </button>
              <button type="button" className="botao botao-secundario" onClick={() => void concluir(r, "cancelada")}>
                Cancelar
              </button>
            </div>
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

const LIMITES = [
  { chave: "recenteAte", rotulo: "Recente até (dias)" },
  { chave: "ativoAte", rotulo: "Ativo até (dias)" },
  { chave: "inativoApos", rotulo: "Inativo depois de (dias)" },
  { chave: "tentativasPorCiclo", rotulo: "Tentativas por ciclo" },
  { chave: "horasEntreTentativas", rotulo: "Horas entre tentativas" },
  { chave: "diasSilencioEncerra", rotulo: "Dias de silêncio que encerram o ciclo" },
  { chave: "diasEntreCiclos", rotulo: "Dias entre ciclos sem resposta" },
] as const;

function Limites() {
  const avisar = useAviso();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState("");
  const [mascarar, setMascarar] = useState(false);
  const carregar = useCallback(() => {
    get<Record<string, number | boolean | null>>("/bre/config").then((c) => {
      setValores(Object.fromEntries(LIMITES.map((l) => [l.chave, String(c[l.chave])])));
      setMeta(c.metaReceitaCentavos ? String(Number(c.metaReceitaCentavos) / 100) : "");
      setMascarar(Boolean(c.mascararDadosIa));
    }, () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const envio = useEnvio(async () => {
    const reais = meta.trim() ? Number(meta.replace(/\./g, "").replace(",", ".")) : null;
    if (reais !== null && !(reais >= 0)) {
      envio.setErro("Meta de receita: digite um valor em reais, como 42000.");
      return;
    }
    await put("/bre/config", { ...Object.fromEntries(LIMITES.map((l) => [l.chave, Number(valores[l.chave])])), metaReceitaCentavos: reais === null ? null : Math.round(reais * 100), mascararDadosIa: mascarar });
    avisar("Limites salvos.");
    carregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-limites">
      <h2 id="titulo-limites">Limites da empresa</h2>
      <form onSubmit={envio.enviar}>
        <div className="grade-campos">
          {LIMITES.map((l) => (
            <Campo key={l.chave} rotulo={l.rotulo} nome={`bre-${l.chave}`} tipo="number" valor={valores[l.chave] ?? ""} aoMudar={(v) => setValores({ ...valores, [l.chave]: v })} obrigatorio />
          ))}
          <Campo rotulo="Meta de receita por pessoa no mês (R$, vazio = sem meta)" nome="bre-meta" valor={meta} aoMudar={setMeta} />
          <label className="campo">
            <span>
              <input type="checkbox" checked={mascarar} onChange={(e) => setMascarar(e.target.checked)} /> Esconder telefone, e-mail, CPF, CNPJ e CEP
              antes de enviar a conversa para a IA
            </span>
          </label>
        </div>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <button type="submit" className="botao" disabled={envio.enviando}>
          Salvar limites
        </button>
      </form>
    </section>
  );
}

const nomeSituacao = (c: string) => ESCALONAMENTOS.find((x) => x.codigo === c)?.nome ?? c;

/** BR-017: conversas que precisam de uma pessoa (a automação fica parada até resolver). */
function Escalonamentos() {
  const { pode } = useSessao();
  const avisar = useAviso();
  const lista = usePaginado<EscalonamentoDto>("/bre/escalonamentos?limite=30");
  useTempoReal(["bre.escalonamento"], () => void lista.recarregar());
  const resolver = async (x: EscalonamentoDto) => {
    try {
      await patch(`/bre/escalonamentos/${x.id}`);
      avisar("Escalonamento resolvido.");
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível salvar.", "erro");
    }
  };
  if (!lista.carregando && !lista.itens.length && !lista.erro) return null;
  return (
    <section className="cartao" aria-labelledby="titulo-escalonamentos">
      <h2 id="titulo-escalonamentos">Precisa de uma pessoa</h2>
      <p className="dica">Enquanto estiver aqui, nenhuma mensagem automática sai para essa pessoa.</p>
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      <ul className="lista">
        {lista.itens.map((x) => (
          <li key={x.id} className="item">
            <div className="item-principal">
              <strong>{x.contatoNome}</strong>
              <span className="item-detalhe">
                {nomeSituacao(x.situacao)} · {x.origem === "ia" ? "apontado pela IA" : "apontado pela equipe"}
              </span>
              {x.observacao && <span className="item-detalhe">{x.observacao}</span>}
            </div>
            {pode("bre", "editar") && (
              <div className="item-acoes">
                <button type="button" className="botao botao-secundario" onClick={() => void resolver(x)}>
                  Resolvido
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

const numero = (n: number | null) => (n === null ? "sem dados" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

/** BPI do mês (D-14): ranking, pilares e quem está em coaching (BR-022). Lido do cálculo guardado, paginado. */
/** Onde cada pilar do BPI se explica em detalhe (a lista que compõe o número), no mês e na pessoa. */
function destinoDoPilar(pilar: string, usuarioId: string, mes: string): string | null {
  const inicio = `${mes}-01`;
  const fim = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (pilar === "receita") return `/vendas?inicio=${inicio}&fim=${fim}&vendedorId=${usuarioId}&status=confirmada`;
  if (pilar === "pipeline") return `/funil?ver=painel&inicio=${inicio}&fim=${fim}&responsavelId=${usuarioId}&lista=aberta`;
  if (pilar === "relacionamento") return `/desempenho?inicio=${inicio}&fim=${fim}&indicador=tarefas_concluidas&usuarioId=${usuarioId}`;
  if (pilar === "qualidade") return "/qualidade";
  return null;
}

/** BPI do mês do todo ao micro: ranking → pilares da pessoa → a lista que compõe o pilar. Mês e pessoa no endereço. */
function Desempenho() {
  const hora = useDataHora();
  const navegar = useNavigate();
  const { valores: f, mudar } = useFiltrosUrl(["bpiMes", "bpiPessoa"] as const);
  const mes = f.bpiMes ?? "";
  const [dados, setDados] = useState<BpiRespostaDto | null>(null);
  const [itens, setItens] = useState<BpiDto[]>([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const buscar = useCallback(
    async (opcoes: { cursor?: string | null; atualizar?: boolean } = {}) => {
      setCarregando(true);
      try {
        const r = await get<BpiRespostaDto>(`/bre/desempenho${query({ mes: mes || undefined, limite: 30, cursor: opcoes.cursor ?? undefined, atualizar: opcoes.atualizar ? "sim" : undefined })}`);
        setDados(r);
        setItens((antes) => (opcoes.cursor ? [...antes, ...r.itens] : r.itens));
        setErro("");
      } catch (e) {
        setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o desempenho.");
      } finally {
        setCarregando(false);
      }
    },
    [mes],
  );
  useEffect(() => void buscar(), [buscar]);
  const comDados = itens.filter((i) => i.bpi !== null);
  const foco = comDados.find((i) => i.usuarioId === f.bpiPessoa);
  const mesDados = dados?.mes ?? mes;
  return (
    <section className="cartao" aria-labelledby="titulo-desempenho-bre">
      <h2 id="titulo-desempenho-bre">Desempenho (BPI)</h2>
      <Campo rotulo="Mês" nome="bre-mes" tipo="month" valor={mes || dados?.mes || ""} aoMudar={(v) => mudar({ bpiMes: v || undefined, bpiPessoa: undefined })} />
      {dados && (
        <p className="dica">
          Calculado em {hora(dados.calculadoEm)}.{" "}
          <button type="button" className="botao botao-secundario botao-pequeno" disabled={carregando} onClick={() => void buscar({ atualizar: true })}>
            Recalcular agora
          </button>
        </p>
      )}
      <Mensagem tipo="erro">{erro}</Mensagem>
      {dados && !comDados.length && <ListaVazia>Ninguém atendeu pelo método BRE neste mês.</ListaVazia>}
      {comDados.length > 0 && (
        <Ranking
          itens={comDados.map((i) => ({ id: i.usuarioId, rotulo: i.nome, valor: i.bpi ?? 0, texto: `${numero(i.bpi)} · ${i.faixa ?? ""}` }))}
          selecionado={f.bpiPessoa}
          aoEscolher={(id) => mudar({ bpiPessoa: id === f.bpiPessoa ? undefined : id })}
          vazio=""
        />
      )}
      {!foco && comDados.length > 0 && <p className="dica">Toque numa pessoa para ver os pilares dela.</p>}
      {foco && (
        <div className="bpi-pessoa" aria-label={`Pilares de ${foco.nome}`} role="region">
          <h3>
            Pilares de {foco.nome} <span className="item-detalhe">· BPI {numero(foco.bpi)} ({foco.faixa})</span>
          </h3>
          <Ranking
            numerar={false}
            itens={PILARES_BPI.filter((p) => foco.pilares[p.codigo] !== null).map((p) => ({
              id: p.codigo,
              rotulo: `${p.nome} (peso ${p.peso})${destinoDoPilar(p.codigo, foco.usuarioId, mesDados) ? "" : " · sem lista"}`,
              valor: foco.pilares[p.codigo] ?? 0,
              texto: numero(foco.pilares[p.codigo]),
            }))}
            aoEscolher={(pilar) => {
              const destino = destinoDoPilar(pilar, foco.usuarioId, mesDados);
              if (destino) navegar(destino);
            }}
            vazio="Sem pilares calculados."
          />
          {foco.coaching.length > 0 && <p className="dica">Coaching: abaixo de 70 há 2 semanas em {foco.coaching.join(", ")}.</p>}
          <p className="dica">Toque num pilar para abrir a lista que forma o número (vendas, funil, tarefas, qualidade).</p>
        </div>
      )}
      <CarregarMais visivel={Boolean(dados?.proximoCursor)} carregando={carregando} aoClicar={() => void buscar({ cursor: dados?.proximoCursor })} />
    </section>
  );
}

/** BR-002: encerrar pelo método exige um dos 6 critérios e o checklist inteiro; pode programar a reentrada. */
export function BotaoEncerrarBre({ oportunidadeId, aoEncerrar }: { oportunidadeId: string; aoEncerrar?(): void }) {
  const { pode } = useSessao();
  const avisar = useAviso();
  const [aberto, setAberto] = useState(false);
  const [criterio, setCriterio] = useState<string>(CRITERIOS_ENCERRAMENTO[0].codigo);
  const [temperatura, setTemperatura] = useState("COLD");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [comReentrada, setComReentrada] = useState(true);
  const [tipo, setTipo] = useState("TIME");
  const [data, setData] = useState(daquiA(30));
  const [condicao, setCondicao] = useState("");
  const [motivo, setMotivo] = useState("");
  const envio = useEnvio(async () => {
    await post(`/bre/oportunidades/${oportunidadeId}/encerrar`, {
      criterio,
      temperatura,
      checklist: Object.fromEntries(CHECKLIST_ENCERRAMENTO.map((c) => [c.codigo, marcados.includes(c.codigo)])),
      reentrada: comReentrada ? { tipo, previstaPara: tipo === "TIME" ? data : null, condicao: tipo === "TIME" ? null : condicao || null, motivo } : null,
    });
    avisar("Encerrado pelo método BRE.");
    setAberto(false);
    aoEncerrar?.();
  });
  if (!pode("bre", "editar")) return null;
  return (
    <>
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        Encerrar (BRE)
      </button>
      {aberto && (
        <Modal aberto titulo="Encerrar pelo método BRE" aoFechar={() => setAberto(false)}>
          <form onSubmit={envio.enviar}>
            <div className="grade-campos">
              <Escolha rotulo="Critério" nome="enc-criterio" valor={criterio} aoMudar={setCriterio} opcoes={opcoes(CRITERIOS_ENCERRAMENTO)} />
              <Escolha rotulo="Temperatura" nome="enc-temperatura" valor={temperatura} aoMudar={setTemperatura} opcoes={opcoes(TEMPERATURAS)} />
            </div>
            <fieldset className="campo grupo-marcar">
              <legend>Checklist de encerramento</legend>
              {CHECKLIST_ENCERRAMENTO.map((c) => (
                <label key={c.codigo}>
                  <input
                    type="checkbox"
                    checked={marcados.includes(c.codigo)}
                    onChange={(e) => setMarcados(e.target.checked ? [...marcados, c.codigo] : marcados.filter((x) => x !== c.codigo))}
                  />{" "}
                  {c.nome}
                </label>
              ))}
            </fieldset>
            <label className="campo">
              <span>
                <input type="checkbox" checked={comReentrada} onChange={(e) => setComReentrada(e.target.checked)} /> Programar reentrada
              </span>
            </label>
            {comReentrada && (
              <div className="grade-campos">
                <Escolha rotulo="Tipo de reentrada" nome="enc-tipo" valor={tipo} aoMudar={setTipo} opcoes={opcoes(TIPOS_REENTRADA)} />
                {tipo === "TIME" ? (
                  <Campo rotulo="Data" nome="enc-data" tipo="date" valor={data} aoMudar={setData} obrigatorio />
                ) : (
                  <Campo rotulo="Quando (evento, perfil…)" nome="enc-condicao" valor={condicao} aoMudar={setCondicao} obrigatorio />
                )}
                <Campo rotulo="Motivo da reentrada" nome="enc-motivo" valor={motivo} aoMudar={setMotivo} obrigatorio />
              </div>
            )}
            <Mensagem tipo="erro">{envio.erro}</Mensagem>
            <div className="modal-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => setAberto(false)}>
                Cancelar
              </button>
              <button type="submit" className="botao" disabled={envio.enviando}>
                Encerrar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Motivos de Break da empresa, dentro das 9 categorias fixas da doutrina. */
function MotivosBreak() {
  const avisar = useAviso();
  const [itens, setItens] = useState<MotivoBreakDto[]>([]);
  const [categoria, setCategoria] = useState<string>(CATEGORIAS_BREAK[0].codigo);
  const [nome, setNome] = useState("");
  const carregar = useCallback(() => {
    get<{ itens: MotivoBreakDto[] }>("/bre/motivos").then((r) => setItens(r.itens), () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const criar = useEnvio(async () => {
    await post("/bre/motivos", { categoria, nome });
    setNome("");
    avisar("Motivo criado.");
    carregar();
  });
  const alternar = async (m: MotivoBreakDto) => {
    try {
      await patch(`/bre/motivos/${m.id}`, { arquivado: !m.arquivadoEm });
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível salvar.", "erro");
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-motivos-break">
      <h2 id="titulo-motivos-break">Motivos de Break</h2>
      <p className="dica">As categorias são da doutrina; os motivos dentro delas são da sua operação.</p>
      {CATEGORIAS_BREAK.map((c) => {
        const daCategoria = itens.filter((m) => m.categoria === c.codigo);
        if (!daCategoria.length) return null;
        return (
          <div key={c.codigo}>
            <h3>{c.nome}</h3>
            <ul className="lista">
              {daCategoria.map((m) => (
                <li key={m.id} className="item">
                  <div className="item-principal">
                    <span>
                      {m.nome}
                      {m.arquivadoEm && " · arquivado"}
                    </span>
                  </div>
                  <div className="item-acoes">
                    <button type="button" className="botao botao-secundario" onClick={() => void alternar(m)}>
                      {m.arquivadoEm ? "Restaurar" : "Arquivar"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <form className="form-linha" onSubmit={criar.enviar} aria-label="Novo motivo de Break">
        <Escolha rotulo="Categoria" nome="motivo-categoria" valor={categoria} aoMudar={setCategoria} opcoes={opcoes(CATEGORIAS_BREAK)} />
        <Campo rotulo="Novo motivo" nome="motivo-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <button type="submit" className="botao" disabled={criar.enviando}>
          Adicionar
        </button>
      </form>
      <Mensagem tipo="erro">{criar.erro}</Mensagem>
    </section>
  );
}

/** DEC-010: quanto a IA concorda com a pessoa; a automação só se libera pelo percentual da empresa. */
function Concordancia() {
  const [dados, setDados] = useState<ConcordanciaDto | null>(null);
  useEffect(() => {
    get<ConcordanciaDto>("/bre/concordancia").then(setDados, () => undefined);
  }, []);
  if (!dados) return null;
  return (
    <section className="cartao" aria-labelledby="titulo-concordancia">
      <h2 id="titulo-concordancia">IA × equipe</h2>
      <p className="dica">
        Automação liberada quando a IA concorda com a equipe em pelo menos {dados.percentualMinimo}% de {dados.amostraMinima} casos em cada campo, sem
        nenhuma sugestão barrada pelas regras.
      </p>
      <ul className="lista">
        {dados.campos.map((c) => (
          <li key={c.campo} className="item">
            <div className="item-principal">
              <strong>
                {c.nome}: {c.percentual === null ? "sem casos ainda" : `${c.percentual.toLocaleString("pt-BR")}%`}
              </strong>
              <span className="item-detalhe">
                {c.iguais} de {c.pares} casos
              </span>
            </div>
          </li>
        ))}
      </ul>
      <Mensagem tipo={dados.liberado ? "sucesso" : "info"}>{dados.liberado ? `Liberado: ${dados.motivo}` : `Ainda não liberado. ${dados.motivo}`}</Mensagem>
    </section>
  );
}

export function Bre() {
  const { pode } = useSessao();
  const fila = usePaginado<ItemFilaBreDto>("/bre/fila-do-dia?limite=30");
  useTempoReal(["bre."], () => void fila.recarregar());
  return (
    <>
      <Titulo>Motor BRE</Titulo>
      <Escalonamentos />
      <section className="cartao" aria-labelledby="titulo-fila-bre">
        <h2 id="titulo-fila-bre">Fila do dia</h2>
        <p className="dica">Só aparece quem pode ser contatado hoje: os limites de tentativas, silêncio e “não contatar” já foram aplicados.</p>
        <Mensagem tipo="erro">{fila.erro}</Mensagem>
        {!fila.carregando && !fila.itens.length && <ListaVazia>Ninguém para contatar hoje.</ListaVazia>}
        <ul className="lista">
          {fila.itens.map((i) => (
            <li key={i.id} className="item">
              <div className="item-principal">
                <strong>{i.nome}</strong>
                <span className="item-detalhe">{[nomeEstado(i.estado), i.motivo, i.telefone].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="item-acoes">
                <BotaoRegistrarBre contatoId={i.contatoId} aoRegistrar={() => void fila.recarregar()} />
              </div>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={fila.temMais} carregando={fila.carregando} aoClicar={() => void fila.carregarMais()} />
      </section>
      <Reentradas />
      <Desempenho />
      <PainelBreaks />
      {pode("bre", "administrar") && <Concordancia />}
      {pode("bre", "administrar") && <AutomacaoBre />}
      {pode("bre", "administrar") && <MotivosBreak />}
      {pode("bre", "administrar") && <Limites />}
    </>
  );
}
