// Plano e cobrança: situação da assinatura, troca de plano (desligar módulo esconde, não apaga) e faturas.
import { useCallback, useEffect, useState } from "react";
import {
  LIMITES_PLANOS,
  MODULOS,
  NOMES_RECURSOS_PLANO,
  NOMES_STATUS_ASSINATURA,
  NOMES_STATUS_FATURA,
  PLANOS,
  PRECOS_PLANOS,
  type AssinaturaDto,
  type UsoPlanoDto,
} from "@mg/shared";
import { formatarBytes } from "../plataforma/formato";
import { ErroApi, get, post, put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { Carregando, Titulo, ListaVazia, Mensagem } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";
import { useVocabulario } from "../../app/vocabulario";

const data = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const valor = (u: Pick<UsoPlanoDto, "recurso">, n: number) => (u.recurso === "armazenamento" ? formatarBytes(n) : String(n));

/** Uso contra o limite do plano: barra fica de alerta a partir de 90%. */
function Medidor({ u }: { u: UsoPlanoDto }) {
  const pct = u.limite ? Math.min(100, Math.round((u.usado / u.limite) * 100)) : 0;
  return (
    <div className="medidor">
      <div className="medidor-rotulo">
        <span>{NOMES_RECURSOS_PLANO[u.recurso]}</span>
        <span>{u.limite === null ? `${valor(u, u.usado)} (sem limite)` : `${valor(u, u.usado)} de ${valor(u, u.limite)}`}</span>
      </div>
      {u.limite !== null && (
        <div className={`medidor-barra ${pct >= 90 ? "medidor-alerta" : ""}`} role="meter" aria-label={NOMES_RECURSOS_PLANO[u.recurso]} aria-valuemin={0} aria-valuemax={u.limite} aria-valuenow={u.usado}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function Plano() {
  const termos = useVocabulario();
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
    const nomes = MODULOS.filter((m) => sai.includes(m.id)).map((m) => termos.t(m.nome));
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
      await recarregar(); // tira o aviso de atraso / só consulta na hora
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível pagar.", "erro");
    }
  };

  if (erro) return <Mensagem tipo="erro">{erro}</Mensagem>;
  if (!a) return <Carregando />;
  return (
    <>
      <Titulo>Plano e cobrança</Titulo>
      <section className="cartao">
        <p>
          Plano <strong>{PLANOS[a.plano as keyof typeof PLANOS]?.nome ?? "Sob medida"}</strong> · {NOMES_STATUS_ASSINATURA[a.status]}
          {a.valorCentavos > 0 && ` · ${formatarDinheiro(a.valorCentavos)} por mês`}
        </p>
        {a.status === "teste" && a.testeAte && <Mensagem tipo="info">Período de teste até {data(a.testeAte)}.</Mensagem>}
        {a.status === "atrasada" && <Mensagem tipo="erro">Há fatura vencida. Depois de 7 dias de atraso a empresa fica só para consulta (nada é apagado); ao pagar, volta na hora.</Mensagem>}
        {a.status === "suspensa" && <Mensagem tipo="erro">A empresa está suspensa: só consulta. Fale com o suporte na central de ajuda.</Mensagem>}
        {a.provedor === "demonstracao" && <p className="dica">Cobrança em modo de demonstração: nenhum valor é cobrado de verdade.</p>}
      </section>

      <section className="cartao" aria-labelledby="titulo-uso">
        <h2 id="titulo-uso">Uso do plano</h2>
        {a.uso.map((u) => (
          <Medidor key={u.recurso} u={u} />
        ))}
        <p className="dica">Passar do limite não apaga nada: só impede acrescentar. Para crescer, mude de plano.</p>
      </section>

      <section className="cartao" aria-labelledby="titulo-planos">
        <h2 id="titulo-planos">Planos</h2>
        <div className="planos">
          {(Object.keys(PRECOS_PLANOS) as (keyof typeof PRECOS_PLANOS)[]).map((p) => (
            <div key={p} className={`plano ${a.plano === p ? "plano-atual" : ""}`}>
              <h3>{PLANOS[p].nome}</h3>
              <p className="preco">{formatarDinheiro(PRECOS_PLANOS[p])}/mês</p>
              <p className="dica">
                Até {LIMITES_PLANOS[p].usuarios} pessoas · {LIMITES_PLANOS[p].canais} canal(is) · {formatarBytes(LIMITES_PLANOS[p].armazenamento)}
              </p>
              <ul className="lista-simples">
                {MODULOS.filter((m) => (PLANOS[p].modulos as readonly string[]).includes(m.id)).map((m) => (
                  <li key={m.id}>{termos.t(m.nome)}</li>
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
