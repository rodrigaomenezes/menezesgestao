// Minhas tarefas (e as da equipe, conforme o escopo): abertas por vencimento ou concluídas.
import { useState } from "react";
import type { TarefaDto } from "@mg/shared";
import { query } from "../../app/api";
import { useTempoReal } from "../../app/tempo-real";
import { CarregarMais, Escolha, ListaVazia, Mensagem, Titulo, usePaginado } from "../../ui/ui";
import { LinhaTarefa } from "./Contato";
import { useConfigCrm } from "./comum";

export function Tarefas() {
  const { config } = useConfigCrm();
  const [situacao, setSituacao] = useState<"abertas" | "concluidas">("abertas");
  const [responsavelId, setResponsavelId] = useState("");
  const lista = usePaginado<TarefaDto>(`/tarefas${query({ situacao, responsavelId })}`);
  useTempoReal(["tarefa."], () => void lista.recarregar());

  return (
    <>
      <Titulo>Tarefas</Titulo>
      <section className="cartao">
        <div className="abas" role="tablist" aria-label="Situação">
          {(["abertas", "concluidas"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={situacao === s} className={situacao === s ? "ativa" : ""} onClick={() => setSituacao(s)}>
              {s === "abertas" ? "Abertas" : "Concluídas"}
            </button>
          ))}
        </div>
        {config.responsaveis.length > 1 && (
          <div className="filtros">
            <Escolha rotulo="Responsável" nome="tarefas-responsavel" valor={responsavelId} aoMudar={setResponsavelId} opcoes={config.responsaveis.map((r) => ({ valor: r.id, texto: r.nome }))} vazio="Todos que vejo" />
          </div>
        )}
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>{situacao === "abertas" ? "Nenhuma tarefa aberta. Bom trabalho!" : "Nenhuma tarefa concluída ainda."}</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((t) => (
            <LinhaTarefa key={t.id} t={t} mostrarContato aoMudar={() => void lista.recarregar()} />
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
