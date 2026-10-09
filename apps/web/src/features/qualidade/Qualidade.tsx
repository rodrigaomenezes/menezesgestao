// Monitoramento de qualidade: avaliações recebidas/da equipe, critérios e o botão "Avaliar" usado na ligação e
// na conversa.
import { useCallback, useEffect, useState } from "react";
import type { AvaliacaoDto, CriterioDto } from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useDataHora, useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";

const nota = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Quem gerencia (escopo além do próprio) avalia atendimentos da equipe. */
export function usePodeAvaliar(): boolean {
  const eu = useEu();
  const { pode } = useSessao();
  const e = eu.permissoes.qualidade?.criar;
  return pode("qualidade", "criar") && Boolean(e && e !== "proprio");
}

export function BotaoAvaliar({ alvo, rotulo = "Avaliar" }: { alvo: { conversaId: string } | { ligacaoId: string }; rotulo?: string }) {
  const podeAvaliar = usePodeAvaliar();
  const avisar = useAviso();
  const [aberto, setAberto] = useState(false);
  const [criterios, setCriterios] = useState<CriterioDto[]>([]);
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!aberto) return;
    get<{ itens: CriterioDto[] }>("/qualidade/criterios").then((r) => {
      setCriterios(r.itens);
      setNotas(Object.fromEntries(r.itens.map((c) => [c.id, "10"])));
    }, () => undefined);
  }, [aberto]);
  const envio = useEnvio(async () => {
    const a = await post<AvaliacaoDto>("/avaliacoes", { ...alvo, notas: criterios.map((c) => ({ criterioId: c.id, nota: Number(notas[c.id]) })), feedback: feedback || null });
    avisar(`Avaliação enviada: nota ${nota(a.notaFinal)}.`);
    setAberto(false);
    setFeedback("");
  });
  if (!podeAvaliar) return null;
  return (
    <>
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        {rotulo}
      </button>
      {aberto && (
        <Modal aberto titulo="Avaliar atendimento" aoFechar={() => setAberto(false)}>
          <form onSubmit={envio.enviar}>
            {criterios.map((c) => (
              <div key={c.id} className="campo campo-nota">
                <label htmlFor={`nota-${c.id}`}>
                  {c.nome} {c.peso > 1 && <span className="item-detalhe">(peso {c.peso})</span>}
                </label>
                <select id={`nota-${c.id}`} value={notas[c.id] ?? "10"} onChange={(e) => setNotas({ ...notas, [c.id]: e.target.value })}>
                  {Array.from({ length: 11 }, (_, i) => 10 - i).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="campo">
              <label htmlFor="avaliacao-feedback">Feedback para a pessoa</label>
              <textarea id="avaliacao-feedback" rows={3} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </div>
            <Mensagem tipo="erro">{envio.erro}</Mensagem>
            <div className="modal-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => setAberto(false)}>
                Cancelar
              </button>
              <button type="submit" className="botao" disabled={envio.enviando || !criterios.length}>
                Enviar avaliação
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Criterios() {
  const avisar = useAviso();
  const [itens, setItens] = useState<CriterioDto[]>([]);
  const [nome, setNome] = useState("");
  const [peso, setPeso] = useState("1");
  const carregar = useCallback(() => {
    get<{ itens: CriterioDto[] }>("/qualidade/criterios").then((r) => setItens(r.itens), () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const envio = useEnvio(async () => {
    await post("/qualidade/criterios", { nome, peso: Number(peso) || 1, ordem: (itens.at(-1)?.ordem ?? 0) + 10 });
    setNome("");
    avisar("Critério criado.");
    carregar();
  });
  const arquivar = async (c: CriterioDto) => {
    try {
      await patch(`/qualidade/criterios/${c.id}`, { arquivar: true });
      avisar("Critério removido (avaliações antigas guardam o que foi avaliado).");
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível remover.", "erro");
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-criterios">
      <h2 id="titulo-criterios">Critérios</h2>
      <ul className="lista">
        {itens.map((c) => (
          <li key={c.id} className="item">
            <div className="item-principal">
              <strong>{c.nome}</strong>
              <span className="item-detalhe">Peso {c.peso}</span>
            </div>
            <div className="item-acoes">
              <button type="button" className="botao botao-secundario" onClick={() => void arquivar(c)}>
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form className="form-linha" onSubmit={envio.enviar} aria-label="Novo critério">
        <Campo rotulo="Novo critério" nome="criterio-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Campo rotulo="Peso (1 a 10)" nome="criterio-peso" tipo="number" valor={peso} aoMudar={setPeso} />
        <button type="submit" className="botao" disabled={envio.enviando}>
          Adicionar
        </button>
      </form>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
    </section>
  );
}

export function Qualidade() {
  const eu = useEu();
  const { pode } = useSessao();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const lista = usePaginado<AvaliacaoDto>("/avaliacoes?limite=30");
  useTempoReal(["avaliacao."], () => void lista.recarregar());
  const lida = async (a: AvaliacaoDto) => {
    try {
      await post(`/avaliacoes/${a.id}/lida`);
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível marcar.", "erro");
    }
  };
  return (
    <>
      <Titulo>Qualidade</Titulo>
      <section className="cartao" aria-labelledby="titulo-avaliacoes">
        <h2 id="titulo-avaliacoes">Avaliações</h2>
        <p className="dica">Para avaliar, abra a ligação (em Ligações) ou a conversa e use “Avaliar”.</p>
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma avaliação ainda.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((a) => (
            <li key={a.id} className={`item ${a.avaliadoId === eu.usuario.id && !a.lidaEm ? "item-nao-lido" : ""}`}>
              <div className="item-principal">
                <strong>
                  Nota {nota(a.notaFinal)} · {a.avaliadoNome}
                </strong>
                <span className="item-detalhe">
                  {a.ligacaoId ? "Ligação" : "Conversa"}
                  {a.contatoNome && ` com ${a.contatoNome}`} · por {a.avaliadorNome} · {dataHora(a.criadoEm)}
                </span>
                <span className="item-detalhe">{a.notas.map((n) => `${n.nome}: ${nota(n.nota)}`).join(" · ")}</span>
                {a.feedback && <p className="texto-livre">{a.feedback}</p>}
              </div>
              {a.avaliadoId === eu.usuario.id && !a.lidaEm && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => void lida(a)}>
                    Li o feedback
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
      {pode("qualidade", "administrar") && <Criterios />}
    </>
  );
}
