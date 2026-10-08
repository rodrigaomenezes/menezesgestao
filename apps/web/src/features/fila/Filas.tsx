// Filas de ligação: lista com contagens, criação e status (administrador) e acesso ao discador.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NOMES_STATUS_FILA, type FilaDto, type TipoBaseDto } from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { BotaoAlternar, Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { useConfigCrm } from "../crm/comum";

export function useTiposBase() {
  const [tipos, setTipos] = useState<TipoBaseDto[]>([]);
  useEffect(() => {
    get<TipoBaseDto[]>("/tipos-base").then(setTipos, () => undefined);
  }, []);
  return tipos;
}

function NovaFila({ aoCriar }: { aoCriar(): void }) {
  const tipos = useTiposBase().filter((t) => !t.arquivadoEm);
  const { config } = useConfigCrm();
  const [nome, setNome] = useState("");
  const [tipoBaseId, setTipoBaseId] = useState("");
  const [funilId, setFunilId] = useState("");
  const [reserva, setReserva] = useState("15");
  const [tentativas, setTentativas] = useState("5");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/filas", { nome, tipoBaseId: tipoBaseId || null, funilId: funilId || null, reservaMinutos: Number(reserva), maxTentativas: Number(tentativas) });
    setNome("");
    aoCriar();
  });
  return (
    <form className="cartao" onSubmit={enviar} aria-label="Nova fila">
      <div className="grade-campos">
        <Campo rotulo="Nome da fila" nome="fila-nome" valor={nome} aoMudar={setNome} obrigatorio dica="Ex.: Leads da feira de outubro" />
        <Escolha rotulo="Tipo de base" nome="fila-tipo" valor={tipoBaseId} aoMudar={setTipoBaseId} opcoes={tipos.map((t) => ({ valor: t.id, texto: t.nome }))} vazio="Sem tipo" />
        <Escolha rotulo="Convertidos vão para o funil" nome="fila-funil" valor={funilId} aoMudar={setFunilId} opcoes={config.funis.map((f) => ({ valor: f.id, texto: f.nome }))} vazio="Primeiro funil" />
        <Campo rotulo="Reserva (minutos)" nome="fila-reserva" tipo="number" valor={reserva} aoMudar={setReserva} dica="Tempo que o contato fica só com quem pegou" />
        <Campo rotulo="Tentativas máximas" nome="fila-tentativas" tipo="number" valor={tentativas} aoMudar={setTentativas} />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        Criar fila
      </button>
    </form>
  );
}

function CartaoFila({ f, aoMudar }: { f: FilaDto; aoMudar(): void }) {
  const { pode } = useSessao();
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const mudar = async (dados: Record<string, unknown>, sucesso: string) => {
    try {
      await patch(`/filas/${f.id}`, dados);
      avisar(sucesso);
      aoMudar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível alterar.", "erro");
    }
  };
  const admin = pode("fila", "administrar");
  return (
    <li className="item cartao-fila">
      <div className="item-principal">
        <strong>{f.nome}</strong>
        <span className="item-detalhe">
          {f.tipoBaseNome ?? "Sem tipo de base"} · <span className={`selo selo-fila-${f.status}`}>{NOMES_STATUS_FILA[f.status]}</span>
        </span>
        <dl className="numeros-fila">
          <div>
            <dt>Prontos</dt>
            <dd>{f.prontos}</dd>
          </div>
          <div>
            <dt>Agendados</dt>
            <dd>{f.agendados}</dd>
          </div>
          <div>
            <dt>Em ligação</dt>
            <dd>{f.reservados}</dd>
          </div>
          <div>
            <dt>Concluídos</dt>
            <dd>{f.concluidos}</dd>
          </div>
        </dl>
      </div>
      <div className="item-acoes">
        {f.status === "ativa" && !f.arquivadoEm && (
          <Link className="botao" to={`/filas/${f.id}`}>
            Ligar nesta fila
          </Link>
        )}
        {f.status !== "ativa" && (
          <Link className="botao botao-secundario" to={`/filas/${f.id}`}>
            Ver
          </Link>
        )}
        {admin && !f.arquivadoEm && f.status === "ativa" && (
          <button type="button" className="botao botao-secundario" onClick={() => void mudar({ status: "pausada" }, "Fila pausada.")}>
            Pausar
          </button>
        )}
        {admin && !f.arquivadoEm && f.status !== "ativa" && (
          <button type="button" className="botao botao-secundario" onClick={() => void mudar({ status: "ativa" }, "Fila ativa.")}>
            Ativar
          </button>
        )}
        {admin && !f.arquivadoEm && f.status !== "encerrada" && (
          <button
            type="button"
            className="botao botao-secundario"
            onClick={async () => {
              if (await confirmar({ titulo: "Encerrar fila", mensagem: `Encerrar ${f.nome}? Ninguém mais recebe contatos dela; o histórico fica.`, acao: "Encerrar", perigosa: true }))
                void mudar({ status: "encerrada" }, "Fila encerrada.");
            }}
          >
            Encerrar
          </button>
        )}
        {admin && (
          <button type="button" className="botao botao-secundario" onClick={() => void mudar({ arquivado: !f.arquivadoEm }, f.arquivadoEm ? "Fila restaurada." : "Fila arquivada.")}>
            {f.arquivadoEm ? "Restaurar" : "Arquivar"}
          </button>
        )}
      </div>
    </li>
  );
}

export function Filas() {
  const { pode } = useSessao();
  const [filas, setFilas] = useState<FilaDto[]>([]);
  const [arquivadas, setArquivadas] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<FilaDto[]>(`/filas?arquivadas=${arquivadas ? "sim" : "nao"}`).then(
      (l) => (setFilas(l), setErro("")),
      (e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar as filas."),
    );
  }, [arquivadas]);
  useEffect(carregar, [carregar]);
  useTempoReal(["fila."], carregar);

  return (
    <>
      <Titulo acao={pode("fila", "administrar") && <BotaoAlternar aberto={criando} aoMudar={setCriando} texto="Nova fila" />}>Fila de ligações</Titulo>
      {criando && <NovaFila aoCriar={() => (setCriando(false), carregar())} />}
      <section className="cartao">
        <div className="abas" role="tablist" aria-label="Mostrar">
          <button type="button" role="tab" aria-selected={!arquivadas} className={!arquivadas ? "ativa" : ""} onClick={() => setArquivadas(false)}>
            Filas
          </button>
          <button type="button" role="tab" aria-selected={arquivadas} className={arquivadas ? "ativa" : ""} onClick={() => setArquivadas(true)}>
            Arquivadas
          </button>
        </div>
        <Mensagem tipo="erro">{erro}</Mensagem>
        {!filas.length && (
          <ListaVazia>
            {arquivadas ? "Nenhuma fila arquivada." : "Nenhuma fila ainda. Crie uma ou importe uma planilha escolhendo “alimentar uma fila”."}
          </ListaVazia>
        )}
        <ul className="lista">
          {filas.map((f) => (
            <CartaoFila key={f.id} f={f} aoMudar={carregar} />
          ))}
        </ul>
      </section>
    </>
  );
}
