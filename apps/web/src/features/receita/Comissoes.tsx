// Comissões do mês (prévia ou retrato do fechamento), regras e fechamento — o fechamento é do financeiro.
import { useCallback, useEffect, useState } from "react";
import type { ComissoesDoMesDto, OfertaDto, Pagina, RegraComissaoDto } from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useDataHora, useEu } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";
import { mesAtual, nomeDoMes, somarMeses, useFuso } from "../operacao/comum";
import { paraCentavos, useTermosReceita } from "./comum";

const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

function descreverRegra(r: RegraComissaoDto): string {
  if (r.tipo === "percentual") return pct(r.percentual ?? 0);
  return (r.faixas ?? []).map((f) => (f.ateCentavos === null ? `acima: ${pct(f.percentual)}` : `até ${formatarDinheiro(f.ateCentavos)}: ${pct(f.percentual)}`)).join(" · ");
}

function NovaRegra({ aoCriar }: { aoCriar(): void }) {
  const termos = useTermosReceita();
  const avisar = useAviso();
  const [ofertas, setOfertas] = useState<OfertaDto[]>([]);
  const [nome, setNome] = useState("");
  const [ofertaId, setOfertaId] = useState("");
  const [tipo, setTipo] = useState("percentual");
  const [percentual, setPercentual] = useState("");
  const [faixas, setFaixas] = useState([
    { ate: "", percentual: "" },
    { ate: "", percentual: "" },
  ]);
  useEffect(() => {
    get<Pagina<OfertaDto>>("/ofertas?limite=100").then((p) => setOfertas(p.itens), () => undefined);
  }, []);
  const numero = (s: string) => Number(s.replace(",", "."));
  const envio = useEnvio(async () => {
    await post("/comissoes/regras", {
      nome,
      ofertaId: ofertaId || null,
      tipo,
      percentual: tipo === "percentual" ? numero(percentual) : null,
      faixas: tipo === "faixa" ? faixas.map((f, i) => ({ ateCentavos: i === faixas.length - 1 ? null : paraCentavos(f.ate), percentual: numero(f.percentual) })) : null,
    });
    avisar("Regra criada.");
    setNome("");
    aoCriar();
  });
  return (
    <form onSubmit={envio.enviar} aria-label="Nova regra de comissão">
      <div className="grade-campos">
        <Campo rotulo="Nome da regra" nome="regra-nome" valor={nome} aoMudar={setNome} obrigatorio />
        <Escolha rotulo={`Vale para`} nome="regra-oferta" valor={ofertaId} aoMudar={setOfertaId} vazio={`Todas (regra geral)`} opcoes={ofertas.map((o) => ({ valor: o.id, texto: `${termos.Oferta}: ${o.nome}` }))} />
        <Escolha
          rotulo="Tipo"
          nome="regra-tipo"
          valor={tipo}
          aoMudar={setTipo}
          opcoes={[
            { valor: "percentual", texto: "Percentual fixo" },
            { valor: "faixa", texto: "Por faixa do total vendido no mês" },
          ]}
        />
        {tipo === "percentual" && <Campo rotulo="Percentual (%)" nome="regra-percentual" valor={percentual} aoMudar={setPercentual} obrigatorio />}
      </div>
      {tipo === "faixa" && (
        <fieldset className="faixas">
          <legend>Faixas (o percentual da faixa alcançada vale para o total)</legend>
          {faixas.map((f, i) => (
            <div key={i} className="form-linha">
              {i < faixas.length - 1 ? (
                <Campo rotulo={`Até (R$) — faixa ${i + 1}`} nome={`faixa-ate-${i}`} valor={f.ate} aoMudar={(v) => setFaixas(faixas.map((x, j) => (j === i ? { ...x, ate: v } : x)))} obrigatorio />
              ) : (
                <span className="item-detalhe">Acima disso</span>
              )}
              <Campo rotulo={`Percentual (%) — faixa ${i + 1}`} nome={`faixa-pct-${i}`} valor={f.percentual} aoMudar={(v) => setFaixas(faixas.map((x, j) => (j === i ? { ...x, percentual: v } : x)))} obrigatorio />
            </div>
          ))}
          <button type="button" className="link-secundario" onClick={() => setFaixas([{ ate: "", percentual: "" }, ...faixas])}>
            Adicionar faixa
          </button>
        </fieldset>
      )}
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        Criar regra
      </button>
    </form>
  );
}

