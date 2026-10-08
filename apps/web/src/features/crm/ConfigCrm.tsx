// Configuração do CRM (administrador): funis e etapas, etiquetas, motivos de perda e campos personalizados.
// Tudo o que muda de uma empresa para outra fica aqui — nunca no código.
import { useCallback, useEffect, useState } from "react";
import {
  NOMES_TIPOS_CAMPO,
  NOMES_TIPOS_ETAPA,
  TIPOS_CAMPO,
  TIPOS_ETAPA,
  type CampoPersonalizadoDto,
  type EtapaDto,
  type EtiquetaDto,
  type FunilDto,
  type MotivoPerdaDto,
} from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { useTermos } from "./comum";

function useCarregar<T>(caminho: string, inicial: T) {
  const [dados, setDados] = useState<T>(inicial);
  const [erro, setErro] = useState("");
  const recarregar = useCallback(() => {
    get<T>(caminho)
      .then((d) => (setDados(d), setErro("")))
      .catch((e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, [caminho]);
  useEffect(recarregar, [recarregar]);
  return { dados, erro, recarregar };
}

/** Botão Arquivar/Restaurar comum aos itens de configuração. */
function BotaoArquivo({ caminho, arquivado, aoMudar }: { caminho: string; arquivado: boolean; aoMudar(): void }) {
  const { enviando, erro, enviar } = useEnvio(async () => {
    await patch(caminho, { arquivado: !arquivado });
    aoMudar();
  });
  return (
    <>
      <button type="button" className="botao botao-secundario" disabled={enviando} onClick={() => void enviar()}>
        {arquivado ? "Restaurar" : "Arquivar"}
      </button>
      <Mensagem tipo="erro">{erro}</Mensagem>
    </>
  );
}

function EditarEtapa({ e, camposOportunidade, aoSalvar }: { e: EtapaDto; camposOportunidade: CampoPersonalizadoDto[]; aoSalvar(): void }) {
  const [nome, setNome] = useState(e.nome);
  const [tipo, setTipo] = useState<string>(e.tipo);
  const [cor, setCor] = useState(e.cor);
  const [ordem, setOrdem] = useState(String(e.ordem));
  const [probabilidade, setProbabilidade] = useState(String(e.probabilidade));
  const [exigidos, setExigidos] = useState<string[]>(e.camposObrigatorios);
  const { enviando, erro, enviar } = useEnvio(async () => {
    await patch(`/crm/etapas/${e.id}`, { nome, tipo, cor, ordem: Number(ordem), probabilidade: Number(probabilidade), camposObrigatorios: exigidos });
    aoSalvar();
  });
  const opcoes = [
    { chave: "valor", rotulo: "Valor" },
    { chave: "oferta", rotulo: "Oferta" },
    ...camposOportunidade.map((c) => ({ chave: c.chave, rotulo: c.rotulo })),
  ];
  return (
    <form className="item-edicao" onSubmit={enviar}>
      <div className="grade-campos">
        <Campo rotulo="Nome" nome={`etapa-nome-${e.id}`} valor={nome} aoMudar={setNome} obrigatorio />
        <Escolha rotulo="Tipo" nome={`etapa-tipo-${e.id}`} valor={tipo} aoMudar={setTipo} opcoes={TIPOS_ETAPA.map((t) => ({ valor: t, texto: NOMES_TIPOS_ETAPA[t] }))} />
        <Campo rotulo="Ordem" nome={`etapa-ordem-${e.id}`} tipo="number" valor={ordem} aoMudar={setOrdem} />
        <Campo rotulo="Probabilidade (%)" nome={`etapa-prob-${e.id}`} tipo="number" valor={probabilidade} aoMudar={setProbabilidade} />
        <Campo rotulo="Cor" nome={`etapa-cor-${e.id}`} tipo="color" valor={cor} aoMudar={setCor} />
      </div>
      <fieldset className="campo grupo-marcar">
        <legend>Para entrar nesta etapa, exigir</legend>
        {opcoes.map((o) => (
          <label key={o.chave} className="marcar">
            <input type="checkbox" checked={exigidos.includes(o.chave)} onChange={(ev) => setExigidos((x) => (ev.target.checked ? [...x, o.chave] : x.filter((y) => y !== o.chave)))} />
            {o.rotulo}
          </label>
        ))}
      </fieldset>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <button type="submit" className="botao" disabled={enviando}>
        Salvar etapa
      </button>
    </form>
  );
}

function Funil({ f, camposOportunidade, aoMudar }: { f: FunilDto; camposOportunidade: CampoPersonalizadoDto[]; aoMudar(): void }) {
  const avisar = useAviso();
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEtapa, setNomeEtapa] = useState("");
  const [nomeFunil, setNomeFunil] = useState(f.nome);
  const novaEtapa = useEnvio(async () => {
    const maior = Math.max(0, ...f.etapas.filter((e) => e.tipo === "aberta").map((e) => e.ordem));
    await post("/crm/etapas", { funilId: f.id, nome: nomeEtapa, ordem: maior + 1 });
    setNomeEtapa("");
    aoMudar();
  });
  const renomear = useEnvio(async () => {
    await patch(`/crm/funis/${f.id}`, { nome: nomeFunil });
    avisar("Funil renomeado.");
    aoMudar();
  });
  return (
    <section className="cartao" aria-label={`Funil ${f.nome}`}>
      <form className="form-linha" onSubmit={renomear.enviar}>
        <Campo rotulo="Nome do funil" nome={`funil-${f.id}`} valor={nomeFunil} aoMudar={setNomeFunil} obrigatorio />
        <button type="submit" className="botao botao-secundario" disabled={renomear.enviando || nomeFunil === f.nome}>
          Renomear
        </button>
        <BotaoArquivo caminho={`/crm/funis/${f.id}`} arquivado={Boolean(f.arquivadoEm)} aoMudar={aoMudar} />
      </form>
      <Mensagem tipo="erro">{renomear.erro}</Mensagem>
      <ol className="lista">
        {f.etapas.map((e) => (
          <li key={e.id} className="item">
            <div className="item-principal">
              <strong>
                <span className="ponto-cor" style={{ background: e.cor }} aria-hidden="true" /> {e.nome}
              </strong>
              <span className="item-detalhe">
                {NOMES_TIPOS_ETAPA[e.tipo]} · {e.probabilidade}%{e.camposObrigatorios.length > 0 && ` · exige ${e.camposObrigatorios.length} campo(s)`}
                {e.arquivadoEm && " · arquivada"}
              </span>
            </div>
            <div className="item-acoes">
              <button type="button" className="botao botao-secundario" aria-expanded={editando === e.id} onClick={() => setEditando((x) => (x === e.id ? null : e.id))}>
                {editando === e.id ? "Fechar" : "Editar"}
              </button>
              <BotaoArquivo caminho={`/crm/etapas/${e.id}`} arquivado={Boolean(e.arquivadoEm)} aoMudar={aoMudar} />
            </div>
            {editando === e.id && (
              <EditarEtapa
                e={e}
                camposOportunidade={camposOportunidade}
                aoSalvar={() => {
                  setEditando(null);
                  avisar("Etapa salva.");
                  aoMudar();
                }}
              />
            )}
          </li>
        ))}
      </ol>
      <form className="form-linha" onSubmit={novaEtapa.enviar}>
        <Campo rotulo="Nova etapa" nome={`nova-etapa-${f.id}`} valor={nomeEtapa} aoMudar={setNomeEtapa} obrigatorio />
        <button type="submit" className="botao" disabled={novaEtapa.enviando}>
          Adicionar etapa
        </button>
      </form>
      <Mensagem tipo="erro">{novaEtapa.erro}</Mensagem>
    </section>
  );
}

function Funis() {
  const { dados: funis, erro, recarregar } = useCarregar<FunilDto[]>("/crm/funis", []);
  const { dados: campos } = useCarregar<CampoPersonalizadoDto[]>("/crm/campos", []);
  const [nome, setNome] = useState("");
  const criar = useEnvio(async () => {
    await post("/crm/funis", { nome, ordem: funis.length });
    setNome("");
    recarregar();
  });
  const camposOportunidade = campos.filter((c) => c.entidade === "oportunidade" && !c.arquivadoEm);
  return (
    <>
      <Mensagem tipo="erro">{erro}</Mensagem>
      {funis.map((f) => (
        <Funil key={f.id} f={f} camposOportunidade={camposOportunidade} aoMudar={recarregar} />
      ))}
      <form className="cartao form-linha" onSubmit={criar.enviar}>
        <Campo rotulo="Novo funil" nome="novo-funil" valor={nome} aoMudar={setNome} obrigatorio dica="Já nasce com etapas de ganho e perda; ajuste depois." />
        <button type="submit" className="botao" disabled={criar.enviando}>
          Criar funil
        </button>
        <Mensagem tipo="erro">{criar.erro}</Mensagem>
      </form>
    </>
  );
}

function ListasSimples() {
  const { dados, erro, recarregar } = useCarregar<{ etiquetas: EtiquetaDto[]; motivosPerda: MotivoPerdaDto[] }>("/crm/listas", { etiquetas: [], motivosPerda: [] });
  const [etiqueta, setEtiqueta] = useState("");
  const [cor, setCor] = useState("#1f5fbf");
  const [motivo, setMotivo] = useState("");
  const novaEtiqueta = useEnvio(async () => {
    await post("/crm/etiquetas", { nome: etiqueta, cor });
    setEtiqueta("");
    recarregar();
  });
  const novoMotivo = useEnvio(async () => {
    await post("/crm/motivos-perda", { nome: motivo, ordem: dados.motivosPerda.length });
    setMotivo("");
    recarregar();
  });
  return (
    <>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <section className="cartao" aria-labelledby="titulo-etiquetas">
        <h2 id="titulo-etiquetas">Etiquetas</h2>
        {!dados.etiquetas.length && <ListaVazia>Nenhuma etiqueta.</ListaVazia>}
        <ul className="lista">
          {dados.etiquetas.map((e) => (
            <li key={e.id} className="item">
              <div className="item-principal">
                <strong>
                  <span className="ponto-cor" style={{ background: e.cor }} aria-hidden="true" /> {e.nome}
                </strong>
                {e.arquivadoEm && <span className="item-detalhe">Arquivada</span>}
              </div>
              <BotaoArquivo caminho={`/crm/etiquetas/${e.id}`} arquivado={Boolean(e.arquivadoEm)} aoMudar={recarregar} />
            </li>
          ))}
        </ul>
        <form className="form-linha" onSubmit={novaEtiqueta.enviar}>
          <Campo rotulo="Nova etiqueta" nome="nova-etiqueta" valor={etiqueta} aoMudar={setEtiqueta} obrigatorio />
          <Campo rotulo="Cor" nome="nova-etiqueta-cor" tipo="color" valor={cor} aoMudar={setCor} />
          <button type="submit" className="botao" disabled={novaEtiqueta.enviando}>
            Criar
          </button>
        </form>
        <Mensagem tipo="erro">{novaEtiqueta.erro}</Mensagem>
      </section>
      <section className="cartao" aria-labelledby="titulo-motivos">
        <h2 id="titulo-motivos">Motivos de perda</h2>
        <ul className="lista">
          {dados.motivosPerda.map((m) => (
            <li key={m.id} className="item">
              <div className="item-principal">
                <strong>{m.nome}</strong>
                {m.arquivadoEm && <span className="item-detalhe">Arquivado</span>}
              </div>
              <BotaoArquivo caminho={`/crm/motivos-perda/${m.id}`} arquivado={Boolean(m.arquivadoEm)} aoMudar={recarregar} />
            </li>
          ))}
        </ul>
        <form className="form-linha" onSubmit={novoMotivo.enviar}>
          <Campo rotulo="Novo motivo" nome="novo-motivo" valor={motivo} aoMudar={setMotivo} obrigatorio />
          <button type="submit" className="botao" disabled={novoMotivo.enviando}>
            Criar
          </button>
        </form>
        <Mensagem tipo="erro">{novoMotivo.erro}</Mensagem>
      </section>
    </>
  );
}

const paraChave = (rotulo: string) =>
  rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .slice(0, 40);

function Campos() {
  const termos = useTermos();
  const { dados: campos, erro, recarregar } = useCarregar<CampoPersonalizadoDto[]>("/crm/campos", []);
  const [entidade, setEntidade] = useState("contato");
  const [rotulo, setRotulo] = useState("");
  const [tipo, setTipo] = useState("texto");
  const [opcoes, setOpcoes] = useState("");
  const [obrigatorio, setObrigatorio] = useState(false);
  const criar = useEnvio(async () => {
    await post("/crm/campos", {
      entidade,
      chave: paraChave(rotulo),
      rotulo,
      tipo,
      opcoes: tipo === "lista" ? opcoes.split(/[\n;]/).map((o) => o.trim()).filter(Boolean) : [],
      obrigatorio,
      ordem: campos.length,
    });
    setRotulo("");
    setOpcoes("");
    recarregar();
  });
  const alternarObrigatorio = async (c: CampoPersonalizadoDto) => {
    await patch(`/crm/campos/${c.id}`, { obrigatorio: !c.obrigatorio });
    recarregar();
  };
  const nomeEntidade = (e: string) => (e === "contato" ? termos.Contato : termos.Oportunidade);
  return (
    <section className="cartao" aria-labelledby="titulo-campos">
      <h2 id="titulo-campos">Campos personalizados</h2>
      <Mensagem tipo="erro">{erro}</Mensagem>
      {!campos.length && <ListaVazia>Nenhum campo extra. Crie os que a sua operação precisa (ex.: curso de interesse, data de nascimento).</ListaVazia>}
      <ul className="lista">
        {campos.map((c) => (
          <li key={c.id} className="item">
            <div className="item-principal">
              <strong>{c.rotulo}</strong>
              <span className="item-detalhe">
                {nomeEntidade(c.entidade)} · {NOMES_TIPOS_CAMPO[c.tipo]}
                {c.obrigatorio && " · obrigatório"}
                {c.arquivadoEm && " · arquivado"}
              </span>
            </div>
            <div className="item-acoes">
              {!c.arquivadoEm && (
                <button type="button" className="botao botao-secundario" onClick={() => void alternarObrigatorio(c)}>
                  {c.obrigatorio ? "Tornar opcional" : "Tornar obrigatório"}
                </button>
              )}
              <BotaoArquivo caminho={`/crm/campos/${c.id}`} arquivado={Boolean(c.arquivadoEm)} aoMudar={recarregar} />
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={criar.enviar}>
        <h3>Novo campo</h3>
        <div className="grade-campos">
          <Escolha rotulo="Em" nome="campo-entidade" valor={entidade} aoMudar={setEntidade} opcoes={[{ valor: "contato", texto: termos.Contato }, { valor: "oportunidade", texto: termos.Oportunidade }]} />
          <Campo rotulo="Nome do campo" nome="campo-rotulo" valor={rotulo} aoMudar={setRotulo} obrigatorio />
          <Escolha rotulo="Tipo" nome="campo-tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS_CAMPO.map((t) => ({ valor: t, texto: NOMES_TIPOS_CAMPO[t] }))} />
        </div>
        {tipo === "lista" && (
          <div className="campo">
            <label htmlFor="campo-opcoes">Opções (uma por linha)</label>
            <textarea id="campo-opcoes" rows={4} value={opcoes} onChange={(e) => setOpcoes(e.target.value)} required />
          </div>
        )}
        <label className="marcar">
          <input type="checkbox" checked={obrigatorio} onChange={(e) => setObrigatorio(e.target.checked)} />
          Obrigatório no cadastro
        </label>
        <Mensagem tipo="erro">{criar.erro}</Mensagem>
        <button type="submit" className="botao" disabled={criar.enviando || !paraChave(rotulo)}>
          Criar campo
        </button>
      </form>
    </section>
  );
}

const ABAS = [
  { id: "funis", texto: "Funis e etapas" },
  { id: "listas", texto: "Etiquetas e motivos" },
  { id: "campos", texto: "Campos" },
] as const;

export function ConfigCrm() {
  const [aba, setAba] = useState<(typeof ABAS)[number]["id"]>("funis");
  return (
    <>
      <Titulo>Configurar CRM</Titulo>
      <div className="abas" role="tablist" aria-label="Seções">
        {ABAS.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? "ativa" : ""} onClick={() => setAba(a.id)}>
            {a.texto}
          </button>
        ))}
      </div>
      {aba === "funis" && <Funis />}
      {aba === "listas" && <ListasSimples />}
      {aba === "campos" && <Campos />}
    </>
  );
}
