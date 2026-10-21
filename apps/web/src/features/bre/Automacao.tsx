// Automação do método BRE (fase 8.4): pós-venda, aniversário e reentrada do dia por modelo de texto. Ligar exige o
// painel IA × equipe liberado; o servidor confere e explica quando ainda não pode.
import { useCallback, useEffect, useState } from "react";
import { TIPOS_AUTOMACAO_BRE, type AutomacaoBreDto, type CampoPersonalizadoDto, type ExecucaoAutomacaoBreDto } from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useDataHora } from "../../app/sessao";
import { useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, Escolha, ListaVazia, Mensagem, useEnvio, usePaginado } from "../../ui/ui";

interface CanalResumo {
  id: string;
  nome: string;
}

const nomeTipo = (t: string) => TIPOS_AUTOMACAO_BRE.find((x) => x.codigo === t)?.nome ?? t;

function NovaAutomacao({ canais, camposData, aoCriar }: { canais: CanalResumo[]; camposData: CampoPersonalizadoDto[]; aoCriar(): void }) {
  const [tipo, setTipo] = useState<string>("POS_VENDA");
  const [nome, setNome] = useState("");
  const [canalId, setCanalId] = useState("");
  const [texto, setTexto] = useState("Oi {nome}, tudo certo com a sua compra?");
  const [dias, setDias] = useState("2");
  const [campo, setCampo] = useState("");
  const envio = useEnvio(async () => {
    await post("/bre/automacoes", {
      tipo,
      nome,
      canalId: canalId || canais[0]?.id,
      texto,
      dias: tipo === "POS_VENDA" ? Number(dias) : null,
      campoChave: tipo === "ANIVERSARIO" ? campo || camposData[0]?.chave : null,
    });
    setNome("");
    aoCriar();
  });
  const ajuda = TIPOS_AUTOMACAO_BRE.find((t) => t.codigo === tipo)?.ajuda;
  if (!canais.length) return <p className="dica">Conecte um canal de WhatsApp em “Canais e automações” para criar automações.</p>;
  return (
    <form onSubmit={envio.enviar} aria-label="Nova automação">
      <div className="grade-campos">
        <Escolha rotulo="Tipo" nome="auto-tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS_AUTOMACAO_BRE.map((t) => ({ valor: t.codigo, texto: t.nome }))} />
        <Campo rotulo="Nome" nome="auto-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Escolha rotulo="Canal" nome="auto-canal" valor={canalId || canais[0]!.id} aoMudar={setCanalId} opcoes={canais.map((c) => ({ valor: c.id, texto: c.nome }))} />
        {tipo === "POS_VENDA" && <Campo rotulo="Dias depois da venda" nome="auto-dias" tipo="number" valor={dias} aoMudar={setDias} obrigatorio />}
        {tipo === "ANIVERSARIO" &&
          (camposData.length ? (
            <Escolha rotulo="Campo da data" nome="auto-campo" valor={campo || camposData[0]!.chave} aoMudar={setCampo} opcoes={camposData.map((c) => ({ valor: c.chave, texto: c.rotulo }))} />
          ) : (
            <p className="dica">Crie um campo de data no cadastro (Configurar CRM → Campos personalizados).</p>
          ))}
      </div>
      {ajuda && <p className="dica">{ajuda}</p>}
      <div className="campo">
        <label htmlFor="auto-texto">Mensagem</label>
        <textarea id="auto-texto" rows={3} maxLength={1000} required value={texto} onChange={(e) => setTexto(e.target.value)} />
        <span className="item-detalhe">Use {"{nome}"}, {"{vendedor}"} e {"{empresa}"}. Nasce desligada.</span>
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Criar automação
      </button>
    </form>
  );
}

