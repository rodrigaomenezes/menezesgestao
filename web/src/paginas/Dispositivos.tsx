import { useState } from "react";
import { del } from "../api";
import { CarregarMais, ListaVazia, Mensagem, Titulo, formatarDataHora, usePaginado } from "../componentes/ui";

interface Sessao {
  id: string;
  dispositivo: string | null;
  ip: string | null;
  criadoEm: string;
  ultimoUso: string;
  atual: boolean;
}

/** Resumo legível do navegador a partir do user-agent. */
function descrever(ua: string | null): string {
  if (!ua) return "Dispositivo desconhecido";
  const sistema = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const navegador = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  return sistema ? `${navegador} no ${sistema}` : navegador;
}

export function Dispositivos() {
  const lista = usePaginado<Sessao>("/auth/sessoes");
  const [erro, setErro] = useState("");

  async function encerrar(s: Sessao) {
    if (!confirm("Encerrar o acesso neste dispositivo? Será preciso entrar de novo nele.")) return;
    setErro("");
    try {
      await del(`/auth/sessoes/${s.id}`);
      void lista.recarregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <Titulo>Meus dispositivos</Titulo>
      <section className="cartao">
        <p className="dica">Aparelhos e navegadores onde sua conta está aberta. Se não reconhecer algum, encerre e troque a senha.</p>
        <Mensagem tipo="erro">{lista.erro || erro}</Mensagem>
        {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhum dispositivo conectado.</ListaVazia>}
        <ul className="lista">
          {lista.itens.map((s) => (
            <li key={s.id} className="item">
              <div className="item-principal">
                <strong>{descrever(s.dispositivo)}</strong>
                {s.atual && <span className="selo">Este dispositivo</span>}
                <span className="item-detalhe">
                  Entrou em {formatarDataHora(s.criadoEm)} · último uso {formatarDataHora(s.ultimoUso)}
                </span>
              </div>
              {!s.atual && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => void encerrar(s)}>
                    Encerrar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      </section>
    </>
  );
}
