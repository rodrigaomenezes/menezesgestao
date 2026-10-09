// Página pública da pesquisa (/p/<token>): sem login, só as perguntas e o envio.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { PesquisaPublicaDto } from "@mg/shared";
import { ErroApi, get, post } from "../../app/api";
import { Mensagem, useEnvio } from "../../ui/ui";

export function PesquisaPublica() {
  const { token = "" } = useParams();
  const [p, setP] = useState<PesquisaPublicaDto | null>(null);
  const [erro, setErro] = useState("");
  const [respostas, setRespostas] = useState<Record<string, string | number>>({});
  const [enviada, setEnviada] = useState(false);
  useEffect(() => {
    get<PesquisaPublicaDto>(`/publico/pesquisas/${encodeURIComponent(token)}`).then(setP, (e) =>
      setErro(e instanceof ErroApi && e.status === 404 ? "Pesquisa não encontrada. Confira o link que você recebeu." : "Não foi possível abrir a pesquisa agora. Tente de novo em instantes."),
    );
  }, [token]);
  const envio = useEnvio(async () => {
    await post(`/publico/pesquisas/${encodeURIComponent(token)}/respostas`, { respostas });
    setEnviada(true);
  });

  return (
    <main className="tela-acesso pesquisa-publica">
      <div className="cartao">
        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
        {!p && !erro && <p className="carregando">Carregando…</p>}
        {p && (
          <>
            <p className="subtitulo">{p.empresa}</p>
            <h1>{p.titulo}</h1>
            {p.descricao && <p>{p.descricao}</p>}
            {enviada ? (
              <Mensagem tipo="sucesso">Obrigado! Sua resposta foi registrada.</Mensagem>
            ) : !p.aberta ? (
              <Mensagem tipo="info">Esta pesquisa foi encerrada e não recebe mais respostas. Obrigado pelo interesse!</Mensagem>
            ) : (
              <form onSubmit={envio.enviar}>
                {p.perguntas.map((q) => (
                  <fieldset key={q.id} className="pergunta">
                    <legend>
                      {q.texto} {q.obrigatoria && <span aria-label="obrigatória">*</span>}
                    </legend>
                    {q.tipo === "texto" && (
                      <textarea aria-label={q.texto} rows={3} maxLength={2000} required={q.obrigatoria} value={String(respostas[q.id] ?? "")} onChange={(e) => setRespostas({ ...respostas, [q.id]: e.target.value })} />
                    )}
                    {q.tipo === "escolha" &&
                      q.opcoes?.map((o) => (
                        <label key={o} className="marcar">
                          <input type="radio" name={q.id} value={o} required={q.obrigatoria} checked={respostas[q.id] === o} onChange={() => setRespostas({ ...respostas, [q.id]: o })} />
                          {o}
                        </label>
                      ))}
                    {q.tipo === "nota" && (
                      <div className="escala-nota" role="radiogroup" aria-label={q.texto}>
                        {Array.from({ length: 11 }, (_, n) => (
                          <label key={n} className={respostas[q.id] === n ? "escolhida" : ""}>
                            <input type="radio" name={q.id} value={n} required={q.obrigatoria} checked={respostas[q.id] === n} onChange={() => setRespostas({ ...respostas, [q.id]: n })} />
                            {n}
                          </label>
                        ))}
                      </div>
                    )}
                  </fieldset>
                ))}
                <Mensagem tipo="erro">{envio.erro}</Mensagem>
                <button type="submit" className="botao botao-largo" disabled={envio.enviando}>
                  {envio.enviando ? "Enviando…" : "Enviar respostas"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
