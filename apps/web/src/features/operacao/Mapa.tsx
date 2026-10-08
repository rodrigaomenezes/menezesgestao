// Mapa de atividades: cada pessoa × hora do dia, das ações registradas + atividades lançadas à mão.
import { useEffect, useState } from "react";
import { NOMES_TIPOS_ATIVIDADE, TIPOS_ATIVIDADE, type AtividadeDto, type LinhaMapaDto, type TipoAtividadeId } from "@mg/shared";
import { ErroApi, get, patch, post, query } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { hojeNoFuso, horaNoFuso, instante, somarDias, useFuso } from "./comum";

type Hora = LinhaMapaDto["horas"][number];

const nivel = (h: Hora) => (h.acoes === 0 ? 0 : h.acoes <= 2 ? 1 : h.acoes <= 5 ? 2 : h.acoes <= 10 ? 3 : 4);

function descrever(h: Hora): string {
  const partes = [
    h.ligacoes && `${h.ligacoes} ligação(ões)`,
    h.mensagens && `${h.mensagens} mensagem(ns)`,
    h.crm && `${h.crm} no cadastro/funil`,
    h.fila && `${h.fila} na fila`,
    h.manualMinutos && `${h.manualMinutos} min de ${h.manualTipos.map((t) => NOMES_TIPOS_ATIVIDADE[t as TipoAtividadeId] ?? t).join(", ")}`,
  ].filter(Boolean);
  return `${h.hora}h: ${partes.length ? partes.join(", ") : "sem atividade"}`;
}