export function AutomacaoBre() {
  const avisar = useAviso();
  const dataHora = useDataHora();
  const [itens, setItens] = useState<AutomacaoBreDto[]>([]);
  const [canais, setCanais] = useState<CanalResumo[]>([]);
  const [campos, setCampos] = useState<CampoPersonalizadoDto[]>([]);
  const execucoes = usePaginado<ExecucaoAutomacaoBreDto>("/bre/automacoes/execucoes?limite=20");
  const carregar = useCallback(() => {
    get<{ itens: AutomacaoBreDto[] }>("/bre/automacoes").then((r) => setItens(r.itens), () => undefined);
  }, []);
  useEffect(() => {
    carregar();
    get<CanalResumo[]>("/canais/ativos").then(setCanais, () => setCanais([]));
    get<CampoPersonalizadoDto[]>("/crm/campos").then((c) => setCampos(c.filter((x) => x.entidade === "contato" && x.tipo === "data" && !x.arquivadoEm)), () => undefined);
  }, [carregar]);
  const alterar = async (a: AutomacaoBreDto, mudanca: { ativa?: boolean; arquivado?: boolean }) => {
    try {
      await patch(`/bre/automacoes/${a.id}`, mudanca);
      avisar(mudanca.ativa === true ? "Automação ligada." : mudanca.ativa === false ? "Automação desligada." : "Automação atualizada.");
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível salvar.", "erro");
    }
  };
  const rodar = useEnvio(async () => {
    const r = await post<{ enviadas: number; ignoradas: number; pausada: string | null }>("/bre/automacoes/executar");
    avisar(r.pausada ? `Nada foi enviado: ${r.pausada}` : `${r.enviadas} enviada(s), ${r.ignoradas} pulada(s).`, r.pausada ? "erro" : undefined);
    void execucoes.recarregar();
  });
  const nomeCanal = (id: string) => canais.find((c) => c.id === id)?.nome ?? "canal";
  return (
    <section className="cartao" aria-labelledby="titulo-automacao-bre">
      <h2 id="titulo-automacao-bre">Automação</h2>
      <p className="dica">
        Só o que o método permite automatizar. Respeita “não contatar”, escalonamento aberto e os limites de contato, e nunca manda a mesma mensagem duas
        vezes. Roda todo dia de manhã.
      </p>
      {!itens.length && <ListaVazia>Nenhuma automação ainda.</ListaVazia>}
      <ul className="lista">
        {itens.map((a) => (
          <li key={a.id} className="item">
            <div className="item-principal">
              <strong>
                {a.nome} · {a.ativa ? "ligada" : a.arquivadoEm ? "arquivada" : "desligada"}
              </strong>
              <span className="item-detalhe">
                {nomeTipo(a.tipo)}
                {a.dias !== null && ` D+${a.dias}`} · {nomeCanal(a.canalId)}
              </span>
              <span className="item-detalhe">{a.texto}</span>
            </div>
            <div className="item-acoes">
              {!a.arquivadoEm && (
                <button type="button" className="botao botao-secundario" onClick={() => void alterar(a, { ativa: !a.ativa })}>
                  {a.ativa ? "Desligar" : "Ligar"}
                </button>
              )}
              <button type="button" className="botao botao-secundario" onClick={() => void alterar(a, { arquivado: !a.arquivadoEm })}>
                {a.arquivadoEm ? "Restaurar" : "Arquivar"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <NovaAutomacao canais={canais} camposData={campos} aoCriar={carregar} />
      {itens.some((a) => a.ativa) && (
        <p>
          <button type="button" className="botao botao-secundario" disabled={rodar.enviando} onClick={() => void rodar.enviar()}>
            {rodar.enviando ? "Rodando…" : "Rodar agora"}
          </button>
        </p>
      )}
      <Mensagem tipo="erro">{rodar.erro}</Mensagem>
      <h3>Últimos envios</h3>
      {!execucoes.carregando && !execucoes.itens.length && <ListaVazia>Nada enviado ainda.</ListaVazia>}
      <ul className="lista">
        {execucoes.itens.map((x) => (
          <li key={x.id} className="item">
            <div className="item-principal">
              <span>
                {x.contatoNome} · {x.automacaoNome} · {x.status === "enviada" ? "enviada" : "pulada"}
              </span>
              <span className="item-detalhe">
                {dataHora(x.criadoEm)}
                {x.detalhe && ` · ${x.detalhe}`}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <CarregarMais visivel={execucoes.temMais} carregando={execucoes.carregando} aoClicar={() => void execucoes.carregarMais()} />
    </section>
  );
}
