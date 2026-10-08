// Importação de planilha em passos: enviar → conferir colunas → importar em segundo plano → relatório.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DESTINOS_FIXOS, NOMES_DESTINOS, type FilaDto, type ImportacaoDto, type TipoBaseDto } from "@mg/shared";
import { ErroApi, enviarArquivo, get, post } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Campo, CarregarMais, Escolha, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { EscolhaEtiquetas, useConfigCrm, useTermos } from "./comum";

const NOMES_STATUS: Record<ImportacaoDto["status"], string> = {
  PRONTA: "Aguardando confirmação",
  PENDENTE: "Na fila",
  PROCESSANDO: "Importando…",
  CONCLUIDA: "Concluída",
  CONCLUIDA_COM_ERROS: "Concluída com linhas ignoradas",
  FALHOU: "Falhou (será tentada de novo)",
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Sugere a coluna da planilha para cada destino pelo nome do cabeçalho. */
function sugerir(colunas: string[], destino: string, rotulo: string): string {
  const pistas: Record<string, string[]> = {
    nome: ["nome", "cliente", "contato", "aluno", "paciente"],
    telefone: ["telefone", "celular", "whatsapp", "fone", "tel"],
    email: ["email", "e-mail"],
    origem: ["origem", "fonte", "canal"],
    organizacao: ["empresa", "organizacao", "companhia"],
  };
  const candidatos = pistas[destino] ?? [semAcento(rotulo)];
  return colunas.find((c) => candidatos.some((p) => semAcento(c).includes(p))) ?? "";
}

function Enviar({ aoReceber }: { aoReceber(i: ImportacaoDto): void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const { enviando, erro, enviar } = useEnvio(async () => {
    if (!arquivo) return;
    aoReceber(await enviarArquivo<ImportacaoDto>("/importacoes", arquivo));
  });
  return (
    <form className="cartao" onSubmit={enviar}>
      <h2>1. Escolha a planilha</h2>
      <p className="dica">Arquivo .xlsx ou .csv, com cabeçalho na primeira linha, até 10 MB. Precisa ter ao menos nome e telefone.</p>
      <div className="campo">
        <label htmlFor="arquivo-importacao">Planilha</label>
        <input id="arquivo-importacao" type="file" accept=".xlsx,.csv,.txt" required onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      </div>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando || !arquivo}>
        {enviando ? "Lendo…" : "Enviar e conferir"}
      </button>
    </form>
  );
}

function Mapear({ imp, aoConfirmar }: { imp: ImportacaoDto; aoConfirmar(i: ImportacaoDto): void }) {
  const { config } = useConfigCrm();
  const termos = useTermos();
  const destinos = [
    ...DESTINOS_FIXOS.map((d) => ({ chave: d, rotulo: NOMES_DESTINOS[d] })),
    ...config.campos.filter((c) => c.entidade === "contato").map((c) => ({ chave: `campo:${c.chave}`, rotulo: c.rotulo })),
  ];
  const [mapa, setMapa] = useState<Record<string, string>>({});
  useEffect(() => {
    setMapa((atual) => {
      const novo = { ...atual };
      for (const d of destinos) if (novo[d.chave] === undefined) novo[d.chave] = sugerir(imp.colunas, d.chave, d.rotulo);
      return novo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp.colunas, config.campos.length]);
  const [responsavelId, setResponsavelId] = useState("");
  const [etiquetaIds, setEtiquetaIds] = useState<string[]>([]);
  const [origem, setOrigem] = useState("");
  const [atualizar, setAtualizar] = useState(true);
  // Fase 3: alimentar uma fila de ligação com os contatos importados.
  const { pode } = useSessao();
  const podeFila = pode("fila", "criar");
  const podeCriarFila = pode("fila", "administrar");
  const [filas, setFilas] = useState<FilaDto[]>([]);
  const [tipos, setTipos] = useState<TipoBaseDto[]>([]);
  const [destinoFila, setDestinoFila] = useState("");
  const [nomeFila, setNomeFila] = useState("");
  const [tipoBaseId, setTipoBaseId] = useState("");
  useEffect(() => {
    if (!podeFila) return;
    get<FilaDto[]>("/filas").then((l) => setFilas(l.filter((f) => f.status !== "encerrada")), () => undefined);
    get<TipoBaseDto[]>("/tipos-base").then((l) => setTipos(l.filter((t) => !t.arquivadoEm)), () => undefined);
  }, [podeFila]);
  const { enviando, erro, enviar } = useEnvio(async () => {
    const mapeamento = Object.fromEntries(Object.entries(mapa).filter(([, coluna]) => coluna));
    const fila =
      destinoFila === "nova" ? { novaFila: { nome: nomeFila, tipoBaseId: tipoBaseId || null } } : destinoFila ? { filaId: destinoFila } : {};
    aoConfirmar(
      await post<ImportacaoDto>(`/importacoes/${imp.id}/confirmar`, { mapeamento, responsavelId: responsavelId || null, etiquetaIds, origem: origem || null, atualizarExistentes: atualizar, ...fila }),
    );
  });

  return (
    <form className="cartao" onSubmit={enviar}>
      <h2>2. Confira as colunas</h2>
      <p>
        <strong>{imp.nomeArquivo}</strong> — {imp.totalLinhas.toLocaleString("pt-BR")} linha(s). Primeiras linhas:
      </p>
      <div className="tabela-rolavel" tabIndex={0} aria-label="Prévia da planilha">
        <table className="tabela">
          <thead>
            <tr>
              {imp.colunas.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {imp.amostra.map((linha, i) => (
              <tr key={i}>
                {linha.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grade-campos">
        {destinos.map((d) => (
          <Escolha
            key={d.chave}
            rotulo={`${d.rotulo}${d.chave === "nome" || d.chave === "telefone" ? " *" : ""}`}
            nome={`mapa-${d.chave}`}
            valor={mapa[d.chave] ?? ""}
            aoMudar={(v) => setMapa((m) => ({ ...m, [d.chave]: v }))}
            opcoes={imp.colunas.map((c) => ({ valor: c, texto: c }))}
            vazio="Não importar"
            obrigatorio={d.chave === "nome" || d.chave === "telefone"}
          />
        ))}
      </div>
      <h3>Opções</h3>
      <div className="grade-campos">
        {config.responsaveis.length > 1 && (
          <Escolha rotulo={`Responsável pelos novos ${termos.contatos}`} nome="imp-responsavel" valor={responsavelId} aoMudar={setResponsavelId} opcoes={config.responsaveis.map((r) => ({ valor: r.id, texto: r.nome }))} vazio="Eu mesmo" />
        )}
        <Campo rotulo="Origem (quando a planilha não tiver)" nome="imp-origem" valor={origem} aoMudar={setOrigem} dica="Ex.: Feira 2026" />
      </div>
      <EscolhaEtiquetas rotulo="Pôr estas etiquetas em todos" etiquetas={config.etiquetas} marcadas={etiquetaIds} aoMudar={setEtiquetaIds} />
      <label className="marcar">
        <input type="checkbox" checked={atualizar} onChange={(e) => setAtualizar(e.target.checked)} />
        Atualizar nome, e-mail e campos de quem já está cadastrado (o telefone identifica a pessoa)
      </label>
      {podeFila && (
        <div className="grade-campos">
          <Escolha
            rotulo="Pôr os contatos numa fila de ligação"
            nome="imp-fila"
            valor={destinoFila}
            aoMudar={setDestinoFila}
            opcoes={[...filas.map((f) => ({ valor: f.id, texto: f.nome })), ...(podeCriarFila ? [{ valor: "nova", texto: "Criar uma fila nova…" }] : [])]}
            vazio="Não pôr em fila"
          />
          {destinoFila === "nova" && (
            <>
              <Campo rotulo="Nome da nova fila" nome="imp-fila-nome" valor={nomeFila} aoMudar={setNomeFila} obrigatorio />
              <Escolha rotulo="Tipo de base" nome="imp-fila-tipo" valor={tipoBaseId} aoMudar={setTipoBaseId} opcoes={tipos.map((t) => ({ valor: t.id, texto: t.nome }))} vazio="Sem tipo" />
            </>
          )}
        </div>
      )}
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        {enviando ? "Confirmando…" : `Importar ${imp.totalLinhas.toLocaleString("pt-BR")} linha(s)`}
      </button>
    </form>
  );
}

function Relatorio({ id }: { id: string }) {
  const [imp, setImp] = useState<ImportacaoDto | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<ImportacaoDto>(`/importacoes/${id}`)
      .then(setImp)
      .catch((e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, [id]);
  useEffect(carregar, [carregar]);
  useTempoReal(["importacao."], (a) => (a.entidadeId === id ? carregar() : undefined));
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!imp) return <p className="carregando">Carregando…</p>;
  const andamento = imp.status === "PENDENTE" || imp.status === "PROCESSANDO";

  return (
    <section className="cartao" aria-live="polite">
      <h2>3. {NOMES_STATUS[imp.status]}</h2>
      <p>{imp.nomeArquivo}</p>
      {andamento ? (
        <>
          <p>Você pode sair desta tela: avisamos pelo sino quando terminar.</p>
          <button type="button" className="botao botao-secundario" onClick={carregar}>
            Atualizar
          </button>
        </>
      ) : (
        <dl className="numeros">
          <div>
            <dt>Novos</dt>
            <dd>{imp.novos}</dd>
          </div>
          <div>
            <dt>Atualizados</dt>
            <dd>{imp.atualizados}</dd>
          </div>
          <div>
            <dt>Sem mudança</dt>
            <dd>{imp.inalterados}</dd>
          </div>
          <div>
            <dt>Ignorados</dt>
            <dd>{imp.ignorados}</dd>
          </div>
        </dl>
      )}
      {imp.fila && !andamento && (
        <>
          <h3>Fila “{imp.fila.nome}”</h3>
          <dl className="numeros">
            <div>
              <dt>Novos na fila</dt>
              <dd>{imp.fila.novos}</dd>
            </div>
            <div>
              <dt>Já cadastrados</dt>
              <dd>{imp.fila.atualizados}</dd>
            </div>
            <div>
              <dt>Já em outra fila</dt>
              <dd>{imp.fila.emOutraFila}</dd>
            </div>
            <div>
              <dt>Já ligados antes</dt>
              <dd>{imp.fila.jaLigados}</dd>
            </div>
          </dl>
        </>
      )}
      {imp.erros.length > 0 && (
        <>
          <h3>Linhas ignoradas</h3>
          <ul className="lista-simples">
            {imp.erros.map((e, i) => (
              <li key={i}>
                {e.linha > 0 && <strong>Linha {e.linha}: </strong>}
                {e.motivo}
              </li>
            ))}
          </ul>
          {imp.ignorados > imp.erros.length && <p className="dica">Mostrando as primeiras {imp.erros.length}.</p>}
        </>
      )}
    </section>
  );
}

function Anteriores({ aoAbrir }: { aoAbrir(id: string): void }) {
  const dataHora = useDataHora();
  const lista = usePaginado<ImportacaoDto>("/importacoes?limite=10");
  useTempoReal(["importacao."], () => void lista.recarregar());
  return (
    <section className="cartao">
      <h2>Importações anteriores</h2>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma ainda.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((i) => (
          <li key={i.id} className="item">
            <div className="item-principal">
              <strong>{i.nomeArquivo}</strong>
              <span className="item-detalhe">
                {dataHora(i.criadoEm)} · {NOMES_STATUS[i.status]}
              </span>
            </div>
            <button type="button" className="botao botao-secundario" onClick={() => aoAbrir(i.id)}>
              Ver
            </button>
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </section>
  );
}

export function Importar() {
  const [parametros, setParametros] = useSearchParams();
  const termos = useTermos();
  const [recebida, setRecebida] = useState<ImportacaoDto | null>(null);
  const id = parametros.get("id");
  const abrir = (novo: string) => {
    setRecebida(null);
    setParametros({ id: novo });
  };

  return (
    <>
      <Titulo
        acao={
          (id || recebida) && (
            <button type="button" className="botao botao-secundario" onClick={() => (setRecebida(null), setParametros({}))}>
              Nova importação
            </button>
          )
        }
      >
        Importar {termos.contatos}
      </Titulo>
      {id ? <Relatorio id={id} /> : recebida ? <Mapear imp={recebida} aoConfirmar={(i) => abrir(i.id)} /> : <Enviar aoReceber={setRecebida} />}
      <Anteriores aoAbrir={abrir} />
    </>
  );
}
