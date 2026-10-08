// Estrutura das telas internas: topo com menu e sino, navegação conforme as permissões.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import type { Acao, Modulo } from "@mg/shared";
import { get } from "./api";
import { useEu, useSessao } from "./sessao";
import { conectarTempoReal, useTempoReal } from "./tempo-real";

interface ItemMenu {
  para: string;
  texto: string;
  exige?: [Modulo, Acao];
}

const MENU: ItemMenu[] = [
  { para: "/", texto: "Início" },
  { para: "/usuarios", texto: "Usuários", exige: ["usuarios", "ver"] },
  { para: "/equipes", texto: "Equipes", exige: ["usuarios", "ver"] },
  { para: "/perfis", texto: "Perfis e permissões", exige: ["usuarios", "ver"] },
  { para: "/unidades", texto: "Unidades", exige: ["configuracoes", "ver"] },
  { para: "/empresa", texto: "Empresa e marca", exige: ["configuracoes", "ver"] },
  { para: "/auditoria", texto: "Auditoria", exige: ["auditoria", "ver"] },
  { para: "/notificacoes", texto: "Notificações" },
  { para: "/dispositivos", texto: "Meus dispositivos" },
];

function Sino() {
  const [naoLidas, setNaoLidas] = useState(0);
  const atualizar = useCallback(() => {
    get<{ naoLidas: number }>("/notificacoes?limite=1")
      .then((r) => setNaoLidas(r.naoLidas))
      .catch(() => undefined);
  }, []);
  useEffect(atualizar, [atualizar]);
  useTempoReal(["notificacao."], atualizar);
  return (
    <Link to="/notificacoes" className="sino" aria-label={`Notificações: ${naoLidas} não lida(s)`}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      {naoLidas > 0 && <span className="sino-contador">{naoLidas > 99 ? "99+" : naoLidas}</span>}
    </Link>
  );
}

/** Aviso quando o aparelho perde a conexão (a tela continua aberta, mas nada é salvo). */
function useConectado(): boolean {
  const [conectado, setConectado] = useState(navigator.onLine);
  useEffect(() => {
    const ligar = () => setConectado(true);
    const desligar = () => setConectado(false);
    window.addEventListener("online", ligar);
    window.addEventListener("offline", desligar);
    return () => {
      window.removeEventListener("online", ligar);
      window.removeEventListener("offline", desligar);
    };
  }, []);
  return conectado;
}

export function Casca({ children }: { children: ReactNode }) {
  const conectado = useConectado();
  const eu = useEu();
  const { pode, sair, trocarEmpresa } = useSessao();
  const [menuAberto, setMenuAberto] = useState(false);
  const local = useLocation();

  useEffect(() => setMenuAberto(false), [local.pathname]);
  useEffect(() => (eu.empresa ? conectarTempoReal() : undefined), [eu.empresa]);

  const itens = MENU.filter((i) => !i.exige || pode(...i.exige));

  return (
    <div className="casca">
      <header className="topo">
        <button
          type="button"
          className="botao-menu"
          aria-expanded={menuAberto}
          aria-controls="menu-principal"
          onClick={() => setMenuAberto((v) => !v)}
        >
          <span className="sr-only">Abrir menu</span>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path fill="currentColor" d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z" />
          </svg>
        </button>
        <Link to="/" className="marca">
          {eu.marca.nomeProduto}
        </Link>
        <Sino />
      </header>

      <nav id="menu-principal" className={`menu ${menuAberto ? "aberto" : ""}`} aria-label="Menu principal">
        <div className="menu-pessoa">
          <strong>{eu.usuario.nome}</strong>
          <span>{eu.perfil?.nome}</span>
        </div>
        {eu.empresas.length > 1 && (
          <div className="campo">
            <label htmlFor="trocar-empresa">Empresa</label>
            <select id="trocar-empresa" value={eu.empresa?.id ?? ""} onChange={(e) => void trocarEmpresa(e.target.value)}>
              {eu.empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
        )}
        <ul>
          {itens.map((i) => (
            <li key={i.para}>
              <NavLink to={i.para} end={i.para === "/"}>
                {i.texto}
              </NavLink>
            </li>
          ))}
        </ul>
        <button type="button" className="botao botao-secundario botao-largo" onClick={() => void sair()}>
          Sair
        </button>
      </nav>
      {menuAberto && <div className="menu-fundo" onClick={() => setMenuAberto(false)} aria-hidden="true" />}

      <main className="conteudo">
        {!conectado && (
          <p className="mensagem mensagem-erro" role="alert">
            Sem conexão com a internet. O que você fizer agora não será salvo até a conexão voltar.
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
