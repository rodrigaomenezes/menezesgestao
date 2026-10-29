// Possíveis duplicados e fusão em 3 passos (Konecta RF-CRM-004/008): 1) qual cadastro fica, 2) qual valor fica em
// cada campo diferente, 3) conferir e fundir. Só para quem cuida da carteira da equipe ou da empresa.
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CAMPOS_FUSAO,
  NOMES_CAMPOS_FUSAO,
  NOMES_MOTIVOS_DUPLICIDADE,
  type CampoFusao,
  type ContatoDto,
  type FusaoDto,
  type ParDuplicadoDto,
} from "@mg/shared";
import { ErroApi, get, post } from "../../app/api";
import { useDataHora, useEu, useSessao } from "../../app/sessao";
import { useVocabulario } from "../../app/vocabulario";
import { useAviso } from "../../ui/sobreposicoes";
import { Carregando, CarregarMais, ListaVazia, Mensagem, Titulo, useEnvio, usePaginado } from "../../ui/ui";
import { formatarTelefone } from "./comum";

/** Fundir é de quem arquiva numa carteira maior que a própria (o servidor confere o mesmo). */
export function usePodeFundir(): boolean {
  const { pode } = useSessao();
  const eu = useEu();
  return pode("crm", "arquivar") && eu.permissoes.crm?.arquivar !== "proprio";
}