function FormAtividade({ dia, inicial, aoSalvar, aoCancelar }: { dia: string; inicial?: AtividadeDto; aoSalvar(): void; aoCancelar?(): void }) {
  const fuso = useFuso();
  const avisar = useAviso();
  const sufixo = inicial?.id ?? "nova";
  const [tipo, setTipo] = useState<string>(inicial?.tipo ?? "reuniao");
  const [inicio, setInicio] = useState(inicial ? horaNoFuso(inicial.inicio, fuso) : "09:00");
  const [fim, setFim] = useState(inicial ? horaNoFuso(inicial.fim, fuso) : "10:00");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const envio = useEnvio(async () => {
    const corpo = { tipo, descricao: descricao || null, inicio: instante(dia, inicio), fim: instante(dia, fim) };
    if (inicial) await patch(`/atividades/${inicial.id}`, corpo);
    else await post("/atividades", corpo);
    avisar(inicial ? "Atividade corrigida." : "Atividade lançada.");
    if (!inicial) setDescricao("");
    aoSalvar();
  });
  return (
    <form onSubmit={envio.enviar} aria-label={inicial ? "Corrigir atividade" : "Lançar atividade"}>
      <div className="grade-campos">
        <Escolha rotulo="Atividade" nome={`ativ-tipo-${sufixo}`} valor={tipo} aoMudar={setTipo} opcoes={TIPOS_ATIVIDADE.map((t) => ({ valor: t, texto: NOMES_TIPOS_ATIVIDADE[t] }))} />
        <Campo rotulo="Das" nome={`ativ-inicio-${sufixo}`} tipo="time" valor={inicio} aoMudar={setInicio} obrigatorio />
        <Campo rotulo="Até" nome={`ativ-fim-${sufixo}`} tipo="time" valor={fim} aoMudar={setFim} obrigatorio />
        <Campo rotulo="Descrição (opcional)" nome={`ativ-desc-${sufixo}`} valor={descricao} aoMudar={setDescricao} />
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <div className="form-linha">
        <button type="submit" className="botao" disabled={envio.enviando}>
          {inicial ? "Salvar correção" : "Lançar"}
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

function Atividades({ dia, aoMudar }: { dia: string; aoMudar(): void }) {
  const { pode } = useSessao();
  const fuso = useFuso();
  const avisar = useAviso();
  const [editando, setEditando] = useState<string | null>(null);
  const lista = usePaginado<AtividadeDto>(`/atividades${query({ data: dia, limite: 50 })}`);
  const recarregar = () => (void lista.recarregar(), aoMudar());
  const arquivar = async (a: AtividadeDto) => {
    try {
      await patch(`/atividades/${a.id}`, { arquivar: true });
      avisar("Atividade arquivada.");
      recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível arquivar.", "erro");
    }
  };
  return (
    <section className="cartao" aria-labelledby="titulo-atividades">
      <h2 id="titulo-atividades">O que não passa pelo sistema</h2>
      <p className="dica">Reuniões, visitas e treinamentos lançados aqui aparecem no mapa (hachurado). Dá para corrigir depois; a correção fica registrada.</p>
      {pode("mapa", "criar") && <FormAtividade dia={dia} aoSalvar={recarregar} />}
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma atividade lançada neste dia.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((a) =>
          editando === a.id ? (
            <li key={a.id}>
              <FormAtividade dia={dia} inicial={a} aoSalvar={() => (setEditando(null), recarregar())} aoCancelar={() => setEditando(null)} />
            </li>
          ) : (
            <li key={a.id} className="item">
              <div className="item-principal">
                <strong>
                  {horaNoFuso(a.inicio, fuso)}–{horaNoFuso(a.fim, fuso)} {NOMES_TIPOS_ATIVIDADE[a.tipo]}
                </strong>
                <span className="item-detalhe">
                  {a.usuarioNome}
                  {a.descricao && ` · ${a.descricao}`}
                </span>
              </div>
              {pode("mapa", "editar") && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => setEditando(a.id)}>
                    Corrigir
                  </button>
                  <button type="button" className="botao botao-secundario" onClick={() => void arquivar(a)}>
                    Arquivar
                  </button>
                </div>
              )}
            </li>
          ),
        )}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

export function Mapa() {
  const fuso = useFuso();
  const [dia, setDia] = useState(() => hojeNoFuso(fuso));
  const [linhas, setLinhas] = useState<LinhaMapaDto[]>([]);
  const [mais, setMais] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const carregar = (cursor?: string) =>
    get<{ itens: LinhaMapaDto[]; proximoCursor: string | null }>(`/mapa${query({ data: dia, cursor, limite: 30 })}`)
      .then((p) => {
        setLinhas((a) => (cursor ? [...a, ...p.itens] : p.itens));
        setMais(p.proximoCursor);
        setErro("");
      })
      .catch((e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o mapa."));
  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia]);
  useTempoReal(["ligacao.encerrada", "mensagem.criada", "fila.resultado_registrado", "atividade."], () => {
    if (dia === hojeNoFuso(fuso)) void carregar();
  });
  const horas = Array.from({ length: 24 }, (_, h) => h);

  return (
    <>
      <Titulo>Mapa de atividades</Titulo>
      <section className="cartao">
        <div className="navegar-periodo">
          <button type="button" className="botao botao-secundario" aria-label="Dia anterior" onClick={() => setDia(somarDias(dia, -1))}>
            ←
          </button>
          <Campo rotulo="Dia" nome="mapa-dia" tipo="date" valor={dia} aoMudar={(v) => v && setDia(v)} />
          <button type="button" className="botao botao-secundario" aria-label="Dia seguinte" onClick={() => setDia(somarDias(dia, 1))}>
            →
          </button>
        </div>
        <Mensagem tipo="erro">{erro}</Mensagem>
        <div className="tabela-rolavel mapa-rolavel">
          <table className="mapa">
            <caption className="sr-only">Ações por hora de cada pessoa</caption>
            <thead>
              <tr>
                <th scope="col">Pessoa</th>
                {horas.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.usuarioId}>
                  <th scope="row">{l.nome}</th>
                  {l.horas.map((h) => (
                    <td key={h.hora} className={`nivel-${nivel(h)} ${h.manualMinutos ? "manual" : ""}`} title={descrever(h)} aria-label={descrever(h)}>
                      {h.acoes || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="legenda">
          <span className="nivel-0">sem ação</span> <span className="nivel-1">1–2</span> <span className="nivel-2">3–5</span> <span className="nivel-3">6–10</span>{" "}
          <span className="nivel-4">mais de 10</span> <span className="manual">lançado à mão</span>
        </p>
        <CarregarMais visivel={Boolean(mais)} carregando={false} aoClicar={() => void carregar(mais ?? undefined)} />
      </section>
      <Atividades dia={dia} aoMudar={() => void carregar()} />
    </>
  );
}
