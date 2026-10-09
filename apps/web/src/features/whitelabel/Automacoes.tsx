// Automações "quando [evento] e se [condição], então [ação]".
import { useCallback, useEffect, useState } from "react";
import {
  ACOES_AUTOMACAO,
  CAMPOS_CONDICAO,
  GATILHOS,
  NOMES_ACOES_AUTOMACAO,
  NOMES_OPERADORES,
  type RegraAutomacaoDto,
} from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useAviso } from "../../ui/sobreposicoes";
import { BotaoAlternar, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { useConfigCrm } from "../crm/comum";

const nomeGatilho = (id: string) => GATILHOS.find((g) => g.id === id)?.nome ?? id;

function NovaRegra({ aoCriar }: { aoCriar(): void }) {
  const { config } = useConfigCrm();
  const avisar = useAviso();
  const [canais, setCanais] = useState<{ id: string; nome: string }[]>([]);
  const [nome, setNome] = useState("");
  const [gatilho, setGatilho] = useState<string>(GATILHOS[1].id);
  const [campo, setCampo] = useState("");
  const [operador, setOperador] = useState("");
  const [valor, setValor] = useState("");
  const [acao, setAcao] = useState<string>("criar_tarefa");
  const [titulo, setTitulo] = useState("");
  const [horas, setHoras] = useState("24");
  const [etapaId, setEtapaId] = useState("");
  const [texto, setTexto] = useState("");
  const [canalId, setCanalId] = useState("");
  useEffect(() => {
    get<{ id: string; nome: string }[]>("/canais").then(setCanais, () => undefined);
  }, []);
  const etapas = config.funis.flatMap((f) => f.etapas.map((e) => ({ valor: e.id, texto: `${f.nome} › ${e.nome}` })));
  const camposDoGatilho = [...(GATILHOS.find((g) => g.id === gatilho)?.campos ?? []), "contato.etiqueta", "contato.responsavel"];
  const operadores = campo ? CAMPOS_CONDICAO[campo].operadores : [];
  const precisaValor = operador && !["vazio", "preenchido"].includes(operador);

  const envio = useEnvio(async () => {
    await post("/automacoes-regras", {
      nome,
      gatilho,
      condicoes: campo && operador ? [{ campo, operador, ...(precisaValor ? { valor } : {}) }] : [],
      acao,
      parametros: {
        ...(acao === "criar_tarefa" ? { titulo, horas: Number(horas) || 0 } : {}),
        ...(acao === "mover_etapa" ? { etapaId } : {}),
        ...(acao === "avisar" || acao === "enviar_mensagem" ? { texto } : {}),
        ...(acao === "enviar_mensagem" ? { canalId } : {}),
      },
    });
    avisar("Automação criada. Ela vale para o que acontecer daqui em diante.");
    aoCriar();
  });

  const opcoesValor =
    campo === "etapaNovaId"
      ? etapas
      : campo === "contato.etiqueta"
        ? config.etiquetas.map((e) => ({ valor: e.id, texto: e.nome }))
        : campo === "atendida"
          ? [
              { valor: "sim", texto: "Sim" },
              { valor: "nao", texto: "Não" },
            ]
          : null;

  return (
    <form className="cartao" onSubmit={envio.enviar} aria-label="Nova automação">
      <Campo rotulo="Nome" nome="auto-nome" valor={nome} aoMudar={setNome} obrigatorio />
      <fieldset>
        <legend>Quando</legend>
        <Escolha rotulo="Acontecer" nome="auto-gatilho" valor={gatilho} aoMudar={(v) => (setGatilho(v), setCampo(""), setOperador(""))} opcoes={GATILHOS.map((g) => ({ valor: g.id, texto: g.nome }))} />
      </fieldset>
      <fieldset>
        <legend>Se (opcional)</legend>
        <div className="grade-campos">
          <Escolha
            rotulo="Condição"
            nome="auto-campo"
            valor={campo}
            aoMudar={(v) => (setCampo(v), setOperador(v ? CAMPOS_CONDICAO[v].operadores[0] : ""), setValor(""))}
            vazio="Sempre"
            opcoes={camposDoGatilho.map((c) => ({ valor: c, texto: CAMPOS_CONDICAO[c].nome }))}
          />
          {campo && <Escolha rotulo="Como" nome="auto-operador" valor={operador} aoMudar={setOperador} opcoes={operadores.map((o) => ({ valor: o, texto: NOMES_OPERADORES[o] }))} />}
          {precisaValor &&
            (opcoesValor ? (
              <Escolha rotulo="Valor" nome="auto-valor" valor={valor} aoMudar={setValor} vazio="Escolha" obrigatorio opcoes={opcoesValor} />
            ) : (
              <Campo rotulo="Valor" nome="auto-valor" valor={valor} aoMudar={setValor} obrigatorio />
            ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Então</legend>
        <Escolha rotulo="Ação" nome="auto-acao" valor={acao} aoMudar={setAcao} opcoes={ACOES_AUTOMACAO.map((a) => ({ valor: a, texto: NOMES_ACOES_AUTOMACAO[a] }))} />
        {acao === "criar_tarefa" && (
          <div className="grade-campos">
            <Campo rotulo="Título da tarefa" nome="auto-titulo" valor={titulo} aoMudar={setTitulo} obrigatorio dica="Use {nome} para o primeiro nome do contato." />
            <Campo rotulo="Prazo (horas)" nome="auto-horas" tipo="number" valor={horas} aoMudar={setHoras} />
          </div>
        )}
        {acao === "mover_etapa" && <Escolha rotulo="Etapa" nome="auto-etapa" valor={etapaId} aoMudar={setEtapaId} vazio="Escolha" obrigatorio opcoes={etapas} />}
        {acao === "enviar_mensagem" && (
          <Escolha rotulo="Canal" nome="auto-canal" valor={canalId} aoMudar={setCanalId} vazio="Escolha" obrigatorio opcoes={canais.map((c) => ({ valor: c.id, texto: c.nome }))} />
        )}
        {(acao === "avisar" || acao === "enviar_mensagem") && (
          <div className="campo">
            <label htmlFor="auto-texto">{acao === "avisar" ? "Texto do aviso" : "Mensagem"}</label>
            <textarea id="auto-texto" rows={3} maxLength={1000} required value={texto} onChange={(e) => setTexto(e.target.value)} />
            <small className="dica">Use {"{nome}"} e {"{empresa}"}. Quem marcou “não contatar” não recebe mensagem.</small>
          </div>
        )}
      </fieldset>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Criar automação
      </button>
    </form>
  );
}

export function Automacoes() {
  const { pode } = useSessao();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const [regras, setRegras] = useState<RegraAutomacaoDto[]>([]);
  const [nova, setNova] = useState(false);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<{ itens: RegraAutomacaoDto[] }>("/automacoes-regras").then((r) => setRegras(r.itens), (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, []);
  useEffect(carregar, [carregar]);
  const mudar = async (r: RegraAutomacaoDto, corpo: object, aviso: string) => {
    try {
      await patch(`/automacoes-regras/${r.id}`, corpo);
      avisar(aviso);
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    }
  };
  const podeEditar = pode("configuracoes", "editar");
  return (
    <>
      <Titulo acao={podeEditar && <BotaoAlternar aberto={nova} aoMudar={setNova} texto="Nova automação" />}>Automações</Titulo>
      {nova && <NovaRegra aoCriar={() => (setNova(false), carregar())} />}
      <section className="cartao">
        <p className="dica">As automações rodam sozinhas, em até um minuto depois do que aconteceu. Ações feitas por uma automação não disparam outras.</p>
        <Mensagem tipo="erro">{erro}</Mensagem>
        {!regras.length && <ListaVazia>Nenhuma automação ainda.</ListaVazia>}
        <ul className="lista">
          {regras.map((r) => (
            <li key={r.id} className="item">
              <div className="item-principal">
                <strong>
                  {r.nome} {!r.ativa && <span className="selo">desligada</span>}
                </strong>
                <span className="item-detalhe">
                  Quando: {nomeGatilho(r.gatilho)}
                  {r.condicoes.length > 0 && ` · se ${r.condicoes.map((c) => `${CAMPOS_CONDICAO[c.campo]?.nome ?? c.campo} ${NOMES_OPERADORES[c.operador] ?? c.operador}`).join(" e ")}`} · então: {NOMES_ACOES_AUTOMACAO[r.acao]}
                </span>
                <span className="item-detalhe">
                  {r.execucoes} execução(ões){r.ultimaExecucao && ` · última em ${dataHora(r.ultimaExecucao)}`}
                </span>
              </div>
              {podeEditar && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => void mudar(r, { ativa: !r.ativa }, r.ativa ? "Automação desligada." : "Automação ligada.")}>
                    {r.ativa ? "Desligar" : "Ligar"}
                  </button>
                  <button type="button" className="botao botao-secundario" onClick={() => void mudar(r, { arquivar: true }, "Automação arquivada.")}>
                    Arquivar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
