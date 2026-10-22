// Páginas abertas (com ou sem login): documentos legais, status do serviço e confirmação da redefinição das duas etapas.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DOCUMENTOS_LEGAIS, type DocumentoLegalDto, type DocumentoLegalId, type StatusPublicoDto } from "@mg/shared";
import { ErroApi, get, post } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { Mensagem } from "../../ui/ui";
import { Markdown } from "./Markdown";

function PaginaAberta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const { eu } = useSessao();
  return (
    <main className="pagina-aberta" id="conteudo">
      <p>
        <Link to="/">{eu ? "← Voltar ao sistema" : "← Entrar"}</Link>
      </p>
      <h1 className="sr-only">{titulo}</h1>
      {children}
    </main>
  );
}

export function Documento({ id }: { id: DocumentoLegalId }) {
  const [doc, setDoc] = useState<DocumentoLegalDto | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    get<DocumentoLegalDto>(`/publico/documentos/${id}`).then(setDoc, () => setErro("Não foi possível carregar o documento. Tente de novo em instantes."));
  }, [id]);
  const titulo = DOCUMENTOS_LEGAIS.find((d) => d.id === id)!.titulo;
  return (
    <PaginaAberta titulo={titulo}>
      <Mensagem tipo="erro">{erro}</Mensagem>
      {doc ? <Markdown texto={doc.texto} /> : !erro && <p className="carregando">Carregando…</p>}
      <nav aria-label="Outros documentos" className="form-linha">
        {DOCUMENTOS_LEGAIS.filter((d) => d.id !== id).map((d) => (
          <Link key={d.id} to={d.rota}>
            {d.titulo}
          </Link>
        ))}
      </nav>
    </PaginaAberta>
  );
}

export function StatusServico() {
  const [s, setS] = useState<StatusPublicoDto | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    get<StatusPublicoDto>("/publico/status").then(setS, () => setErro(true));
  }, []);
  return (
    <PaginaAberta titulo="Situação do serviço">
      <section className="cartao" aria-labelledby="titulo-status">
        <h2 id="titulo-status">Situação do serviço</h2>
        {erro ? (
          <Mensagem tipo="erro">O servidor não respondeu. Se o problema continuar, fale com o suporte.</Mensagem>
        ) : !s ? (
          <p className="carregando">Verificando…</p>
        ) : (
          <>
            <Mensagem tipo={s.situacao === "operando" ? "sucesso" : "erro"}>
              {s.situacao === "operando" ? "Tudo funcionando normalmente." : "Parte do serviço está instável. Já estamos olhando."}
            </Mensagem>
            <ul className="lista">
              {s.componentes.map((c) => (
                <li key={c.nome} className="item">
                  <span>{c.nome}</span>
                  <span className={`selo ${c.ok ? "selo-ganha" : "selo-perdida"}`}>{c.ok ? "Operando" : "Instável"}</span>
                </li>
              ))}
            </ul>
            <p className="dica">Verificado em {new Date(s.verificadoEm).toLocaleString("pt-BR")}.</p>
          </>
        )}
      </section>
    </PaginaAberta>
  );
}

export function ConfirmarDuasEtapas() {
  const [params] = useSearchParams();
  const [estado, setEstado] = useState<"pronto" | "enviando" | "feito">("pronto");
  const [erro, setErro] = useState("");
  const confirmar = async () => {
    setEstado("enviando");
    try {
      await post("/auth/duas-etapas/confirmar-redefinicao", { token: params.get("token") ?? "" });
      setEstado("feito");
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível confirmar. Tente de novo.");
      setEstado("pronto");
    }
  };
  return (
    <PaginaAberta titulo="Redefinir o login em duas etapas">
      <section className="cartao">
        <h2>Redefinir o login em duas etapas</h2>
        {estado === "feito" ? (
          <Mensagem tipo="sucesso">Pronto. Entre com a sua senha e configure as duas etapas de novo em “Segurança da conta”.</Mensagem>
        ) : (
          <>
            <p>O administrador da sua empresa pediu para redefinir o seu login em duas etapas. Confirme só se foi você quem pediu ajuda.</p>
            <p className="dica">Ao confirmar, as duas etapas são desligadas e você sai de todos os aparelhos.</p>
            <Mensagem tipo="erro">{erro}</Mensagem>
            <button type="button" className="botao" disabled={estado === "enviando"} onClick={() => void confirmar()}>
              Confirmar redefinição
            </button>
          </>
        )}
      </section>
    </PaginaAberta>
  );
}
