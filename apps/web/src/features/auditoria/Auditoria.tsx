import { useState } from "react";
import { query } from "../../app/api";
import { Campo, CarregarMais, Escolha, ListaVazia, Mensagem, Titulo, usePaginado } from "../../ui/ui";
import { useDataHora } from "../../app/sessao";

interface Registro {
  id: string;
  acao: string;
  entidade: string;
  atorNome: string | null;
  antes: unknown;
  depois: unknown;
  ip: string | null;
  dispositivo: string | null;
  criadoEm: string;
}

const ACOES: Record<string, string> = {
  login: "Entrou no sistema",
  "login.falhou": "Errou a senha",
  logout: "Saiu do sistema",
  "sessao.trocou_empresa": "Trocou de empresa",
  "sessao.encerrada": "Encerrou um dispositivo",
  "senha.recuperacao_pedida": "Pediu nova senha",
  "senha.redefinida": "Criou nova senha",
  "empresa.criada": "Criou a empresa",
  "empresa.atualizada": "Alterou dados da empresa",
  "usuario.convidado": "Convidou uma pessoa",
  "usuario.entrou": "Aceitou o convite",
  "usuario.atualizado": "Alterou perfil ou lotação de uma pessoa",
  "usuario.arquivado": "Arquivou uma pessoa",
  "usuario.restaurado": "Restaurou uma pessoa",
  "unidade.criada": "Criou uma unidade",
  "unidade.atualizada": "Alterou uma unidade",
  "unidade.arquivada": "Arquivou uma unidade",
  "unidade.restaurada": "Restaurou uma unidade",
  "equipe.criada": "Criou uma equipe",
  "equipe.atualizada": "Alterou uma equipe",
  "equipe.arquivada": "Arquivou uma equipe",
  "equipe.restaurada": "Restaurou uma equipe",
  "perfil.criado": "Criou um perfil",
  "perfil.atualizado": "Alterou permissões de um perfil",
  "perfil.arquivado": "Arquivou um perfil",
  "perfil.restaurado": "Restaurou um perfil",
};

const ENTIDADES = [
  { valor: "usuario", texto: "Pessoas e acessos" },
  { valor: "perfil", texto: "Perfis" },
  { valor: "equipe", texto: "Equipes" },
  { valor: "unidade", texto: "Unidades" },
  { valor: "empresa", texto: "Empresa" },
  { valor: "sessao", texto: "Dispositivos" },
];

export function Auditoria() {
  const formatarDataHora = useDataHora();
  const [entidade, setEntidade] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  // "até" inclui o dia inteiro escolhido.
  const ateExclusivo = ate ? new Date(new Date(`${ate}T00:00:00`).getTime() + 86_400_000).toISOString() : "";
  const lista = usePaginado<Registro>(
    `/auditoria${query({ entidade, de: de ? new Date(`${de}T00:00:00`).toISOString() : "", ate: ateExclusivo })}`,
  );

  return (
    <>
      <Titulo>Auditoria</Titulo>
      <section className="cartao">
        <div className="grade-campos">
          <Escolha rotulo="Assunto" nome="auditoria-entidade" valor={entidade} aoMudar={setEntidade} opcoes={ENTIDADES} vazio="Todos" />
          <Campo rotulo="De" nome="auditoria-de" tipo="date" valor={de} aoMudar={setDe} />
          <Campo rotulo="Até" nome="auditoria-ate" tipo="date" valor={ate} aoMudar={setAte} />
        </div>
        <Mensagem tipo="erro">{lista.erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhum registro no período.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((r) => (
            <li key={r.id} className="item">
              <div className="item-principal">
                <strong>{ACOES[r.acao] ?? r.acao}</strong>
                <span className="item-detalhe">
                  {formatarDataHora(r.criadoEm)} · {r.atorNome ?? "Sistema"}
                </span>
                {(r.antes != null || r.depois != null) && (
                  <details>
                    <summary>Ver o que mudou</summary>
                    {r.antes != null && (
                      <>
                        <small>Antes</small>
                        <pre>{JSON.stringify(r.antes, null, 2)}</pre>
                      </>
                    )}
                    {r.depois != null && (
                      <>
                        <small>Depois</small>
                        <pre>{JSON.stringify(r.depois, null, 2)}</pre>
                      </>
                    )}
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
