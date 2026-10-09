// Rotina diária: ponto, check-list do perfil e o que está pendente hoje nos outros módulos.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  NOMES_INDICADORES,
  NOMES_PERIODOS,
  formatarIndicador,
  formatarMinutos,
  formatarTelefone,
  type MetaDto,
  type RegistroHorasDto,
  type RotinaDto,
} from "@mg/shared";
import { ErroApi, get, post, put } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { ListaVazia, Mensagem } from "../../ui/ui";
import { horaNoFuso, useFuso } from "./comum";

/** Barra de progresso de uma meta (realizado / meta). */
export function ProgressoMeta({ m }: { m: MetaDto }) {
  const rotulo = `${NOMES_INDICADORES[m.indicador]} — ${m.alvoNome}`;
  return (
    <div className="meta">
      <div className="meta-topo">
        <span>{rotulo}</span>
        <strong>
          {formatarIndicador(m.indicador, m.realizado)} de {formatarIndicador(m.indicador, m.valor)}
        </strong>
      </div>
      <progress max={100} value={Math.min(100, m.percentual)} aria-label={`${rotulo}: ${m.percentual}%`} />
      <span className="item-detalhe">
        {NOMES_PERIODOS[m.periodo]} · {m.percentual}%
      </span>
    </div>
  );
}

