// Estrutura das telas internas: topo com menu e sino, navegação conforme as permissões.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import type { Acao, Modulo } from "@mg/shared";
import { get } from "./api";
import { useEu, useSessao } from "./sessao";
import { conectarTempoReal, useTempoReal } from "./tempo-real";
import { useVocabulario } from "./vocabulario";
import { ProvedorTelefoneSistema } from "../features/telefonia/Telefone";
import { Logo } from "../features/whitelabel/Logo";
import { Icone, type NomeIcone } from "../ui/Icone";
import { ConexaoContexto } from "../ui/ui";
import { AvisoAssinatura } from "../features/plataforma/AvisoAssinatura";

interface ItemMenu {
  para: string;
  /** Texto com marcadores do vocabulário da empresa (ex.: "{Contatos}" vira "Alunos"). */
  texto: string;
  icone: NomeIcone;
  exige?: [Modulo, Acao];
  /** Só para a equipe da plataforma (PLATAFORMA_ADMINS). */
  plataforma?: boolean;
}

/** Menu em grupos: o dia a dia primeiro, depois resultados, configuração e a conta da pessoa. */
const MENU: { grupo: string; itens: ItemMenu[] }[] = [
  {
    grupo: "Dia a dia",
    itens: [
      { para: "/", texto: "Início", icone: "inicio" },
      { para: "/conversas", texto: "Conversas", icone: "conversas", exige: ["conversas", "ver"] },
      { para: "/contatos", texto: "{Contatos}", icone: "contatos", exige: ["crm", "ver"] },
      { para: "/funil", texto: "Funil", icone: "funil", exige: ["crm", "ver"] },
      { para: "/filas", texto: "Fila de ligações", icone: "fila", exige: ["fila", "ver"] },
      { para: "/ligacoes", texto: "Ligações", icone: "ligacoes", exige: ["telefonia", "ver"] },
      { para: "/tarefas", texto: "Tarefas", icone: "tarefas", exige: ["crm", "ver"] },
      { para: "/agenda", texto: "Agenda", icone: "agenda", exige: ["agenda", "ver"] },
      { para: "/horas", texto: "Horas", icone: "horas", exige: ["agenda", "ver"] },
      { para: "/scripts", texto: "Scripts", icone: "scripts", exige: ["scripts", "ver"] },
    ],
  },
  {
    grupo: "Resultados",
    itens: [
      { para: "/desempenho", texto: "Desempenho e metas", icone: "desempenho", exige: ["desempenho", "ver"] },
      { para: "/mapa", texto: "Mapa de atividades", icone: "mapa", exige: ["mapa", "ver"] },
      { para: "/vendas", texto: "Vendas", icone: "vendas", exige: ["vendas", "ver"] },
      { para: "/comissoes", texto: "Comissões", icone: "comissoes", exige: ["vendas", "ver"] },
      { para: "/catalogo", texto: "Catálogo", icone: "catalogo", exige: ["servicos", "ver"] },
      { para: "/qualidade", texto: "Qualidade", icone: "qualidade", exige: ["qualidade", "ver"] },
      { para: "/bre", texto: "Motor BRE", icone: "desempenho", exige: ["bre", "ver"] },
      { para: "/pesquisas", texto: "Pesquisas", icone: "pesquisas", exige: ["pesquisa", "ver"] },
    ],
  },
  {
    grupo: "Configurações",
    itens: [
      { para: "/importar", texto: "Importar planilha", icone: "importar", exige: ["crm", "criar"] },
      { para: "/crm/configuracoes", texto: "Configurar CRM", icone: "configuracoes", exige: ["crm", "administrar"] },
      { para: "/conversas/canais", texto: "Canais e automações", icone: "conversas", exige: ["conversas", "administrar"] },
      { para: "/telefonia/configuracoes", texto: "Configurar telefonia", icone: "ligacoes", exige: ["telefonia", "administrar"] },
      { para: "/rotina/configuracoes", texto: "Configurar rotina", icone: "tarefas", exige: ["rotina", "administrar"] },
      { para: "/automacoes", texto: "Automações", icone: "configuracoes", exige: ["configuracoes", "ver"] },
      { para: "/usuarios", texto: "Usuários", icone: "pessoas", exige: ["usuarios", "ver"] },
      { para: "/equipes", texto: "Equipes", icone: "pessoas", exige: ["usuarios", "ver"] },
      { para: "/perfis", texto: "Perfis e permissões", icone: "seguranca", exige: ["usuarios", "ver"] },
      { para: "/unidades", texto: "{Unidades}", icone: "empresa", exige: ["configuracoes", "ver"] },
      { para: "/empresa", texto: "Empresa e marca", icone: "empresa", exige: ["configuracoes", "ver"] },
      { para: "/segmento-e-termos", texto: "Segmento e termos", icone: "catalogo", exige: ["configuracoes", "ver"] },
      { para: "/plano", texto: "Plano e cobrança", icone: "vendas", exige: ["configuracoes", "ver"] },
      { para: "/auditoria", texto: "Auditoria", icone: "seguranca", exige: ["auditoria", "ver"] },
    ],
  },
  {
    grupo: "Sua conta",
    itens: [
      { para: "/notificacoes", texto: "Notificações", icone: "avisos" },
      { para: "/seguranca", texto: "Segurança da conta", icone: "seguranca" },
      { para: "/dispositivos", texto: "Meus dispositivos", icone: "ligacoes" },
      { para: "/ajuda", texto: "Ajuda", icone: "ajuda" },
      { para: "/plataforma", texto: "Plataforma", icone: "empresa", plataforma: true },
    ],
  },
];