export function Duplicados() {
  const termos = useVocabulario();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const podeFundir = usePodeFundir();
  const lista = usePaginado<ParDuplicadoDto>("/contatos/duplicados?limite=30");
  const ignorar = async (p: ParDuplicadoDto) => {
    try {
      await post("/contatos/duplicados/ignorar", { contatoA: p.a.id, contatoB: p.b.id });
      avisar("O par saiu da lista.");
      void lista.recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível marcar. Tente de novo.", "erro");
    }
  };
  if (!podeFundir) {
    return (
      <>
        <Titulo>Possíveis duplicados</Titulo>
        <Mensagem tipo="info">Esta lista é para quem cuida da carteira da equipe ou da empresa. Peça ao seu gestor.</Mensagem>
      </>
    );
  }
  const resumo = (c: ParDuplicadoDto["a"]) => (
    <div className="item-principal">
      <Link to={`/contatos/${c.id}`}>
        <strong>{c.nome}</strong>
      </Link>
      <span className="item-detalhe">{[c.telefone ? formatarTelefone(c.telefone) : null, c.email].filter(Boolean).join(" · ") || "Sem telefone nem e-mail"}</span>
      <span className="item-detalhe">
        {c.responsavelNome ?? "Sem responsável"} · desde {dataHora(c.criadoEm)}
      </span>
    </div>
  );
  return (
    <>
      <p className="trilha">
        <Link to="/contatos">{termos.Contatos}</Link>
      </p>
      <Titulo>Possíveis duplicados</Titulo>
      <p className="item-detalhe">Cadastros ativos com o mesmo e-mail ou o mesmo nome. Compare e funda, ou marque que não são a mesma pessoa.</p>
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      {lista.carregando && !lista.itens.length && <Carregando />}
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhum possível duplicado agora.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((p) => (
          <li key={`${p.a.id}-${p.b.id}`} className="item cartao par-duplicado">
            <span className="selo">{p.motivos.map((m) => NOMES_MOTIVOS_DUPLICIDADE[m]).join(" e ")}</span>
            {resumo(p.a)}
            {resumo(p.b)}
            <div className="item-acoes">
              <Link className="botao" to={`/contatos/fundir?a=${p.a.id}&b=${p.b.id}`}>
                Comparar e fundir
              </Link>
              <button type="button" className="botao botao-secundario" onClick={() => void ignorar(p)}>
                Não é duplicado
              </button>
            </div>
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
    </>
  );
}

const PASSOS = ["Qual fica", "Campo a campo", "Conferir e fundir"] as const;

/** O valor de cada campo como a pessoa lê (documento só mascarado; responsável e empresa pelo nome). */
function valorDe(c: ContatoDto, campo: CampoFusao): string | null {
  switch (campo) {
    case "nome":
      return c.nome;
    case "tipo":
      return c.tipo === "empresa" ? "Empresa" : "Pessoa";
    case "telefone":
      return c.telefone ? formatarTelefone(c.telefone) : null;
    case "email":
      return c.email;
    case "documento":
      return c.documentoMascarado;
    case "origem":
      return c.origem;
    case "responsavel":
      return c.responsavelNome;
    case "organizacao":
      return c.organizacaoNome;
  }
}

export function Fundir() {
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const avisar = useAviso();
  const termos = useVocabulario();
  const podeFundir = usePodeFundir();
  const [contatos, setContatos] = useState<ContatoDto[] | null>(null);
  const [erro, setErro] = useState("");
  const [passo, setPasso] = useState(1);
  const [destinoId, setDestinoId] = useState("");
  const [manter, setManter] = useState<Partial<Record<CampoFusao, "destino" | "origem">>>({});

  useEffect(() => {
    const ids = [busca.get("a"), busca.get("b")].filter((x): x is string => Boolean(x));
    if (ids.length !== 2) {
      setErro("Escolha dois cadastros na lista de possíveis duplicados.");
      return;
    }
    Promise.all(ids.map((id) => get<ContatoDto>(`/contatos/${id}`)))
      .then((cs) => (setContatos(cs), setDestinoId(cs[0]!.id)))
      .catch((e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível abrir os cadastros."));
  }, [busca]);

  const destino = contatos?.find((c) => c.id === destinoId);
  const origem = contatos?.find((c) => c.id !== destinoId);
  const fundir = useEnvio(async () => {
    if (!destino || !origem) return;
    await post<FusaoDto>(`/contatos/${destino.id}/fundir`, { origemId: origem.id, manter });
    avisar("Cadastros fundidos. O histórico dos dois está aqui.");
    navegar(`/contatos/${destino.id}`);
  });

  if (!podeFundir) return <Mensagem tipo="info">Fundir cadastros é para quem cuida da carteira da equipe ou da empresa.</Mensagem>;
  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!contatos || !destino || !origem) return <Carregando />;

  // Só os campos em que os dois têm valor e os valores diferem pedem escolha; vazio de um lado fica com o outro.
  const diferentes = CAMPOS_FUSAO.filter((c) => {
    const [d, o] = [valorDe(destino, c), valorDe(origem, c)];
    return d && o && d !== o;
  });
  const fica = (campo: CampoFusao) => {
    const lado = manter[campo] ?? "destino";
    return (lado === "origem" ? valorDe(origem, campo) : valorDe(destino, campo)) ?? valorDe(destino, campo) ?? valorDe(origem, campo);
  };

  return (
    <>
      <p className="trilha">
        <Link to="/contatos/duplicados">Possíveis duplicados</Link>
      </p>
      <Titulo>Fundir cadastros</Titulo>
      <ol className="passos" aria-label="Passos">
        {PASSOS.map((p, i) => (
          <li key={p} className={i + 1 === passo ? "atual" : i + 1 < passo ? "feito" : ""} aria-current={i + 1 === passo ? "step" : undefined}>
            <span>{i + 1}</span> {p}
          </li>
        ))}
      </ol>

      {passo === 1 && (
        <section className="cartao" aria-label="Passo 1: qual cadastro fica">
          <h2>Qual cadastro fica?</h2>
          <p className="item-detalhe">O outro vai para a lixeira, marcado como fundido. Tudo o que é dele passa para o que fica.</p>
          <fieldset className="escolha-fusao">
            <legend className="sr-only">Cadastro que fica</legend>
            {contatos.map((c) => (
              <label key={c.id} className="marcar">
                <input type="radio" name="destino" checked={destinoId === c.id} onChange={() => (setDestinoId(c.id), setManter({}))} />
                <span>
                  <strong>{c.nome}</strong>
                  <span className="item-detalhe">
                    {" "}
                    {[c.telefone ? formatarTelefone(c.telefone) : null, c.email, c.responsavelNome].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="botao" onClick={() => setPasso(2)}>
            Continuar
          </button>
        </section>
      )}

      {passo === 2 && (
        <section className="cartao" aria-label="Passo 2: campo a campo">
          <h2>Qual valor fica em cada campo?</h2>
          {!diferentes.length && <p>Os dois cadastros não têm valores diferentes. Pode seguir.</p>}
          {diferentes.map((campo) => (
            <fieldset key={campo} className="escolha-fusao">
              <legend>{NOMES_CAMPOS_FUSAO[campo]}</legend>
              {(["destino", "origem"] as const).map((lado) => (
                <label key={lado} className="marcar">
                  <input type="radio" name={`campo-${campo}`} checked={(manter[campo] ?? "destino") === lado} onChange={() => setManter((m) => ({ ...m, [campo]: lado }))} />
                  {valorDe(lado === "destino" ? destino : origem, campo)}
                </label>
              ))}
            </fieldset>
          ))}
          <p className="item-detalhe">Telefone e e-mail que não ficarem como principais continuam no cadastro, em "Outros telefones e e-mails".</p>
          <div className="item-acoes">
            <button type="button" className="botao botao-secundario" onClick={() => setPasso(1)}>
              Voltar
            </button>
            <button type="button" className="botao" onClick={() => setPasso(3)}>
              Continuar
            </button>
          </div>
        </section>
      )}

      {passo === 3 && (
        <section className="cartao" aria-label="Passo 3: conferir e fundir">
          <h2>Conferir e fundir</h2>
          <dl className="dados">
            {CAMPOS_FUSAO.filter((c) => fica(c)).map((c) => (
              <div key={c}>
                <dt>{NOMES_CAMPOS_FUSAO[c]}</dt>
                <dd>{fica(c)}</dd>
              </div>
            ))}
          </dl>
          <ul className="texto-livre">
            <li>
              <strong>{origem.nome}</strong> vai para a lixeira, marcad{termos.t("{o|a:contato}")} como fundid{termos.t("{o|a:contato}")}, e não pode ser restaurad{termos.t("{o|a:contato}")}.
            </li>
            <li>Oportunidades, tarefas, notas, conversas, ligações, vendas, endereços e etiquetas passam para {destino.nome}.</li>
            <li>A fusão fica registrada com quem fez, quando e o que foi incorporado.</li>
          </ul>
          <Mensagem tipo="erro">{fundir.erro}</Mensagem>
          <div className="item-acoes">
            <button type="button" className="botao botao-secundario" onClick={() => setPasso(2)}>
              Voltar
            </button>
            <button type="button" className="botao botao-perigo" disabled={fundir.enviando} onClick={() => void fundir.enviar()}>
              {fundir.enviando ? "Fundindo…" : "Fundir cadastros"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