/** Botão de ponto: registra entrada ou saída. */
export function Ponto({ aoMudar }: { aoMudar?(): void }) {
  const fuso = useFuso();
  const avisar = useAviso();
  const [aberto, setAberto] = useState<RegistroHorasDto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(() => {
    get<{ registro: RegistroHorasDto | null }>("/horas/ponto").then((r) => setAberto(r.registro), () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  const bater = async () => {
    setOcupado(true);
    try {
      const r = await post<RegistroHorasDto>("/horas/ponto");
      avisar(r.status === "aberto" ? `Entrada registrada às ${horaNoFuso(r.entrada, fuso)}.` : `Saída registrada: ${formatarMinutos(r.minutos ?? 0)} trabalhadas.`);
      carregar();
      aoMudar?.();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível registrar o ponto.", "erro");
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="ponto">
      <span>{aberto ? `Trabalhando desde ${horaNoFuso(aberto.entrada, fuso)}` : "Ponto fechado"}</span>
      <button type="button" className={`botao ${aberto ? "botao-secundario" : ""}`} disabled={ocupado} onClick={() => void bater()}>
        {aberto ? "Registrar saída" : "Registrar entrada"}
      </button>
    </div>
  );
}

export function Rotina() {
  const { pode } = useSessao();
  const dataHora = useDataHora();
  const fuso = useFuso();
  const avisar = useAviso();
  const [r, setR] = useState<RotinaDto | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<RotinaDto>("/rotina")
      .then((d) => (setR(d), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar a rotina."));
  }, []);
  useEffect(carregar, [carregar]);
  useTempoReal(["tarefa.", "fila.", "conversa.", "mensagem.", "compromisso.", "meta.", "checklist.", "ligacao.encerrada", "oportunidade."], carregar);

  const marcar = async (itemId: string, feito: boolean) => {
    setR((a) => (a ? { ...a, checklist: a.checklist.map((i) => (i.itemId === itemId ? { ...i, feito } : i)) } : a));
    try {
      await put(`/rotina/checklist/${itemId}`, { feito });
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível marcar.", "erro");
      carregar();
    }
  };

  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!r) return <p className="carregando">Carregando a rotina…</p>;
  const feitos = r.checklist.filter((i) => i.feito).length;

  return (
    <div className="rotina">
      {pode("agenda", "criar") && (
        <section className="cartao" aria-label="Ponto">
          <Ponto />
        </section>
      )}

      {r.checklist.length > 0 && (
        <section className="cartao" aria-labelledby="titulo-checklist">
          <h2 id="titulo-checklist">
            Check-list de hoje{" "}
            <span className="selo">
              {feitos}/{r.checklist.length}
            </span>
          </h2>
          <ul className="lista-simples checklist">
            {r.checklist.map((i) => (
              <li key={i.itemId}>
                <label className={`marcar ${i.feito ? "riscado" : ""}`}>
                  <input type="checkbox" checked={i.feito} onChange={(e) => void marcar(i.itemId, e.target.checked)} />
                  {i.texto}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.metas && r.metas.length > 0 && (
        <section className="cartao" aria-labelledby="titulo-metas">
          <h2 id="titulo-metas">Minhas metas</h2>
          {r.metas.map((m) => (
            <ProgressoMeta key={m.id} m={m} />
          ))}
        </section>
      )}

      {r.compromissos && (
        <section className="cartao" aria-labelledby="titulo-compromissos">
          <h2 id="titulo-compromissos">Compromissos de hoje</h2>
          {!r.compromissos.length && <ListaVazia>Nada marcado para hoje.</ListaVazia>}
          <ul className="lista">
            {r.compromissos.map((c) => (
              <li key={c.id} className="item">
                <div className="item-principal">
                  <strong>
                    {horaNoFuso(c.inicio, fuso)} — {c.titulo}
                  </strong>
                  <span className="item-detalhe">
                    {c.local ?? ""}
                    {c.contatoId && (
                      <>
                        {c.local ? " · " : ""}
                        <Link to={`/contatos/${c.contatoId}`}>{c.contatoNome}</Link>
                      </>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.tarefas && (
        <section className="cartao" aria-labelledby="titulo-tarefas-hoje">
          <h2 id="titulo-tarefas-hoje">
            Tarefas {r.tarefas.vencidas > 0 && <span className="selo selo-perdida">{r.tarefas.vencidas} vencida(s)</span>}{" "}
            {r.tarefas.hoje > 0 && <span className="selo">{r.tarefas.hoje} para hoje</span>}
          </h2>
          {!r.tarefas.itens.length && <ListaVazia>Nenhuma tarefa vencida ou para hoje.</ListaVazia>}
          <ul className="lista">
            {r.tarefas.itens.map((t) => (
              <li key={t.id} className="item">
                <div className="item-principal">
                  <strong>{t.titulo}</strong>
                  <span className="item-detalhe">
                    {t.venceEm && `Vence ${dataHora(t.venceEm)}`}
                    {t.contatoId && (
                      <>
                        {" · "}
                        <Link to={`/contatos/${t.contatoId}`}>{t.contatoNome}</Link>
                      </>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/tarefas">Ver todas as tarefas</Link>
        </section>
      )}

      {r.retornos && (
        <section className="cartao" aria-labelledby="titulo-retornos">
          <h2 id="titulo-retornos">Retornos da fila</h2>
          {!r.retornos.length && <ListaVazia>Nenhum retorno agendado para hoje.</ListaVazia>}
          <ul className="lista">
            {r.retornos.map((x) => (
              <li key={x.itemId} className="item">
                <div className="item-principal">
                  <Link to={`/contatos/${x.contatoId}`}>
                    <strong>{x.contatoNome}</strong>
                  </Link>
                  <span className="item-detalhe">
                    {dataHora(x.retornarEm)} · <Link to={`/filas/${x.filaId}`}>{x.filaNome}</Link>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.conversas && (
        <section className="cartao" aria-labelledby="titulo-sem-resposta">
          <h2 id="titulo-sem-resposta">Conversas esperando resposta</h2>
          {!r.conversas.length && <ListaVazia>Ninguém esperando por você.</ListaVazia>}
          <ul className="lista">
            {r.conversas.map((c) => (
              <li key={c.id} className="item">
                <div className="item-principal">
                  <Link to={`/conversas/${c.id}`}>
                    <strong>{c.contatoNome ?? formatarTelefone(c.telefone)}</strong>
                  </Link>
                  <span className="item-detalhe">
                    {c.ultimaEntradaEm && dataHora(c.ultimaEntradaEm)} · {c.ultimaMensagem}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
