// Configurações › Segmento e termos: o segmento traz os termos e os campos típicos; cada termo tem singular,
// plural e gênero, e a prévia mostra como as telas vão falar. Os módulos são os mesmos para todo segmento.
import { useEffect, useState } from "react";
import { SEGMENTOS, TERMOS, termo, type ConfigMarcaDto } from "@mg/shared";
import { put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { termosDe, useVocabulario } from "../../app/vocabulario";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { Campo, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { useConfigMarca } from "./Marca";

/** Prévia com frases reais das telas. */
function Previa({ vocabulario }: { vocabulario: Record<string, string> }) {
  const { t } = termosDe(vocabulario);
  const frases = [
    t("Menu: {Contatos} · Funil · {Ofertas}"),
    t("Botões: {Novo contato} · {Nova oportunidade} · {Nova entrega}"),
    t("Lista vazia: {Nenhum contato} ainda."),
    t("Erro: {Contato} não encontrad{o|a:contato} na sua carteira."),
    t("Agenda: {Entrega} com {o prestador} Paulo"),
    t("Ranking: {Colaboradores} que mais venderam"),
    t("Filtro: {Unidade} Centro"),
  ];
  return (
    <section className="cartao" aria-labelledby="titulo-previa">
      <h2 id="titulo-previa">Assim vai aparecer</h2>
      <ul className="lista-simples">
        {frases.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p className="dica">Conversas, fila de ligações, funil, agenda, metas, comissão e relatórios são os mesmos em todo segmento: só os nomes mudam.</p>
    </section>
  );
}

function EscolherSegmento({ config, aoSalvar }: { config: ConfigMarcaDto; aoSalvar(c: ConfigMarcaDto): void }) {
  const { recarregar } = useSessao();
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const [segmento, setSegmento] = useState(config.segmento ?? "");
  const nome = SEGMENTOS.find((s) => s.id === segmento)?.nome ?? "";
  const envio = useEnvio(async () => {
    const ok = await confirmar({
      titulo: "Aplicar segmento",
      mensagem: `Os termos voltam ao padrão de “${nome}” e os campos típicos que faltam são criados. Funis, etapas e dados ficam como estão.`,
      acao: "Aplicar",
    });
    if (!ok) return;
    aoSalvar(await put<ConfigMarcaDto>("/empresa/segmento", { segmento }));
    await recarregar();
    avisar("Segmento aplicado. As telas já usam os novos termos.");
  });
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-labelledby="titulo-segmento">
      <h2 id="titulo-segmento">1. Segmento</h2>
      <p className="dica">Começa com os termos e os campos mais comuns do seu negócio. Depois ajuste o que quiser.</p>
      <div className="segmentos" role="radiogroup" aria-label="Segmento">
        {SEGMENTOS.map((s) => (
          <label key={s.id} className={`segmento ${segmento === s.id ? "escolhido" : ""}`}>
            <input type="radio" name="segmento" value={s.id} checked={segmento === s.id} onChange={() => setSegmento(s.id)} />
            <strong>
              {s.nome}
              {config.segmento === s.id && <span className="selo">atual</span>}
            </strong>
            <span className="item-detalhe">{termosDe(s.vocabulario as Record<string, string>).t("{Contato}, {oportunidade}, {entrega}")}</span>
          </label>
        ))}
      </div>
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando || !segmento}>
        {config.segmento && segmento === config.segmento ? "Voltar ao padrão do segmento" : "Aplicar segmento"}
      </button>
    </form>
  );
}

function EditarTermos({ config, aoSalvar, aoMudar }: { config: ConfigMarcaDto; aoSalvar(c: ConfigMarcaDto): void; aoMudar(v: Record<string, string>): void }) {
  const { recarregar } = useSessao();
  const avisar = useAviso();
  const [vocab, setVocab] = useState<Record<string, string>>(config.vocabulario);
  useEffect(() => setVocab(config.vocabulario), [config.vocabulario]);
  useEffect(() => aoMudar(vocab), [vocab, aoMudar]);
  const mudar = (chave: string, valor: string) => setVocab((v) => ({ ...v, [chave]: valor }));
  const envio = useEnvio(async () => {
    const limpo = Object.fromEntries(Object.entries(vocab).filter(([k, v]) => v.trim() && (!k.endsWith("_genero") || vocab[k.replace(/_genero$/, "")]?.trim())));
    aoSalvar(await put<ConfigMarcaDto>("/empresa/vocabulario", limpo));
    await recarregar();
    avisar("Termos salvos. As telas já usam os novos nomes.");
  });
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-labelledby="titulo-termos">
      <h2 id="titulo-termos">2. Termos</h2>
      <p className="dica">Em branco, vale o termo padrão. Plural só se não for o regular (ex.: sessão → sessões). O gênero acerta “novo/nova” e “encontrado/encontrada”.</p>
      {TERMOS.map((t) => {
        const atual = termo(vocab, t.chave);
        return (
          <fieldset key={t.chave} className="termo">
            <legend>
              {t.rotulo} <span className="item-detalhe">· {t.ajuda}</span>
            </legend>
            <div className="grade-campos">
              <Campo rotulo={`Singular (padrão: ${t.padrao})`} nome={`vocab-${t.chave}`} valor={vocab[t.chave] ?? ""} aoMudar={(v) => mudar(t.chave, v)} />
              <Campo rotulo="Plural (opcional)" nome={`vocab-${t.chave}-plural`} valor={vocab[`${t.chave}_plural`] ?? ""} aoMudar={(v) => mudar(`${t.chave}_plural`, v)} />
            </div>
            <div className="genero" role="radiogroup" aria-label={`Gênero de ${atual.singular}`}>
              {(["o", "a"] as const).map((g) => (
                <label key={g}>
                  <input type="radio" name={`genero-${t.chave}`} value={g} checked={atual.genero === g} onChange={() => mudar(`${t.chave}_genero`, g)} />
                  {g === "o" ? `o ${atual.singular}` : `a ${atual.singular}`}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Salvar termos
      </button>
    </form>
  );
}

export function SegmentoTermos() {
  const { pode } = useSessao();
  const termos = useVocabulario();
  const marca = useConfigMarca();
  const [edicao, setEdicao] = useState<Record<string, string>>({});
  return (
    <>
      <Titulo>Segmento e termos</Titulo>
      <p className="dica">{termos.t("Como sua empresa chama as coisas: hoje, quem compra é “{contato}” e cada negócio é “{oportunidade}”.")}</p>
      <Mensagem tipo="erro">{marca.erro}</Mensagem>
      {marca.config && (
        <fieldset className="sem-borda" disabled={!pode("configuracoes", "editar")}>
          <EscolherSegmento config={marca.config} aoSalvar={marca.setConfig} />
          <EditarTermos config={marca.config} aoSalvar={marca.setConfig} aoMudar={setEdicao} />
          <Previa vocabulario={edicao} />
        </fieldset>
      )}
    </>
  );
}