export function Comissoes() {
  const eu = useEu();
  const fuso = useFuso();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const financeiro = eu.permissoes.vendas?.editar === "empresa";
  const [mes, setMes] = useState(() => somarMeses(mesAtual(fuso), -1));
  const [dados, setDados] = useState<ComissoesDoMesDto | null>(null);
  const [regras, setRegras] = useState<RegraComissaoDto[]>([]);
  const [erro, setErro] = useState("");
  const [motivo, setMotivo] = useState("");
  const carregar = useCallback(() => {
    get<ComissoesDoMesDto>(`/comissoes?mes=${mes}`).then(
      (d) => (setDados(d), setErro("")),
      (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar as comissões."),
    );
    get<{ itens: RegraComissaoDto[] }>("/comissoes/regras").then((r) => setRegras(r.itens), () => undefined);
  }, [mes]);
  useEffect(carregar, [carregar]);
  useTempoReal(["venda.", "comissao.", "regra_comissao."], carregar);

  const fechar = useEnvio(async () => {
    await post("/comissoes/fechamentos", { mes });
    avisar(`${nomeDoMes(mes)} fechado. As vendas do mês não podem mais ser alteradas.`);
    carregar();
  });
  const reabrir = useEnvio(async () => {
    if (!dados?.fechamento) return;
    await post(`/comissoes/fechamentos/${dados.fechamento.id}/reabrir`, { motivo });
    avisar("Mês reaberto.");
    setMotivo("");
    carregar();
  });
  const arquivarRegra = async (r: RegraComissaoDto) => {
    try {
      await patch(`/comissoes/regras/${r.id}`, { arquivar: true });
      avisar("Regra arquivada. Meses já fechados não mudam.");
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível arquivar.", "erro");
    }
  };

  return (
    <>
      <Titulo>Comissões</Titulo>
      <section className="cartao">
        <div className="navegar-periodo">
          <button type="button" className="botao botao-secundario" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>
            ←
          </button>
          <strong>{nomeDoMes(mes)}</strong>
          <button type="button" className="botao botao-secundario" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>
            →
          </button>
        </div>
        <Mensagem tipo="erro">{erro}</Mensagem>
        {dados && (
          <>
            {dados.fechamento ? (
              <Mensagem tipo="sucesso">
                Mês fechado em {dataHora(dados.fechamento.fechadoEm)} por {dados.fechamento.fechadoPorNome}. Os valores abaixo são os do fechamento.
              </Mensagem>
            ) : (
              <Mensagem tipo="info">Prévia: conta as vendas confirmadas do mês com as regras de hoje.</Mensagem>
            )}
            {dados.semRegra > 0 && <Mensagem tipo="info">{dados.semRegra} venda(s) confirmada(s) não têm regra e não geram comissão.</Mensagem>}
            {!dados.linhas.length && <ListaVazia>Nenhuma comissão neste mês.</ListaVazia>}
            <ul className="lista" aria-label="Comissões do mês">
              {dados.linhas.map((l) => (
                <li key={`${l.vendedorId}-${l.regraId}`} className="item">
                  <div className="item-principal">
                    <strong>
                      {l.vendedorNome} · {formatarDinheiro(l.valorCentavos)}
                    </strong>
                    <span className="item-detalhe">
                      {l.regraNome}: {l.vendas} venda(s), base {formatarDinheiro(l.baseCentavos)} × {pct(l.percentual)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="numeros-venda">
              Total: <strong>{formatarDinheiro(dados.totalCentavos)}</strong>
            </p>
            {financeiro && !dados.fechamento && (
              <button type="button" className="botao" disabled={fechar.enviando} onClick={() => void fechar.enviar()}>
                Fechar {nomeDoMes(mes)}
              </button>
            )}
            {financeiro && dados.fechamento && (
              <form className="form-linha" onSubmit={reabrir.enviar}>
                <Campo rotulo="Motivo da reabertura" nome="comissao-reabrir" valor={motivo} aoMudar={setMotivo} obrigatorio />
                <button type="submit" className="botao botao-secundario" disabled={reabrir.enviando}>
                  Reabrir mês
                </button>
              </form>
            )}
            <Mensagem tipo="erro">{fechar.erro || reabrir.erro}</Mensagem>
          </>
        )}
      </section>

      <section className="cartao" aria-labelledby="titulo-regras">
        <h2 id="titulo-regras">Regras</h2>
        {!regras.length && <ListaVazia>Nenhuma regra ativa.</ListaVazia>}
        <ul className="lista">
          {regras.map((r) => (
            <li key={r.id} className="item">
              <div className="item-principal">
                <strong>{r.nome}</strong>
                <span className="item-detalhe">
                  {r.ofertaNome ?? "Regra geral"} · {descreverRegra(r)}
                </span>
              </div>
              {financeiro && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => void arquivarRegra(r)}>
                    Arquivar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {financeiro && <NovaRegra aoCriar={carregar} />}
      </section>
    </>
  );
}

