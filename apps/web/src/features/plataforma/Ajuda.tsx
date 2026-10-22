// Central de ajuda: artigos da tela de onde a pessoa veio primeiro, busca, suporte e links para status e documentos.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DOCUMENTOS_LEGAIS, artigosPara, type SuporteDto } from "@mg/shared";
import { get } from "../../app/api";
import { Campo, Titulo } from "../../ui/ui";

export function Ajuda() {
  const [params] = useSearchParams();
  const tela = params.get("tela") ?? "/";
  const [busca, setBusca] = useState("");
  const [suporte, setSuporte] = useState<SuporteDto | null>(null);
  useEffect(() => {
    get<SuporteDto>("/publico/suporte").then(setSuporte, () => undefined);
  }, []);
  const artigos = artigosPara(tela, busca);
  return (
    <>
      <Titulo>Ajuda</Titulo>
      <section className="cartao">
        <Campo rotulo="Buscar na ajuda" nome="ajuda-busca" valor={busca} aoMudar={setBusca} />
        {!artigos.length && <p className="dica">Nada encontrado. Tente outra palavra ou fale com o suporte.</p>}
        {artigos.map((a, i) => (
          <details key={a.id} open={i === 0 && !busca}>
            <summary>{a.titulo}</summary>
            <ol>
              {a.passos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </details>
        ))}
      </section>
      <section className="cartao" aria-labelledby="titulo-suporte">
        <h2 id="titulo-suporte">Falar com o suporte</h2>
        {suporte?.whatsapp || suporte?.email ? (
          <div className="form-linha">
            {suporte.whatsapp && (
              <a className="botao" href={`https://wa.me/${suporte.whatsapp}`} target="_blank" rel="noreferrer">
                WhatsApp do suporte
              </a>
            )}
            {suporte.email && (
              <a className="botao botao-secundario" href={`mailto:${suporte.email}`}>
                E-mail do suporte
              </a>
            )}
          </div>
        ) : (
          <p className="dica">Fale com quem administra a sua empresa.</p>
        )}
        <p>
          <Link to="/status">Situação do serviço</Link> · {DOCUMENTOS_LEGAIS.map((d, i) => (
            <span key={d.id}>
              {i > 0 && " · "}
              <Link to={d.rota}>{d.titulo}</Link>
            </span>
          ))}
        </p>
      </section>
    </>
  );
}
