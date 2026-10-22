// Portão de aceite: versão nova dos termos (ou contrato de dados, para quem administra) precisa ser aceita antes de usar.
import { useState } from "react";
import { Link } from "react-router-dom";
import { DOCUMENTOS_LEGAIS } from "@mg/shared";
import { post } from "../../app/api";
import { useEu, useSessao } from "../../app/sessao";
import { Mensagem, useEnvio } from "../../ui/ui";

export function AceitarTermos() {
  const eu = useEu();
  const { recarregar, sair } = useSessao();
  const [marcado, setMarcado] = useState(false);
  const docs = DOCUMENTOS_LEGAIS.filter((d) => eu.termosPendentes.includes(d.id));
  const envio = useEnvio(async () => {
    await post("/termos/aceitar", { documentos: docs.map((d) => d.id) });
    await recarregar();
  });
  return (
    <main className="tela-acesso" id="conteudo">
      <form className="cartao" onSubmit={envio.enviar} aria-label="Aceitar os termos">
        <h1>Antes de continuar</h1>
        <p>{eu.termosPendentes.includes("contrato") ? "Como administrador da empresa, leia e aceite:" : "Os documentos abaixo mudaram (ou são novos para você). Leia e aceite para continuar:"}</p>
        <ul>
          {docs.map((d) => (
            <li key={d.id}>
              <Link to={d.rota} target="_blank" rel="noreferrer">
                {d.titulo}
              </Link>
            </li>
          ))}
        </ul>
        <label className="marcar">
          <input type="checkbox" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} required /> Li e aceito {docs.length > 1 ? "os documentos acima" : "o documento acima"}.
        </label>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <button type="submit" className="botao" disabled={!marcado || envio.enviando}>
          Aceitar e continuar
        </button>
        <button type="button" className="botao botao-secundario" onClick={() => void sair()}>
          Sair
        </button>
      </form>
    </main>
  );
}
