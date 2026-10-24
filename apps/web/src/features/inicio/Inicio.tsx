// Início em blocos que cada pessoa monta: o perfil traz um padrão; "Personalizar início" deixa subir, descer,
// tirar e adicionar blocos. A ordem fica salva no servidor (vale no celular e no computador).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  BLOCOS_INICIO,
  blocoPermitido,
  type BlocoInicioId,
  type ComissoesDoMesDto,
  type ConfiguracaoCrmDto,
  type DesempenhoDto,
  type InicioDto,
  type KanbanDto,
  type ItemFilaBreDto,
  type NotificacaoDto,
  type Pagina,
  type RotinaDto,
} from "@mg/shared";
import { ErroApi, del, get, put } from "../../app/api";
import { useDataHora, useEu, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useVocabulario } from "../../app/vocabulario";
import { Icone, type NomeIcone } from "../../ui/Icone";
import { useAviso } from "../../ui/sobreposicoes";
import { ListaVazia, Mensagem } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";
import { useFuso } from "../operacao/comum";
import { BlocoAgenda, BlocoChecklist, BlocoConversas, BlocoMetas, BlocoRetornos, BlocoTarefas, Ponto, useRotina } from "../operacao/Rotina";
import { AvisoPrimeirosPassos } from "../whitelabel/PrimeirosPassos";

const BLOCOS_DA_ROTINA = new Set<BlocoInicioId>(["conversas", "metas", "agenda", "tarefas", "retornos", "checklist"]);
const LINKS: Partial<Record<BlocoInicioId, [string, string]>> = {
  conversas: ["/conversas", "Abrir conversas"],
  metas: ["/desempenho", "Ver desempenho"],
  agenda: ["/agenda", "Ver agenda"],
  tarefas: ["/tarefas", "Ver tarefas"],
  retornos: ["/filas", "Ver filas"],
  funil: ["/funil", "Abrir funil"],
  ranking: ["/desempenho", "Ver desempenho"],
  comissao: ["/comissoes", "Ver comissões"],
  avisos: ["/notificacoes", "Ver todas"],
  bre: ["/bre", "Abrir a fila"],
};

function saudacao(fuso: string): string {
  const hora = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hourCycle: "h23", timeZone: fuso }).format(new Date()));
  return hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
}

