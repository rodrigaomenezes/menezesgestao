import { Link } from "react-router-dom";
import { MODULOS } from "@mg/shared";
import { useEu, useSessao } from "../../app/sessao";
import { Rotina } from "../operacao/Rotina";

// Módulos que chegam nas próximas fases do roteiro.
const EM_CONSTRUCAO = new Set(["qualidade", "vendas", "servicos", "pesquisa"]);

export function Inicio() {
  const eu = useEu();
  const { pode } = useSessao();
  const primeiroNome = eu.usuario.nome.split(" ")[0];
  const emBreve = MODULOS.filter((m) => EM_CONSTRUCAO.has(m.id) && eu.empresa?.modulos.includes(m.id));

  return (
    <>
      <div className="titulo-pagina">
        <h1>Olá, {primeiroNome}!</h1>
      </div>
      <section className="cartao">
        <p>
          Você está em <strong>{eu.empresa?.nome}</strong> com o perfil <strong>{eu.perfil?.nome}</strong>.
        </p>
        {eu.empresas.length > 1 && <p className="dica">Para trocar de empresa, use o menu.</p>}
      </section>
      {pode("rotina", "ver") && <Rotina />}

      {emBreve.length > 0 && (
        <section className="cartao">
          <h2>Chegando em breve</h2>
          <ul className="lista-simples">
            {emBreve.map((m) => (
              <li key={m.id}>
                {m.nome} <span className="selo">em construção</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cartao">
        <h2>Atalhos</h2>
        <ul className="lista-simples">
          <li>
            <Link to="/notificacoes">Ver notificações</Link>
          </li>
          <li>
            <Link to="/dispositivos">Ver os aparelhos conectados à sua conta</Link>
          </li>
        </ul>
      </section>
    </>
  );
}