/** Barra de baixo no celular: os quatro lugares mais usados e "Mais", que abre o menu completo. */
const BARRA: ItemMenu[] = [
  { para: "/", texto: "Início", icone: "inicio" },
  { para: "/conversas", texto: "Conversas", icone: "conversas", exige: ["conversas", "ver"] },
  { para: "/funil", texto: "Funil", icone: "funil", exige: ["crm", "ver"] },
  { para: "/agenda", texto: "Agenda", icone: "agenda", exige: ["agenda", "ver"] },
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
  const termos = useVocabulario();
  const { pode, sair, trocarEmpresa } = useSessao();
  const [menuAberto, setMenuAberto] = useState(false);
  const local = useLocation();

  useEffect(() => setMenuAberto(false), [local.pathname]);
  useEffect(() => (eu.empresa ? conectarTempoReal() : undefined), [eu.empresa]);

  // Duas etapas pendentes: só a segurança da conta até configurar.
  const visivel = (i: ItemMenu) =>
    eu.duasEtapas.pendente ? i.para === "/seguranca" : i.plataforma ? eu.plataformaAdmin : !i.exige || pode(...i.exige);
  const grupos = MENU.map((g) => ({ ...g, itens: g.itens.filter(visivel) })).filter((g) => g.itens.length);
  const barra = BARRA.filter(visivel);

  return (
    <ProvedorTelefoneSistema>
      <div className="casca">
        <a href="#conteudo" className="pular-conteudo">
          Pular para o conteúdo
        </a>
        <header className="topo">
          <Link to="/" className="marca">
            {eu.marca.logoClaro || eu.marca.logoEscuro ? (
              <Logo claro={eu.marca.logoClaro} escuro={eu.marca.logoEscuro} nome={eu.marca.nomeProduto} classe="logo-topo" />
            ) : (
              eu.marca.nomeProduto
            )}
          </Link>
          <div className="topo-acoes">
            <Link to={`/ajuda?tela=${encodeURIComponent(local.pathname)}`} className="sino" aria-label="Ajuda desta tela" title="Ajuda">
              <Icone nome="ajuda" tamanho={22} />
            </Link>
            <Sino />
          </div>
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
          {grupos.map((g) => (
            <div key={g.grupo} className="menu-grupo">
              <h2 className="menu-grupo-titulo">{g.grupo}</h2>
              <ul>
                {g.itens.map((i) => (
                  <li key={i.para}>
                    <NavLink to={i.para} end={i.para === "/"} onClick={() => setMenuAberto(false)}>
                      <Icone nome={i.icone} />
                      <span>{termos.t(i.texto)}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button type="button" className="botao botao-secundario botao-largo" onClick={() => void sair()}>
            Sair
          </button>
        </nav>
        {menuAberto && <div className="menu-fundo" onClick={() => setMenuAberto(false)} aria-hidden="true" />}

        <nav className="barra-inferior" aria-label="Atalhos do celular">
          {barra.map((i) => (
            <NavLink key={i.para} to={i.para} end={i.para === "/"}>
              <Icone nome={i.icone} tamanho={22} />
              <span>{termos.t(i.texto)}</span>
            </NavLink>
          ))}
          <button type="button" aria-expanded={menuAberto} aria-controls="menu-principal" aria-label="Mais: abrir menu" onClick={() => setMenuAberto((v) => !v)}>
            <Icone nome="mais" tamanho={22} />
            <span aria-hidden="true">Mais</span>
          </button>
        </nav>

        <main className="conteudo" id="conteudo" tabIndex={-1}>
          {!conectado && (
            <p className="mensagem mensagem-erro" role="alert">
              Sem conexão com a internet. Você vê os dados mais recentes; o que fizer agora não será salvo até a conexão voltar.
            </p>
          )}
          <AvisoAssinatura />
          <ConexaoContexto.Provider value={conectado}>{children}</ConexaoContexto.Provider>
        </main>
      </div>
    </ProvedorTelefoneSistema>
  );
}