function BlocoAtalhos() {
  const { pode } = useSessao();
  const termos = useVocabulario();
  const atalhos: { para: string; texto: string; icone: NomeIcone; ok: boolean }[] = [
    { para: "/contatos", texto: termos.t("{Novo contato}"), icone: "adicionar", ok: pode("crm", "criar") },
    { para: "/filas", texto: "Próximo da fila", icone: "ligacoes", ok: pode("fila", "ver") },
    { para: "/conversas", texto: "Conversas", icone: "conversas", ok: pode("conversas", "ver") },
    { para: "/agenda", texto: "Agenda", icone: "agenda", ok: pode("agenda", "ver") },
    { para: "/vendas", texto: "Registrar venda", icone: "vendas", ok: pode("vendas", "criar") },
    { para: "/tarefas", texto: "Tarefas", icone: "tarefas", ok: pode("crm", "ver") },
  ];
  const visiveis = atalhos.filter((a) => a.ok).slice(0, 4);
  if (!visiveis.length) return <ListaVazia>Nenhum atalho para o seu perfil.</ListaVazia>;
  return (
    <ul className="atalhos">
      {visiveis.map((a) => (
        <li key={a.para + a.texto}>
          <Link to={a.para}>
            <span className="atalho-icone">
              <Icone nome={a.icone} />
            </span>
            {a.texto}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BlocoFunil() {
  const termos = useVocabulario();
  const [k, setK] = useState<KanbanDto | null>(null);
  const [vazio, setVazio] = useState(false);
  const carregar = useCallback(() => {
    get<ConfiguracaoCrmDto>("/crm/configuracao")
      .then((c) => {
        const f = c.funis[0];
        if (!f) return setVazio(true);
        return get<KanbanDto>(`/funis/${f.id}/kanban`).then(setK);
      })
      .catch(() => setVazio(true));
  }, []);
  useEffect(carregar, [carregar]);
  useTempoReal(["oportunidade."], carregar);
  if (vazio) return <ListaVazia>Nenhum funil ainda.</ListaVazia>;
  if (!k) return <p className="carregando">Carregando…</p>;
  const maior = Math.max(1, ...k.colunas.map((c) => c.total));
  return (
    <ul className="barras" aria-label={termos.t(`{Oportunidades} por etapa em ${k.funil.nome}`)}>
      {k.funil.etapas.map((e) => {
        const total = k.colunas.find((c) => c.etapaId === e.id)?.total ?? 0;
        // A etapa leva ao painel do funil com a lista exata: abertas nela, ou ganhas/perdidas.
        const lente = e.tipo === "aberta" ? `lista=aberta&etapaId=${e.id}` : `lista=${e.tipo}`;
        return (
          <li key={e.id}>
            <Link to={`/funil?funil=${k.funil.id}&ver=painel&${lente}`} className="barras-link" aria-label={`${e.nome}: ${total}. Ver a lista.`}>
              <span className="barras-rotulo">{e.nome}</span>
              <span className="barras-trilho">
                <span className="barras-valor" style={{ width: `${(total / maior) * 100}%` }} />
              </span>
              <strong>{total}</strong>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function BlocoRanking() {
  const termos = useVocabulario();
  const [d, setD] = useState<DesempenhoDto | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    get<DesempenhoDto>("/desempenho?periodo=mes&limite=50").then(setD, (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, []);
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!d) return <p className="carregando">Carregando…</p>;
  const lideres = [...d.itens].sort((a, b) => (b.valores.vendas ?? 0) - (a.valores.vendas ?? 0)).slice(0, 5);
  if (!lideres.length) return <ListaVazia>Ninguém no ranking ainda.</ListaVazia>;
  return (
    <ol className="ranking">
      {lideres.map((p, i) => (
        <li key={p.usuarioId}>
          {/* A pessoa leva ao painel de desempenho do mês, focado nela e no que conta no ranking. */}
          <Link to={`/desempenho?inicio=${d.inicio}&fim=${d.fim}&indicador=vendas&usuarioId=${p.usuarioId}`} className="ranking-link">
            <span className="ranking-posicao">{i + 1}</span>
            <span className="ranking-nome">{p.nome}</span>
            <span className="item-detalhe">{termos.t(`${p.valores.vendas ?? 0} {oportunidades} ganh{os|as:oportunidades}`)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function BlocoComissao() {
  const fuso = useFuso();
  const [c, setC] = useState<ComissoesDoMesDto | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    const mes = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: fuso }).format(new Date()).slice(0, 7);
    get<ComissoesDoMesDto>(`/comissoes?mes=${mes}`).then(setC, (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, [fuso]);
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!c) return <p className="carregando">Carregando…</p>;
  return (
    <div className="numero-grande">
      <strong>{formatarDinheiro(c.totalCentavos)}</strong>
      <span className="item-detalhe">{c.fechamento ? "Mês fechado pelo financeiro." : "Prévia: só vendas com pagamento confirmado."}</span>
    </div>
  );
}

function BlocoAvisos() {
  const dataHora = useDataHora();
  const [p, setP] = useState<Pagina<NotificacaoDto> | null>(null);
  const carregar = useCallback(() => {
    get<Pagina<NotificacaoDto>>("/notificacoes?limite=5").then(setP, () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  useTempoReal(["notificacao."], carregar);
  if (!p) return <p className="carregando">Carregando…</p>;
  const naoLidas = p.itens.filter((n) => !n.lidaEm);
  if (!naoLidas.length) return <ListaVazia>Tudo lido por aqui.</ListaVazia>;
  return (
    <ul className="lista">
      {naoLidas.map((n) => (
        <li key={n.id} className="item">
          <div className="item-principal">
            {n.link ? (
              <Link to={n.link}>
                <strong>{n.titulo}</strong>
              </Link>
            ) : (
              <strong>{n.titulo}</strong>
            )}
            <span className="item-detalhe">{dataHora(n.criadoEm)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Os primeiros da fila do dia do método BRE (já sem quem os limites bloqueiam). */
function BlocoFilaBre() {
  const [p, setP] = useState<Pagina<ItemFilaBreDto> | null>(null);
  const carregar = useCallback(() => {
    get<Pagina<ItemFilaBreDto>>("/bre/fila-do-dia?limite=5").then(setP, () => undefined);
  }, []);
  useEffect(carregar, [carregar]);
  useTempoReal(["bre."], carregar);
  if (!p) return <p className="carregando">Carregando…</p>;
  if (!p.itens.length) return <ListaVazia>Ninguém para contatar hoje.</ListaVazia>;
  return (
    <ul className="lista">
      {p.itens.map((i) => (
        <li key={i.id} className="item">
          <div className="item-principal">
            <Link to={`/contatos/${i.contatoId}`}>
              <strong>{i.nome}</strong>
            </Link>
            <span className="item-detalhe">{i.motivo}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConteudoBloco({ id, rotina }: { id: BlocoInicioId; rotina: ReturnType<typeof useRotina> }) {
  if (id === "atalhos") return <BlocoAtalhos />;
  if (id === "ponto") return <Ponto />;
  if (id === "funil") return <BlocoFunil />;
  if (id === "ranking") return <BlocoRanking />;
  if (id === "comissao") return <BlocoComissao />;
  if (id === "avisos") return <BlocoAvisos />;
  if (id === "bre") return <BlocoFilaBre />;
  if (rotina.erro) return <Mensagem tipo="erro">{rotina.erro}</Mensagem>;
  const r: RotinaDto | null = rotina.r;
  if (!r) return <p className="carregando">Carregando…</p>;
  if (id === "conversas") return <BlocoConversas r={r} />;
  if (id === "metas") return <BlocoMetas r={r} />;
  if (id === "agenda") return <BlocoAgenda r={r} />;
  if (id === "tarefas") return <BlocoTarefas r={r} />;
  if (id === "retornos") return <BlocoRetornos r={r} />;
  return <BlocoChecklist r={r} marcar={rotina.marcar} />;
}

function Bloco(props: { id: BlocoInicioId; editando: boolean; primeiro: boolean; ultimo: boolean; aoMover(d: -1 | 1): void; aoTirar(): void; children: ReactNode }) {
  const termos = useVocabulario();
  const info = BLOCOS_INICIO.find((b) => b.id === props.id)!;
  const nome = termos.t(info.nome);
  const link = LINKS[props.id];
  return (
    <section className={`cartao bloco ${props.editando ? "bloco-editando" : ""}`} aria-labelledby={`bloco-${props.id}`}>
      <div className="bloco-topo">
        <h2 id={`bloco-${props.id}`}>{nome}</h2>
        {props.editando ? (
          <div className="bloco-controles">
            <button type="button" className="botao-icone" aria-label={`Subir ${nome}`} disabled={props.primeiro} onClick={() => props.aoMover(-1)}>
              <Icone nome="subir" />
            </button>
            <button type="button" className="botao-icone" aria-label={`Descer ${nome}`} disabled={props.ultimo} onClick={() => props.aoMover(1)}>
              <Icone nome="descer" />
            </button>
            <button type="button" className="botao-icone" aria-label={`Tirar ${nome} do início`} onClick={props.aoTirar}>
              <Icone nome="fechar" />
            </button>
          </div>
        ) : (
          link && (
            <Link to={link[0]} className="bloco-link">
              {link[1]}
            </Link>
          )
        )}
      </div>
      {props.children}
    </section>
  );
}

export function Inicio() {
  const termos = useVocabulario();
  const eu = useEu();
  const fuso = useFuso();
  const avisar = useAviso();
  const [inicio, setInicio] = useState<InicioDto | null>(null);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState(false);
  const primeiroNome = eu.usuario.nome.split(" ")[0];
  const blocos = inicio?.blocos ?? [];
  const rotina = useRotina(blocos.some((b) => BLOCOS_DA_ROTINA.has(b)));

  useEffect(() => {
    get<InicioDto>("/inicio").then(setInicio, (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o seu início."));
  }, []);

  const salvar = async (novos: BlocoInicioId[]) => {
    const antes = inicio;
    setInicio({ blocos: novos, padrao: false });
    try {
      setInicio(await put<InicioDto>("/inicio", { blocos: novos }));
    } catch (e) {
      setInicio(antes);
      avisar(e instanceof ErroApi ? e.message : "Não foi possível salvar o seu início.", "erro");
    }
  };
  const mover = (i: number, d: -1 | 1) => {
    const novos = [...blocos];
    [novos[i], novos[i + d]] = [novos[i + d]!, novos[i]!];
    void salvar(novos);
  };
  const restaurar = async () => {
    try {
      setInicio(await del<InicioDto>("/inicio"));
      avisar("Início de volta ao padrão do seu perfil.");
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível voltar ao padrão.", "erro");
    }
  };
  const disponiveis = BLOCOS_INICIO.filter((b) => !blocos.includes(b.id) && blocoPermitido(b.id, eu.permissoes, eu.empresa?.modulos ?? []));
  const hoje = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: fuso }).format(new Date());

  return (
    <>
      <div className="titulo-pagina inicio-topo">
        <div>
          <p className="inicio-data">{hoje.charAt(0).toUpperCase() + hoje.slice(1)}</p>
          <h1>
            {saudacao(fuso)}, {primeiroNome}
          </h1>
          <p className="inicio-contexto">
            {eu.empresa?.nome} · perfil {eu.perfil?.nome}
          </p>
        </div>
        {inicio && (
          <button type="button" className={`botao ${editando ? "" : "botao-secundario"}`} aria-pressed={editando} onClick={() => setEditando((v) => !v)}>
            {editando ? "Concluir" : "Personalizar início"}
          </button>
        )}
      </div>
      <AvisoPrimeirosPassos />
      <Mensagem tipo="erro">{erro}</Mensagem>

      {editando && (
        <div className="mensagem mensagem-info inicio-ajuda">
          <span>Use as setas para mudar a ordem e o X para tirar um bloco. Tudo é salvo na hora e vale no celular e no computador.</span>
          {!inicio?.padrao && (
            <button type="button" className="botao botao-secundario" onClick={() => void restaurar()}>
              Voltar ao padrão do perfil
            </button>
          )}
        </div>
      )}

      {inicio && !blocos.length && <ListaVazia>{editando ? "Seu início está vazio. Adicione blocos abaixo." : "Seu início está vazio. Toque em Personalizar início para escolher blocos."}</ListaVazia>}
      <div className="blocos">
        {blocos.map((id, i) => (
          <Bloco key={id} id={id} editando={editando} primeiro={i === 0} ultimo={i === blocos.length - 1} aoMover={(d) => mover(i, d)} aoTirar={() => void salvar(blocos.filter((b) => b !== id))}>
            <ConteudoBloco id={id} rotina={rotina} />
          </Bloco>
        ))}
      </div>

      {editando && (
        <section className="cartao" aria-labelledby="titulo-galeria">
          <h2 id="titulo-galeria">Adicionar ao seu início</h2>
          {!disponiveis.length && <ListaVazia>Todos os blocos já estão no seu início.</ListaVazia>}
          <ul className="galeria">
            {disponiveis.map((b) => (
              <li key={b.id}>
                <div>
                  <strong>{termos.t(b.nome)}</strong>
                  <span className="item-detalhe">{termos.t(b.descricao)}</span>
                </div>
                <button type="button" className="botao botao-secundario" aria-label={`Adicionar ${termos.t(b.nome)}`} onClick={() => void salvar([...blocos, b.id])}>
                  <Icone nome="adicionar" /> Adicionar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
