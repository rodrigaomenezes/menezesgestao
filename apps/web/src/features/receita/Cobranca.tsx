// Cobrança dos clientes pelo provedor da empresa: conta de cobrança (administrador) e cobranças da venda.
import { useCallback, useEffect, useState } from "react";
import {
  FORMAS_COBRANCA,
  NOMES_FORMAS_COBRANCA,
  NOMES_STATUS_COBRANCA,
  PROVEDORES_COBRANCA,
  type CobrancaDto,
  type ContaCobrancaDto,
  type VendaDto,
} from "@mg/shared";
import { ErroApi, get, post, put } from "../../app/api";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Escolha, Mensagem, useEnvio } from "../../ui/ui";
import { formatarDinheiro } from "../crm/comum";

/** Administrador conecta o provedor da empresa. A chave é testada, guardada cifrada e nunca volta para a tela. */
export function ContaCobranca() {
  const avisar = useAviso();
  const [conta, setConta] = useState<ContaCobrancaDto | null>(null);
  const [provedor, setProvedor] = useState("demonstracao");
  const [ambiente, setAmbiente] = useState("teste");
  const [chave, setChave] = useState("");
  useEffect(() => {
    get<{ conta: ContaCobrancaDto | null }>("/cobranca/conta").then((r) => {
      setConta(r.conta);
      if (r.conta) {
        setProvedor(r.conta.provedor);
        setAmbiente(r.conta.ambiente);
      }
    }, () => undefined);
  }, []);
  const envio = useEnvio(async () => {
    const c = await put<ContaCobrancaDto>("/cobranca/conta", { provedor, ambiente, chave: chave || undefined });
    setConta(c);
    setChave("");
    avisar("Conta de cobrança salva.");
  });
  return (
    <section className="cartao" aria-labelledby="titulo-conta-cobranca">
      <h2 id="titulo-conta-cobranca">Conta de cobrança</h2>
      <p className="dica">
        O dinheiro cai na conta da empresa, no provedor escolhido. Quando o pagamento é confirmado, a venda se confirma sozinha.
      </p>
      <form onSubmit={envio.enviar} aria-label="Conta de cobrança">
        <div className="grade-campos">
          <Escolha rotulo="Provedor" nome="cobranca-provedor" valor={provedor} aoMudar={setProvedor} opcoes={PROVEDORES_COBRANCA.map((p) => ({ valor: p.codigo, texto: p.nome }))} />
          {provedor !== "demonstracao" && (
            <>
              <Escolha
                rotulo="Ambiente"
                nome="cobranca-ambiente"
                valor={ambiente}
                aoMudar={setAmbiente}
                opcoes={[
                  { valor: "teste", texto: "Teste (sandbox)" },
                  { valor: "producao", texto: "Produção" },
                ]}
              />
              <Campo
                rotulo="Chave de API"
                nome="cobranca-chave"
                tipo="password"
                autoComplete="off"
                valor={chave}
                aoMudar={setChave}
                dica={conta?.finalChave ? `Guardada: termina em ${conta.finalChave}. Deixe vazio para manter.` : "Fica cifrada; ninguém vê depois de salvar."}
              />
            </>
          )}
        </div>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <button type="submit" className="botao" disabled={envio.enviando}>
          {envio.enviando ? "Testando…" : "Salvar conta"}
        </button>
      </form>
      {conta && conta.provedor !== "demonstracao" && (
        <div className="dica">
          <p>No painel do provedor, cadastre o aviso de pagamento (webhook):</p>
          <p>
            Endereço: <code className="quebra">{conta.urlWebhook}</code>
          </p>
          <p>
            Token de autenticação: <code className="quebra">{conta.tokenWebhook}</code>
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Cobranças de uma venda aguardando pagamento: gerar, copiar o Pix, abrir o link, cancelar, simular (demonstração).
 * Só consulta o servidor quando a pessoa abre o painel (a lista de vendas não faz uma chamada por linha).
 */
export function CobrancasDaVenda({ v, confere, aoMudar }: { v: VendaDto; confere: boolean; aoMudar(): void }) {
  const avisar = useAviso();
  const [itens, setItens] = useState<CobrancaDto[]>([]);
  const [painel, setPainel] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [forma, setForma] = useState("pix");
  const [documento, setDocumento] = useState("");
  const carregar = useCallback(() => {
    get<{ itens: CobrancaDto[] }>(`/vendas/${v.id}/cobrancas`).then((r) => setItens(r.itens), () => undefined);
  }, [v.id]);
  useEffect(() => {
    if (painel) carregar();
  }, [painel, carregar, v.status]);
  const gerar = useEnvio(async () => {
    await post(`/vendas/${v.id}/cobrancas`, { forma, documento: documento || undefined });
    avisar("Cobrança gerada.");
    setAberto(false);
    carregar();
  });
  const acao = async (c: CobrancaDto, caminho: string, aviso: string) => {
    try {
      await post(`/cobrancas/${c.id}/${caminho}`);
      avisar(aviso);
      carregar();
      aoMudar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir.", "erro");
    }
  };
  const copiar = (texto: string) => void navigator.clipboard?.writeText(texto).then(() => avisar("Pix copiado."), () => avisar("Não foi possível copiar.", "erro"));
  const emAberto = itens.some((c) => c.status === "pendente" || c.status === "vencida");
  if (v.status !== "pendente") return null;
  if (!painel)
    return (
      <div className="cobrancas">
        <button type="button" className="botao botao-secundario" aria-expanded={false} onClick={() => setPainel(true)}>
          Cobrança
        </button>
      </div>
    );
  return (
    <div className="cobrancas">
      {itens.map((c) => (
        <div key={c.id} className="item-detalhe">
          {NOMES_FORMAS_COBRANCA[c.forma]} {formatarDinheiro(c.valorCentavos)} · {NOMES_STATUS_COBRANCA[c.status]}
          {c.status === "pendente" && (
            <span className="form-linha">
              {c.pixCopiaCola && (
                <button type="button" className="botao botao-secundario" onClick={() => copiar(c.pixCopiaCola!)}>
                  Copiar Pix
                </button>
              )}
              {c.link && (
                <a className="botao botao-secundario" href={c.link} target="_blank" rel="noreferrer">
                  Abrir cobrança
                </a>
              )}
              {confere && c.provedor === "demonstracao" && (
                <button type="button" className="botao botao-secundario" onClick={() => void acao(c, "simular-pagamento", "Pagamento simulado.")}>
                  Simular pagamento
                </button>
              )}
              {confere && (
                <button type="button" className="botao botao-secundario" onClick={() => void acao(c, "cancelar", "Cobrança cancelada.")}>
                  Cancelar cobrança
                </button>
              )}
            </span>
          )}
        </div>
      ))}
      {confere && v.status === "pendente" && !emAberto && !aberto && (
        <button type="button" className="botao botao-secundario" onClick={() => setAberto(true)}>
          Gerar cobrança
        </button>
      )}
      {aberto && (
        <form className="form-linha" onSubmit={gerar.enviar} aria-label="Gerar cobrança">
          <Escolha rotulo="Forma" nome={`cobrar-forma-${v.id}`} valor={forma} aoMudar={setForma} opcoes={FORMAS_COBRANCA.map((f) => ({ valor: f, texto: NOMES_FORMAS_COBRANCA[f] }))} />
          <Campo rotulo="CPF ou CNPJ de quem paga" nome={`cobrar-doc-${v.id}`} valor={documento} aoMudar={setDocumento} />
          <button type="submit" className="botao" disabled={gerar.enviando}>
            Gerar
          </button>
          <button type="button" className="botao botao-secundario" onClick={() => setAberto(false)}>
            Voltar
          </button>
          <Mensagem tipo="erro">{gerar.erro}</Mensagem>
        </form>
      )}
    </div>
  );
}
