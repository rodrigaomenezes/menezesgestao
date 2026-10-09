// Plano e cobrança: situação da assinatura, troca de plano (desligar módulo esconde, não apaga) e faturas.
import { useCallback, useEffect, useState } from "react";
import { MODULOS, NOMES_STATUS_ASSINATURA, NOMES_STATUS_FATURA, PLANOS, PRECOS_PLANOS, type AssinaturaDto } from "@mg/shared";
import { ErroApi, get, post, put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { ListaVazia, Mensagem, Titulo } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";

const data = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export function Plano() {
  const { pode, recarregar } = useSessao();
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const [a, setA] = useState<AssinaturaDto | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<AssinaturaDto>("/assinatura").then(setA, (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, []);
  useEffect(carregar, [carregar]);
  const admin = pode("configuracoes", "administrar");

  const trocar = async (plano: keyof typeof PRECOS_PLANOS) => {
    const sai = (a?.modulos ?? []).filter((m) => !(PLANOS[plano].modulos as readonly string[]).includes(m));
    const nomes = MODULOS.filter((m) => sai.includes(m.id)).map((m) => m.nome);
    const ok = await confirmar({
      titulo: `Mudar para o plano ${PLANOS[plano].nome}`,
      mensagem: nomes.length
        ? `Estes módulos vão sair do menu: ${nomes.join(", ")}. Nada é apagado: voltando ao plano, tudo reaparece.`
        : `O valor passa a ser ${formatarDinheiro(PRECOS_PLANOS[plano])} por mês.`,
      acao: "Mudar de plano",
    });
    if (!ok) return;
    try {
      setA(await put<AssinaturaDto>("/assinatura/plano", { plano }));
      avisar("Plano alterado.");
      await recarregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível mudar o plano.", "erro");
    }
  };
  const pagar = async (id: string) => {
    try {
      setA(await post<AssinaturaDto>(`/faturas/${id}/pagar-simulado`));
      avisar("Pagamento registrado (simulado).");
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível pagar.", "erro");
    }
  };

  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!a) return <p className="carregando">Carregando…</p>;
  return (
    <>
      <Titulo>Plano e cobrança</Titulo>
      <section className="cartao">
        <p>
          Plano <strong>{PLANOS[a.plano as keyof typeof PLANOS]?.nome ?? "Sob medida"}</strong> · {NOMES_STATUS_ASSINATURA[a.status]}
          {a.valorCentavos > 0 && ` · ${formatarDinheiro(a.valorCentavos)} por mês`}
        </p>
        {a.status === "teste" && a.testeAte && <Mensagem tipo="info">Período de teste até {data(a.testeAte)}.</Mensagem>}
        {a.status === "atrasada" && <Mensagem tipo="erro">Há fatura vencida. Pague para manter o acesso sem interrupção.</Mensagem>}
        {a.provedor === "demonstracao" && <p className="dica">Cobrança em modo de demonstração: nenhum valor é cobrado de verdade.</p>}
      </section>

      <section className="cartao" aria-labelledby="titulo-planos">
        <h2 id="titulo-planos">Planos</h2>
        <div className="planos">
          {(Object.keys(PRECOS_PLANOS) as (keyof typeof PRECOS_PLANOS)[]).map((p) => (
            <div key={p} className={`plano ${a.plano === p ? "plano-atual" : ""}`}>
              <h3>{PLANOS[p].nome}</h3>
              <p className="preco">{formatarDinheiro(PRECOS_PLANOS[p])}/mês</p>
              <ul className="lista-simples">
                {MODULOS.filter((m) => (PLANOS[p].modulos as readonly string[]).includes(m.id)).map((m) => (
                  <li key={m.id}>{m.nome}</li>
                ))}
              </ul>
              {a.plano === p ? (
                <span className="selo selo-ganha">Plano atual</span>
              ) : (
                admin && (
                  <button type="button" className="botao botao-secundario" onClick={() => void trocar(p)}>
                    Mudar para {PLANOS[p].nome}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="cartao" aria-labelledby="titulo-faturas">
        <h2 id="titulo-faturas">Faturas</h2>
        {!a.faturas.length && <ListaVazia>Nenhuma fatura ainda.</ListaVazia>}
        <ul className="lista">
          {a.faturas.map((f) => (
            <li key={f.id} className="item">
              <div className="item-principal">
                <strong>
                  {formatarDinheiro(f.valorCentavos)} · vence {data(f.vencimento)}
                </strong>
                <span className="item-detalhe">
                  <span className={`selo ${f.status === "paga" ? "selo-ganha" : f.status === "vencida" ? "selo-perdida" : ""}`}>{NOMES_STATUS_FATURA[f.status]}</span>
                </span>
              </div>
              {f.status !== "paga" && f.status !== "cancelada" && (
                <div className="item-acoes">
                  {f.link ? (
                    <a className="botao" href={f.link} target="_blank" rel="noreferrer">
                      Pagar
                    </a>
                  ) : (
                    admin && a.provedor === "demonstracao" && (
                      <button type="button" className="botao" onClick={() => void pagar(f.id)}>
                        Pagar (simulado)
                      </button>
                    )
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
