// Horas: ponto e lançamentos da pessoa; validação e escala da equipe; fechamento do mês (trava o período).
import { useEffect, useState } from "react";
import {
  DIAS_SEMANA,
  NOMES_STATUS_HORAS,
  formatarMinutos,
  type EscalaDto,
  type FechamentoDto,
  type RegistroHorasDto,
  type ResumoHorasDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, put, query } from "../../app/api";
import { useDataHora, useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { hojeNoFuso, horaNoFuso, instante, mesAtual, nomeDoMes, somarMeses, useFuso } from "./comum";
import { Ponto } from "./Rotina";

const SELO_STATUS: Record<string, string> = { validado: "selo-ganha", recusado: "selo-perdida" };

function SeletorMes({ mes, aoMudar }: { mes: string; aoMudar(m: string): void }) {
  return (
    <div className="navegar-periodo">
      <button type="button" className="botao botao-secundario" aria-label="Mês anterior" onClick={() => aoMudar(somarMeses(mes, -1))}>
        ←
      </button>
      <strong>{nomeDoMes(mes)}</strong>
      <button type="button" className="botao botao-secundario" aria-label="Próximo mês" onClick={() => aoMudar(somarMeses(mes, 1))}>
        →
      </button>
    </div>
  );
}

function FormHoras({ inicial, aoSalvar, aoCancelar }: { inicial?: RegistroHorasDto; aoSalvar(): void; aoCancelar?(): void }) {
  const fuso = useFuso();
  const avisar = useAviso();
  const sufixo = inicial?.id ?? "novo";
  const [dia, setDia] = useState(inicial?.data ?? hojeNoFuso(fuso));
  const [entrada, setEntrada] = useState(inicial ? horaNoFuso(inicial.entrada, fuso) : "08:00");
  const [saida, setSaida] = useState(inicial?.saida ? horaNoFuso(inicial.saida, fuso) : "17:00");
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const envio = useEnvio(async () => {
    const corpo = { entrada: instante(dia, entrada), saida: instante(dia, saida), observacao: observacao || null };
    if (inicial) await patch(`/horas/${inicial.id}`, corpo);
    else await post("/horas", corpo);
    avisar(inicial ? "Registro corrigido. Ele volta para validação." : "Horas lançadas. Agora é só aguardar a validação.");
    aoSalvar();
  });
  return (
    <form className="form-horas" onSubmit={envio.enviar} aria-label={inicial ? "Corrigir registro" : "Lançar horas"}>
      <div className="grade-campos">
        <Campo rotulo="Dia" nome={`horas-dia-${sufixo}`} tipo="date" valor={dia} aoMudar={setDia} obrigatorio />
        <Campo rotulo="Entrada" nome={`horas-entrada-${sufixo}`} tipo="time" valor={entrada} aoMudar={setEntrada} obrigatorio />
        <Campo rotulo="Saída" nome={`horas-saida-${sufixo}`} tipo="time" valor={saida} aoMudar={setSaida} obrigatorio />
        <Campo rotulo="Observação" nome={`horas-obs-${sufixo}`} valor={observacao} aoMudar={setObservacao} />
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <div className="form-linha">
        <button type="submit" className="botao" disabled={envio.enviando}>
          {envio.enviando ? "Salvando…" : inicial ? "Salvar correção" : "Lançar"}
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

function LinhaRegistro({ r, mostrarPessoa, acoes }: { r: RegistroHorasDto; mostrarPessoa?: boolean; acoes?: React.ReactNode }) {
  const fuso = useFuso();
  return (
    <li className="item">
      <div className="item-principal">
        <strong>
          {mostrarPessoa && `${r.usuarioNome} · `}
          {new Date(`${r.data}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" })} · {horaNoFuso(r.entrada, fuso)}–{r.saida ? horaNoFuso(r.saida, fuso) : "…"}
          {r.minutos !== null && ` (${formatarMinutos(r.minutos)})`}
        </strong>
        <span className="item-detalhe">
          <span className={`selo ${SELO_STATUS[r.status] ?? ""}`}>{NOMES_STATUS_HORAS[r.status]}</span>
          {r.fechado && <span className="selo">Mês fechado</span>}
          {r.observacao && ` ${r.observacao}`}
          {r.status === "recusado" && r.motivo && ` · Motivo: ${r.motivo}`}
          {r.validadoPorNome && r.status === "validado" && ` · por ${r.validadoPorNome}`}
        </span>
      </div>
      {acoes && <div className="item-acoes">{acoes}</div>}
    </li>
  );
}

function MinhasHoras({ mes }: { mes: string }) {
  const eu = useEu();
  const { pode } = useSessao();
  const avisar = useAviso();
  const [lancar, setLancar] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const lista = usePaginado<RegistroHorasDto>(`/horas${query({ mes, usuarioId: eu.usuario.id, limite: 50 })}`);
  useTempoReal(["horas."], () => void lista.recarregar());
  const arquivar = async (r: RegistroHorasDto) => {
    try {
      await patch(`/horas/${r.id}`, { arquivar: true });
      avisar("Registro arquivado.");
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível arquivar.", "erro");
    }
  };
  return (
    <section className="cartao" aria-label="Minhas horas">
      {pode("agenda", "criar") && <Ponto aoMudar={() => void lista.recarregar()} />}
      {pode("agenda", "criar") && (
        <button type="button" className="link-secundario" aria-expanded={lancar} onClick={() => setLancar(!lancar)}>
          {lancar ? "Fechar lançamento" : "Esqueceu de bater o ponto? Lance as horas"}
        </button>
      )}
      {lancar && <FormHoras aoSalvar={() => (setLancar(false), void lista.recarregar())} />}
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhum registro neste mês.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((r) =>
          editando === r.id ? (
            <li key={r.id}>
              <FormHoras inicial={r} aoSalvar={() => (setEditando(null), void lista.recarregar())} aoCancelar={() => setEditando(null)} />
            </li>
          ) : (
            <LinhaRegistro
              key={r.id}
              r={r}
              acoes={
                !r.fechado &&
                r.status !== "validado" &&
                r.status !== "aberto" &&
                pode("agenda", "editar") && (
                  <>
                    <button type="button" className="botao botao-secundario" onClick={() => setEditando(r.id)}>
                      Corrigir
                    </button>
                    <button type="button" className="botao botao-secundario" onClick={() => void arquivar(r)}>
                      Arquivar
                    </button>
                  </>
                )
              }
            />
          ),
        )}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

function EditorEscala({ pessoa, aoFechar }: { pessoa: { id: string; nome: string }; aoFechar(): void }) {
  const avisar = useAviso();
  const [intervalos, setIntervalos] = useState<EscalaDto["intervalos"] | null>(null);
  useEffect(() => {
    get<EscalaDto>(`/escalas/${pessoa.id}`).then((e) => setIntervalos(e.intervalos), () => setIntervalos([]));
  }, [pessoa.id]);
  const envio = useEnvio(async () => {
    await put(`/escalas/${pessoa.id}`, { intervalos });
    avisar("Escala salva.");
    aoFechar();
  });
  const mudar = (i: number, campo: "diaSemana" | "inicio" | "fim", valor: string) =>
    setIntervalos((a) => a?.map((x, j) => (j === i ? { ...x, [campo]: campo === "diaSemana" ? Number(valor) : valor } : x)) ?? null);
  return (
    <Modal aberto titulo={`Escala de ${pessoa.nome}`} aoFechar={aoFechar}>
      {!intervalos ? (
        <p className="carregando">Carregando…</p>
      ) : (
        <form onSubmit={envio.enviar}>
          {!intervalos.length && <ListaVazia>Sem escala. Adicione os horários de trabalho da semana.</ListaVazia>}
          {intervalos.map((x, i) => (
            <div key={i} className="linha-escala" role="group" aria-label={`Horário ${i + 1}`}>
              <select aria-label="Dia da semana" value={x.diaSemana} onChange={(e) => mudar(i, "diaSemana", e.target.value)}>
                {DIAS_SEMANA.map((d, n) => (
                  <option key={d} value={n}>
                    {d}
                  </option>
                ))}
              </select>
              <input aria-label="Início" type="time" required value={x.inicio} onChange={(e) => mudar(i, "inicio", e.target.value)} />
              <input aria-label="Fim" type="time" required value={x.fim} onChange={(e) => mudar(i, "fim", e.target.value)} />
              <button type="button" className="botao botao-secundario botao-icone" aria-label="Remover horário" onClick={() => setIntervalos(intervalos.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link-secundario"
            onClick={() => setIntervalos([...intervalos, { diaSemana: intervalos.length ? (intervalos[intervalos.length - 1].diaSemana + 1) % 7 : 1, inicio: "08:00", fim: "17:00" }])}
          >
            Adicionar horário
          </button>
          <Mensagem tipo="erro">{envio.erro}</Mensagem>
          <div className="modal-acoes">
            <button type="button" className="botao botao-secundario" onClick={aoFechar}>
              Cancelar
            </button>
            <button type="submit" className="botao" disabled={envio.enviando}>
              Salvar escala
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Recusar({ r, aoFeito }: { r: RegistroHorasDto; aoFeito(): void }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const envio = useEnvio(async () => {
    await post(`/horas/${r.id}/validacao`, { aprovar: false, motivo });
    setAberto(false);
    aoFeito();
  });
  if (!aberto)
    return (
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        Recusar
      </button>
    );
  return (
    <form className="form-linha" onSubmit={envio.enviar}>
      <Campo rotulo="Motivo da recusa" nome={`motivo-${r.id}`} valor={motivo} aoMudar={setMotivo} obrigatorio />
      <button type="submit" className="botao botao-perigo" disabled={envio.enviando}>
        Recusar
      </button>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
    </form>
  );
}

function Equipe({ mes }: { mes: string }) {
  const eu = useEu();
  const avisar = useAviso();
  const [escala, setEscala] = useState<{ id: string; nome: string } | null>(null);
  const resumo = usePaginado<ResumoHorasDto>(`/horas/resumo${query({ mes, limite: 50 })}`);
  const pendentes = usePaginado<RegistroHorasDto>(`/horas${query({ mes, status: "pendente", limite: 50 })}`);
  const recarregar = () => (void resumo.recarregar(), void pendentes.recarregar());
  useTempoReal(["horas.", "escala."], recarregar);
  const validar = async (r: RegistroHorasDto) => {
    try {
      await post(`/horas/${r.id}/validacao`, { aprovar: true });
      avisar("Horas validadas.");
      recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível validar.", "erro");
    }
  };
  const outros = pendentes.itens.filter((r) => r.usuarioId !== eu.usuario.id);
  return (
    <>
      <section className="cartao" aria-labelledby="titulo-validar">
        <h2 id="titulo-validar">Aguardando validação</h2>
        {!pendentes.carregando && !outros.length && <ListaVazia>Nada para validar neste mês.</ListaVazia>}
        <ul className="lista">
          {outros.map((r) => (
            <LinhaRegistro
              key={r.id}
              r={r}
              mostrarPessoa
              acoes={
                <>
                  <button type="button" className="botao" onClick={() => void validar(r)}>
                    Validar
                  </button>
                  <Recusar r={r} aoFeito={recarregar} />
                </>
              }
            />
          ))}
        </ul>
        <CarregarMais visivel={pendentes.temMais} carregando={pendentes.carregando} aoClicar={() => void pendentes.carregarMais()} />
      </section>
      <section className="cartao" aria-labelledby="titulo-resumo">
        <h2 id="titulo-resumo">Resumo do mês</h2>
        <Mensagem tipo="erro">{resumo.erro}</Mensagem>
        <ul className="lista">
          {resumo.itens.map((p) => (
            <li key={p.usuarioId} className="item">
              <div className="item-principal">
                <strong>
                  {p.nome} {p.emAndamento && <span className="selo">trabalhando agora</span>}
                </strong>
                <span className="item-detalhe">
                  Previsto {formatarMinutos(p.previstoMinutos)} · registrado {formatarMinutos(p.registradoMinutos)} · validado {formatarMinutos(p.validadoMinutos)}
                  {p.pendentes > 0 && ` · ${p.pendentes} para validar`}
                </span>
              </div>
              {p.usuarioId !== eu.usuario.id && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => setEscala({ id: p.usuarioId, nome: p.nome })}>
                    Escala
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <CarregarMais visivel={resumo.temMais} carregando={resumo.carregando} aoClicar={() => void resumo.carregarMais()} />
      </section>
      {escala && <EditorEscala pessoa={escala} aoFechar={() => (setEscala(null), recarregar())} />}
    </>
  );
}

function Reabrir({ f, aoFeito }: { f: FechamentoDto; aoFeito(): void }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const envio = useEnvio(async () => {
    await post(`/horas/fechamentos/${f.id}/reabrir`, { motivo });
    setAberto(false);
    aoFeito();
  });
  if (!aberto)
    return (
      <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
        Reabrir
      </button>
    );
  return (
    <form className="form-linha" onSubmit={envio.enviar}>
      <Campo rotulo="Motivo da reabertura" nome={`reabrir-${f.id}`} valor={motivo} aoMudar={setMotivo} obrigatorio />
      <button type="submit" className="botao" disabled={envio.enviando}>
        Reabrir
      </button>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
    </form>
  );
}

function Fechamento({ mes }: { mes: string }) {
  const dataHora = useDataHora();
  const avisar = useAviso();
  const lista = usePaginado<FechamentoDto>("/horas/fechamentos?limite=24");
  useTempoReal(["horas.mes_"], () => void lista.recarregar());
  const envio = useEnvio(async () => {
    await post("/horas/fechamentos", { mes });
    avisar(`${nomeDoMes(mes)} fechado. Os registros do mês não podem mais ser alterados.`);
    void lista.recarregar();
  });
  return (
    <section className="cartao" aria-labelledby="titulo-fechamento">
      <h2 id="titulo-fechamento">Fechamento</h2>
      <p className="dica">Fechar o mês trava os registros: ninguém altera, lança ou valida horas daquele mês até ele ser reaberto (com motivo).</p>
      <button type="button" className="botao" disabled={envio.enviando} onClick={() => void envio.enviar()}>
        Fechar {nomeDoMes(mes)}
      </button>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <ul className="lista">
        {lista.itens.map((f) => (
          <li key={f.id} className="item">
            <div className="item-principal">
              <strong>
                {nomeDoMes(f.mes)} {f.reabertoEm ? <span className="selo">reaberto</span> : <span className="selo selo-ganha">fechado</span>}
              </strong>
              <span className="item-detalhe">
                Fechado em {dataHora(f.fechadoEm)} por {f.fechadoPorNome}
                {f.reabertoEm && ` · reaberto em ${dataHora(f.reabertoEm)} por ${f.reabertoPorNome}: ${f.motivoReabertura}`}
              </span>
            </div>
            {!f.reabertoEm && (
              <div className="item-acoes">
                <Reabrir f={f} aoFeito={() => void lista.recarregar()} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Horas() {
  const { pode } = useSessao();
  const fuso = useFuso();
  const [mes, setMes] = useState(() => mesAtual(fuso));
  const [aba, setAba] = useState<"minhas" | "equipe" | "fechamento">("minhas");
  const [gerencia, setGerencia] = useState(false);
  useEffect(() => {
    get<{ itens: unknown[] }>(`/horas/resumo${query({ mes, limite: 2 })}`).then((p) => setGerencia(p.itens.length > 1), () => undefined);
  }, [mes]);
  const abas = [
    { id: "minhas", texto: "Minhas horas", visivel: true },
    { id: "equipe", texto: "Equipe", visivel: gerencia },
    { id: "fechamento", texto: "Fechamento", visivel: pode("agenda", "administrar") },
  ] as const;
  return (
    <>
      <Titulo>Horas</Titulo>
      <section className="cartao">
        <SeletorMes mes={mes} aoMudar={setMes} />
        <div className="abas" role="tablist" aria-label="Horas">
          {abas
            .filter((a) => a.visivel)
            .map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? "ativa" : ""} onClick={() => setAba(a.id)}>
                {a.texto}
              </button>
            ))}
        </div>
      </section>
      {aba === "minhas" && <MinhasHoras mes={mes} />}
      {aba === "equipe" && <Equipe mes={mes} />}
      {aba === "fechamento" && <Fechamento mes={mes} />}
    </>
  );
}
