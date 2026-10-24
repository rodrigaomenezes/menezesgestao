// Rotina diária em blocos do Início: ponto, check-list do perfil e o que está pendente hoje nos outros módulos.
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
import { useDataHora } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { ListaVazia } from "../../ui/ui";
import { horaNoFuso, useFuso } from "./comum";
import { useVocabulario } from "../../app/vocabulario";

/** Barra de progresso de uma meta (realizado / meta). */
export function ProgressoMeta({ m }: { m: MetaDto }) {
  const termos = useVocabulario();
  const rotulo = `${termos.t(NOMES_INDICADORES[m.indicador])} — ${m.alvoNome}`;
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

/** Os dados do dia (uma consulta para todos os blocos da rotina), atualizados em tempo real. */
export function useRotina(ativa: boolean) {
  const avisar = useAviso();
  const [r, setR] = useState<RotinaDto | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    if (!ativa) return;
    get<RotinaDto>("/rotina")
      .then((d) => (setR(d), setErro("")))
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar a rotina."));
  }, [ativa]);
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
  return { r, erro, marcar };
}

export function BlocoChecklist({ r, marcar }: { r: RotinaDto; marcar(itemId: string, feito: boolean): Promise<void> }) {
  const feitos = r.checklist.filter((i) => i.feito).length;
  if (!r.checklist.length) return <ListaVazia>Nenhum item no check-list do seu perfil.</ListaVazia>;
  return (
    <>
      <span className="selo">
        {feitos}/{r.checklist.length} feitos
      </span>
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
    </>
  );
}

export function BlocoMetas({ r }: { r: RotinaDto }) {
  if (!r.metas?.length) return <ListaVazia>Nenhuma meta para você agora.</ListaVazia>;
  return (
    <>
      {r.metas.map((m) => (
        // A meta leva ao painel de desempenho do indicador, no período dela (e da pessoa, se for de alguém).
        <Link
          key={m.id}
          className="link-bloco"
          to={`/desempenho?inicio=${m.inicioPeriodo}&fim=${m.fimPeriodo}&indicador=${m.indicador}${m.alvo === "pessoa" && m.usuarioId ? `&usuarioId=${m.usuarioId}` : ""}`}
        >
          <ProgressoMeta m={m} />
        </Link>
      ))}
    </>
  );
}

export function BlocoAgenda({ r }: { r: RotinaDto }) {
  const fuso = useFuso();
  if (!r.compromissos?.length) return <ListaVazia>Nada marcado para hoje.</ListaVazia>;
  return (
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
  );
}

export function BlocoTarefas({ r }: { r: RotinaDto }) {
  const dataHora = useDataHora();
  if (!r.tarefas) return null;
  return (
    <>
      {(r.tarefas.vencidas > 0 || r.tarefas.hoje > 0) && (
        <p className="selos">
          {r.tarefas.vencidas > 0 && <span className="selo selo-perdida">{r.tarefas.vencidas} vencida(s)</span>}
          {r.tarefas.hoje > 0 && <span className="selo">{r.tarefas.hoje} para hoje</span>}
        </p>
      )}
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
    </>
  );
}

export function BlocoRetornos({ r }: { r: RotinaDto }) {
  const dataHora = useDataHora();
  if (!r.retornos?.length) return <ListaVazia>Nenhum retorno agendado para hoje.</ListaVazia>;
  return (
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
  );
}

export function BlocoConversas({ r }: { r: RotinaDto }) {
  const dataHora = useDataHora();
  if (!r.conversas?.length) return <ListaVazia>Ninguém esperando por você.</ListaVazia>;
  return (
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
  );
}
