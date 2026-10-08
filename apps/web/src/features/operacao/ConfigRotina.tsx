// Check-list da rotina diária: itens para todos ou para um perfil.
import { useCallback, useEffect, useState } from "react";
import type { ChecklistItemDto } from "@mg/shared";
import { ErroApi, get, patch, post } from "../../app/api";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Escolha, ListaVazia, Mensagem, Titulo, useEnvio } from "../../ui/ui";

export function ConfigRotina() {
  const avisar = useAviso();
  const [itens, setItens] = useState<ChecklistItemDto[]>([]);
  const [perfis, setPerfis] = useState<{ id: string; nome: string }[]>([]);
  const [texto, setTexto] = useState("");
  const [perfilId, setPerfilId] = useState("");
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<{ itens: ChecklistItemDto[] }>("/checklist").then(
      (r) => setItens(r.itens),
      (e) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar o check-list."),
    );
  }, []);
  useEffect(carregar, [carregar]);
  useEffect(() => {
    get<{ perfis: { id: string; nome: string }[] }>("/usuarios/opcoes").then((o) => setPerfis(o.perfis), () => undefined);
  }, []);
  useTempoReal(["checklist.item_"], carregar);

  const envio = useEnvio(async () => {
    await post("/checklist", { texto, perfilId: perfilId || null, ordem: (itens.at(-1)?.ordem ?? 0) + 10 });
    setTexto("");
    avisar("Item adicionado.");
    carregar();
  });
  const arquivar = async (i: ChecklistItemDto) => {
    try {
      await patch(`/checklist/${i.id}`, { arquivar: true });
      avisar("Item removido do check-list (fica arquivado).");
      carregar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível remover.", "erro");
    }
  };

  return (
    <>
      <Titulo>Configurar rotina</Titulo>
      <form className="cartao" onSubmit={envio.enviar} aria-label="Novo item do check-list">
        <h2>Check-list diário</h2>
        <p className="dica">Cada pessoa vê, no Início, os itens para todos e os do próprio perfil, e marca o que fez no dia.</p>
        <div className="grade-campos">
          <Campo rotulo="Item" nome="checklist-texto" valor={texto} aoMudar={setTexto} obrigatorio />
          <Escolha rotulo="Para" nome="checklist-perfil" valor={perfilId} aoMudar={setPerfilId} vazio="Todos os perfis" opcoes={perfis.map((p) => ({ valor: p.id, texto: p.nome }))} />
        </div>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <button type="submit" className="botao" disabled={envio.enviando}>
          Adicionar
        </button>
      </form>
      <section className="cartao">
        <Mensagem tipo="erro">{erro}</Mensagem>
        {!itens.length && <ListaVazia>Nenhum item ainda.</ListaVazia>}
        <ul className="lista">
          {itens.map((i) => (
            <li key={i.id} className="item">
              <div className="item-principal">
                <strong>{i.texto}</strong>
                <span className="item-detalhe">{i.perfilNome ?? "Todos os perfis"}</span>
              </div>
              <div className="item-acoes">
                <button type="button" className="botao botao-secundario" onClick={() => void arquivar(i)}>
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
