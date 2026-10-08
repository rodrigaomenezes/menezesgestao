// Peças de interface reaproveitadas pelas telas.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ErroApi, get, type Pagina } from "../api";

export function Mensagem({ tipo, children }: { tipo: "erro" | "sucesso" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p className={`mensagem mensagem-${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Campo(props: {
  rotulo: string;
  nome: string;
  tipo?: string;
  valor: string;
  aoMudar(valor: string): void;
  obrigatorio?: boolean;
  dica?: string;
  autoComplete?: string;
  minimo?: number;
}) {
  const id = `campo-${props.nome}`;
  return (
    <div className="campo">
      <label htmlFor={id}>{props.rotulo}</label>
      <input
        id={id}
        name={props.nome}
        type={props.tipo ?? "text"}
        value={props.valor}
        required={props.obrigatorio}
        minLength={props.minimo}
        autoComplete={props.autoComplete}
        aria-describedby={props.dica ? `${id}-dica` : undefined}
        onChange={(e) => props.aoMudar(e.target.value)}
      />
      {props.dica && (
        <small id={`${id}-dica`} className="dica">
          {props.dica}
        </small>
      )}
    </div>
  );
}

export function Escolha(props: {
  rotulo: string;
  nome: string;
  valor: string;
  aoMudar(valor: string): void;
  opcoes: { valor: string; texto: string }[];
  vazio?: string;
  obrigatorio?: boolean;
}) {
  const id = `escolha-${props.nome}`;
  return (
    <div className="campo">
      <label htmlFor={id}>{props.rotulo}</label>
      <select id={id} name={props.nome} value={props.valor} required={props.obrigatorio} onChange={(e) => props.aoMudar(e.target.value)}>
        {props.vazio !== undefined && <option value="">{props.vazio}</option>}
        {props.opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Formulário com estado de envio e mensagem de erro do servidor. */
export function useEnvio<T>(acao: () => Promise<T>) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const enviar = async (e?: FormEvent) => {
    e?.preventDefault();
    setEnviando(true);
    setErro("");
    try {
      return await acao();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Algo deu errado. Tente de novo.");
      return undefined;
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, erro, setErro, enviar };
}

/** Lista paginada por cursor, com "Carregar mais". */
export function usePaginado<T>(caminho: string) {
  const [itens, setItens] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const buscar = useCallback(
    async (depoisDe: string | null) => {
      setCarregando(true);
      setErro("");
      try {
        const separador = caminho.includes("?") ? "&" : "?";
        const url = depoisDe ? `${caminho}${separador}cursor=${encodeURIComponent(depoisDe)}` : caminho;
        const pagina = await get<Pagina<T>>(url);
        setItens((atuais) => (depoisDe ? [...atuais, ...pagina.itens] : pagina.itens));
        setCursor(pagina.proximoCursor);
      } catch (err) {
        setErro(err instanceof ErroApi ? err.message : "Não foi possível carregar a lista.");
      } finally {
        setCarregando(false);
      }
    },
    [caminho],
  );

  useEffect(() => {
    void buscar(null);
  }, [buscar]);

  return {
    itens,
    carregando,
    erro,
    temMais: Boolean(cursor),
    carregarMais: () => buscar(cursor),
    recarregar: () => buscar(null),
  };
}

export function ListaVazia({ children }: { children: ReactNode }) {
  return <p className="lista-vazia">{children}</p>;
}

export function CarregarMais({ visivel, carregando, aoClicar }: { visivel: boolean; carregando: boolean; aoClicar(): void }) {
  if (!visivel) return null;
  return (
    <button type="button" className="botao botao-secundario botao-largo" disabled={carregando} onClick={aoClicar}>
      {carregando ? "Carregando…" : "Carregar mais"}
    </button>
  );
}

export function Titulo({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="titulo-pagina">
      <h1>{children}</h1>
      {acao}
    </div>
  );
}

/** Abre e fecha um formulário de criação (no celular, a lista vem primeiro). */
export function BotaoAlternar({ aberto, aoMudar, texto }: { aberto: boolean; aoMudar(v: boolean): void; texto: string }) {
  return (
    <button type="button" className={`botao ${aberto ? "botao-secundario" : ""}`} aria-expanded={aberto} onClick={() => aoMudar(!aberto)}>
      {aberto ? "Cancelar" : texto}
    </button>
  );
}

/** Alterna entre ativos e arquivados (lixeira). */
export function FiltroArquivados({ valor, aoMudar }: { valor: boolean; aoMudar(v: boolean): void }) {
  return (
    <div className="abas" role="tablist" aria-label="Mostrar">
      <button type="button" role="tab" aria-selected={!valor} className={!valor ? "ativa" : ""} onClick={() => aoMudar(false)}>
        Ativos
      </button>
      <button type="button" role="tab" aria-selected={valor} className={valor ? "ativa" : ""} onClick={() => aoMudar(true)}>
        Arquivados
      </button>
    </div>
  );
}

export function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
