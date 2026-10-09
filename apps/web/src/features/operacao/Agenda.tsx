// Agenda da semana (minha ou de quem eu gerencio), com compromisso ligado a contato e lembrete no sino.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CompromissoDto, Pagina, ResumoHorasDto } from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { BotaoAlternar, CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { diaPorExtenso, hojeNoFuso, horaNoFuso, instante, mesAtual, somarDias, useFuso } from "./comum";

/** Pessoas que o meu escopo de agenda alcança (eu incluída). */
export function usePessoasDaAgenda(): { id: string; nome: string }[] {
  const fuso = useFuso();
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    get<Pagina<ResumoHorasDto>>(`/horas/resumo${query({ mes: mesAtual(fuso), limite: 100 })}`).then(
      (p) => setPessoas(p.itens.map((i) => ({ id: i.usuarioId, nome: i.nome }))),
      () => undefined,
    );
  }, [fuso]);
  return pessoas;
}

const inicioDaSemana = (dia: string) => {
  const dow = new Date(`${dia}T00:00:00Z`).getUTCDay();
  return somarDias(dia, -((dow + 6) % 7));
};

const LEMBRETES = [
  { valor: "", texto: "Sem lembrete" },
  { valor: "0", texto: "Na hora" },
  { valor: "15", texto: "15 minutos antes" },
  { valor: "60", texto: "1 hora antes" },
  { valor: "1440", texto: "1 dia antes" },
];

function NovoCompromisso({ usuarioId, dia, aoCriar }: { usuarioId: string; dia: string; aoCriar(): void }) {
  const avisar = useAviso();
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState(dia);
  const [inicio, setInicio] = useState("09:00");
  const [fim, setFim] = useState("10:00");
  const [local, setLocal] = useState("");
  const [lembrete, setLembrete] = useState("15");
  const envio = useEnvio(async () => {
    await post("/compromissos", {
      usuarioId,
      titulo,
      local: local || null,
      inicio: instante(data, inicio),
      fim: instante(data, fim),
      lembreteMinutos: lembrete === "" ? null : Number(lembrete),
    });
    avisar("Compromisso marcado.");
    setTitulo("");
    setLocal("");
    aoCriar();
  });
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-label="Novo compromisso">
      <Campo rotulo="O quê" nome="comp-titulo" valor={titulo} aoMudar={setTitulo} obrigatorio />
      <div className="grade-campos">
        <Campo rotulo="Dia" nome="comp-dia" tipo="date" valor={data} aoMudar={setData} obrigatorio />
        <Campo rotulo="Começa" nome="comp-inicio" tipo="time" valor={inicio} aoMudar={setInicio} obrigatorio />
        <Campo rotulo="Termina" nome="comp-fim" tipo="time" valor={fim} aoMudar={setFim} obrigatorio />
        <Campo rotulo="Local (opcional)" nome="comp-local" valor={local} aoMudar={setLocal} />
        <Escolha rotulo="Lembrete" nome="comp-lembrete" valor={lembrete} aoMudar={setLembrete} opcoes={LEMBRETES} />
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        {envio.enviando ? "Salvando…" : "Marcar"}
      </button>
    </form>
  );
}

export function Agenda() {
  const eu = useEu();
  const { pode } = useSessao();
  const fuso = useFuso();
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const pessoas = usePessoasDaAgenda();
  const [usuarioId, setUsuarioId] = useState(eu.usuario.id);
  const [semana, setSemana] = useState(() => inicioDaSemana(hojeNoFuso(fuso)));
  const [novo, setNovo] = useState(false);
  const fimSemana = somarDias(semana, 6);
  const lista = usePaginado<CompromissoDto>(`/compromissos${query({ de: semana, ate: fimSemana, usuarioId, limite: 100 })}`);
  useTempoReal(["compromisso."], () => void lista.recarregar());

  const porDia = useMemo(() => {
    const dias = Array.from({ length: 7 }, (_, i) => somarDias(semana, i));
    return dias.map((d) => ({ dia: d, itens: lista.itens.filter((c) => hojeNoFuso(fuso, new Date(c.inicio)) === d) }));
  }, [lista.itens, semana, fuso]);

  const desmarcar = async (c: CompromissoDto) => {
    if (!(await confirmar({ titulo: "Desmarcar compromisso", mensagem: `“${c.titulo}” sai da agenda (fica arquivado).`, acao: "Desmarcar" }))) return;
    try {
      await patch(`/compromissos/${c.id}`, { arquivar: true });
      avisar("Compromisso desmarcado.");
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível desmarcar.", "erro");
    }
  };

  return (
    <>
      <Titulo acao={pode("agenda", "criar") && <BotaoAlternar aberto={novo} aoMudar={setNovo} texto="Novo compromisso" />}>Agenda</Titulo>
      {novo && <NovoCompromisso usuarioId={usuarioId} dia={hojeNoFuso(fuso)} aoCriar={() => (setNovo(false), void lista.recarregar())} />}
      <section className="cartao">
        <div className="navegar-periodo">
          <button type="button" className="botao botao-secundario" aria-label="Semana anterior" onClick={() => setSemana(somarDias(semana, -7))}>
            ←
          </button>
          <strong>
            {new Date(`${semana}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" })} a{" "}
            {new Date(`${fimSemana}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" })}
          </strong>
          <button type="button" className="botao botao-secundario" aria-label="Próxima semana" onClick={() => setSemana(somarDias(semana, 7))}>
            →
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => setSemana(inicioDaSemana(hojeNoFuso(fuso)))}>
            Hoje
          </button>
        </div>
        {pessoas.length > 1 && (
          <div className="filtros">
            <Escolha rotulo="Agenda de" nome="agenda-pessoa" valor={usuarioId} aoMudar={setUsuarioId} opcoes={pessoas.map((p) => ({ valor: p.id, texto: p.id === eu.usuario.id ? "Eu" : p.nome }))} />
          </div>
        )}
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {porDia.map(({ dia, itens }) => (
          <div key={dia} className="dia-agenda">
            <h2 className={dia === hojeNoFuso(fuso) ? "hoje" : ""}>{diaPorExtenso(dia)}</h2>
            {!itens.length ? (
              <ListaVazia>Livre.</ListaVazia>
            ) : (
              <ul className="lista">
                {itens.map((c) => (
                  <li key={c.id} className="item">
                    <div className="item-principal">
                      <strong>
                        {horaNoFuso(c.inicio, fuso)}–{horaNoFuso(c.fim, fuso)} {c.titulo}
                      </strong>
                      <span className="item-detalhe">
                        {c.local}
                        {c.contatoId && (
                          <>
                            {c.local ? " · " : ""}
                            <Link to={`/contatos/${c.contatoId}`}>{c.contatoNome}</Link>
                          </>
                        )}
                      </span>
                    </div>
                    {pode("agenda", "editar") && (
                      <div className="item-acoes">
                        <button type="button" className="botao botao-secundario" onClick={() => void desmarcar(c)}>
                          Desmarcar
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
