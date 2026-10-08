import { Link } from "react-router-dom";
import { MODULOS } from "../../../src/compartilhado/catalogo";
import { useEu } from "../sessao";

export function Inicio() {
  const eu = useEu();
  const primeiroNome = eu.usuario.nome.split(" ")[0];
  const ativos = MODULOS.filter((m) => !m.nucleo && eu.empresa?.modulos.includes(m.id));

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

      <section className="cartao">
        <h2>Módulos da empresa</h2>
        {ativos.length ? (
          <ul className="lista-simples">
            {ativos.map((m) => (
              <li key={m.id}>
                {m.nome} <span className="selo">em construção</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nenhum módulo além do núcleo está ativo no plano.</p>
        )}
      </section>

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
