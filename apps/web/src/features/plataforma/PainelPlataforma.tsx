// Painel da plataforma (só equipe em PLATAFORMA_ADMINS): todas as empresas, saúde, e as ações de suporte comercial.
import { useState } from "react";
import { NOMES_STATUS_ASSINATURA, PLANOS, type EmpresaPlataformaDto } from "@mg/shared";
import { ErroApi, post, put, query } from "../../app/api";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { CarregarMais, Campo, Escolha, ListaVazia, Mensagem, Titulo, usePaginado } from "../../ui/ui";
import { formatarBytes } from "./formato";

const SELO_SAUDE = { boa: "selo-ganha", atencao: "selo-atencao", risco: "selo-perdida" } as const;
const NOME_SAUDE = { boa: "Boa", atencao: "Atenção", risco: "Risco" } as const;

function LinhaEmpresa({ e, aoMudar }: { e: EmpresaPlataformaDto; aoMudar(): void }) {
  const avisar = useAviso();
  const confirmar = useConfirmar();
  const [acao, setAcao] = useState<"" | "suspender" | "teste">("");
  const [motivo, setMotivo] = useState("");
  const [dias, setDias] = useState("7");
  const fazer = async (fn: () => Promise<unknown>, aviso: string) => {
    try {
      await fn();
      avisar(aviso);
      setAcao("");
      aoMudar();
    } catch (err) {
      avisar(err instanceof ErroApi ? err.message : "Não foi possível concluir.", "erro");
    }
  };
  const trocarPlano = async (plano: string) => {
    if (plano === e.plano) return;
    const ok = await confirmar({ titulo: `Mudar ${e.nome} para o plano ${PLANOS[plano as keyof typeof PLANOS].nome}?`, mensagem: "Módulos fora do plano saem do menu (nada é apagado).", acao: "Mudar plano" });
    if (ok) await fazer(() => put(`/plataforma/empresas/${e.id}/plano`, { plano }), "Plano alterado.");
  };
  return (
    <li className="item">
      <div className="item-principal">
        <strong>
          {e.nome} <span className={`selo ${SELO_SAUDE[e.saude]}`}>{NOME_SAUDE[e.saude]}</span>
        </strong>
        <span className="item-detalhe">
          {PLANOS[e.plano as keyof typeof PLANOS]?.nome ?? "Sob medida"} · {NOMES_STATUS_ASSINATURA[e.status]}
          {e.status === "teste" && e.testeAte && ` até ${e.testeAte.split("-").reverse().join("/")}`}
          {e.diasAtraso > 0 && ` · ${e.diasAtraso} dia(s) de atraso`}
        </span>
        <span className="item-detalhe">
          {e.pessoas} pessoa(s) · {e.canais} canal(is) · {formatarBytes(e.armazenamentoBytes)} · última atividade{" "}
          {e.ultimaAtividade ? new Date(e.ultimaAtividade).toLocaleDateString("pt-BR") : "nunca"}
        </span>
        {e.motivoSaude && <span className="item-detalhe">{e.motivoSaude}</span>}
      </div>
      <div className="item-acoes">
        {e.plano !== "sob_medida" && (
          <Escolha
            rotulo="Plano"
            nome={`plano-${e.id}`}
            valor={e.plano}
            aoMudar={(p) => void trocarPlano(p)}
            opcoes={(["essencial", "comercial", "completo"] as const).map((p) => ({ valor: p, texto: PLANOS[p].nome }))}
          />
        )}
        {e.status === "teste" && (
          <button type="button" className="botao botao-secundario" onClick={() => setAcao(acao === "teste" ? "" : "teste")}>
            Estender teste
          </button>
        )}
        {e.status === "suspensa" ? (
          <button type="button" className="botao botao-secundario" onClick={() => void fazer(() => post(`/plataforma/empresas/${e.id}/reativar`), "Empresa reativada.")}>
            Reativar
          </button>
        ) : (
          <button type="button" className="botao botao-secundario" onClick={() => setAcao(acao === "suspender" ? "" : "suspender")}>
            Suspender
          </button>
        )}
      </div>
      {acao === "teste" && (
        <form className="form-linha" onSubmit={(ev) => (ev.preventDefault(), void fazer(() => post(`/plataforma/empresas/${e.id}/estender-teste`, { dias: Number(dias) }), "Teste estendido."))}>
          <Campo rotulo="Mais quantos dias" nome={`dias-${e.id}`} tipo="number" valor={dias} aoMudar={setDias} obrigatorio />
          <button type="submit" className="botao">
            Estender
          </button>
        </form>
      )}
      {acao === "suspender" && (
        <form className="form-linha" onSubmit={(ev) => (ev.preventDefault(), void fazer(() => post(`/plataforma/empresas/${e.id}/suspender`, { motivo }), "Empresa suspensa (só consulta)."))}>
          <Campo rotulo="Motivo da suspensão" nome={`motivo-${e.id}`} valor={motivo} aoMudar={setMotivo} obrigatorio />
          <button type="submit" className="botao botao-perigo">
            Suspender
          </button>
        </form>
      )}
    </li>
  );
}

export function PainelPlataforma() {
  const [busca, setBusca] = useState("");
  const lista = usePaginado<EmpresaPlataformaDto>(`/plataforma/empresas${query({ busca: busca || undefined, limite: 30 })}`);
  return (
    <>
      <Titulo>Plataforma</Titulo>
      <section className="cartao">
        <p className="dica">Todas as empresas. Saúde: risco = só consulta ou parada há 30 dias; atenção = atraso, parada há 7 dias ou perto do limite.</p>
        <Campo rotulo="Buscar empresa" nome="plataforma-busca" valor={busca} aoMudar={setBusca} />
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma empresa encontrada.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((e) => (
            <LinhaEmpresa key={e.id} e={e} aoMudar={() => void lista.recarregar()} />
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
