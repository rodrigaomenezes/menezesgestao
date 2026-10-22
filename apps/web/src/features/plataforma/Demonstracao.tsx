// Tela antes do login, só para quem tem a chave do servidor: gera empresas de exemplo por segmento (dados fictícios)
// e entra nelas com um clique em cada papel, para apresentar o sistema.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PAPEIS_DEMONSTRACAO, type EmpresaDemonstracaoDto, type PainelDemonstracaoDto, type PapelDemonstracao } from "@mg/shared";
import { ErroApi, get, post } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { Campo, Mensagem, useEnvio } from "../../ui/ui";

const NOMES_RESUMO: Record<string, string> = {
  pessoas: "pessoas",
  contatos: "contatos",
  oportunidades: "oportunidades",
  conversas: "conversas",
  mensagens: "mensagens",
  ligacoes: "ligações",
  tarefas: "tarefas",
  vendas: "vendas",
};

function Chave({ aoEntrar }: { aoEntrar(): void }) {
  const [chave, setChave] = useState("");
  const envio = useEnvio(async () => {
    await post("/demonstracao/acesso", { chave });
    aoEntrar();
  });
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-label="Abrir a demonstração">
      <h1>Demonstração</h1>
      <p className="subtitulo">Empresas de exemplo com dados fictícios, para apresentar o sistema.</p>
      <Campo rotulo="Chave da demonstração" nome="demo-chave" tipo="password" valor={chave} aoMudar={setChave} obrigatorio autoComplete="off" />
      <Mensagem tipo="erro">{envio.erro}</Mensagem>
      <button type="submit" className="botao botao-largo" disabled={envio.enviando}>
        Abrir
      </button>
    </form>
  );
}

function CartaoEmpresa({ e, aoMudar }: { e: EmpresaDemonstracaoDto; aoMudar(): void }) {
  const navegar = useNavigate();
  const { recarregar } = useSessao();
  const [erro, setErro] = useState("");
  const entrar = async (papel: PapelDemonstracao) => {
    try {
      await post(`/demonstracao/${e.id}/entrar`, { papel });
      await recarregar();
      navegar("/", { replace: true });
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não foi possível entrar.");
    }
  };
  const arquivar = async () => {
    try {
      await post(`/demonstracao/${e.id}/arquivar`);
      aoMudar();
    } catch (err) {
      setErro(err instanceof ErroApi ? err.message : "Não foi possível arquivar.");
    }
  };
  return (
    <li className="item">
      <div className="item-principal">
        <strong>{e.empresaNome ?? "Gerando…"}</strong>
        {e.status === "gerando" && <span className="item-detalhe">Gerando dados fictícios… leva alguns segundos.</span>}
        {e.status === "falhou" && <Mensagem tipo="erro">{e.erro}</Mensagem>}
        {e.status === "pronta" && (
          <span className="item-detalhe">
            {Object.entries(e.resumo)
              .filter(([k]) => NOMES_RESUMO[k])
              .map(([k, n]) => `${n.toLocaleString("pt-BR")} ${NOMES_RESUMO[k]}`)
              .join(" · ")}
          </span>
        )}
      </div>
      {e.status === "pronta" && (
        <div className="item-acoes">
          {PAPEIS_DEMONSTRACAO.map((p) => (
            <button key={p.id} type="button" className="botao" title={`Vê ${p.ve}`} onClick={() => void entrar(p.id)}>
              Entrar como {p.nome.toLowerCase()}
            </button>
          ))}
        </div>
      )}
      {e.status !== "gerando" && (
        <div className="item-acoes">
          <button type="button" className="botao botao-secundario" onClick={() => void arquivar()}>
            Arquivar
          </button>
        </div>
      )}
      <Mensagem tipo="erro">{erro}</Mensagem>
    </li>
  );
}

export function Demonstracao() {
  const [painel, setPainel] = useState<PainelDemonstracaoDto | null>(null);
  const [precisaChave, setPrecisaChave] = useState(false);
  const [indisponivel, setIndisponivel] = useState(false);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<PainelDemonstracaoDto>("/demonstracao").then(
      (p) => {
        setPainel(p);
        setPrecisaChave(false);
      },
      (e) => {
        if (e instanceof ErroApi && e.status === 404) setIndisponivel(true);
        else setPrecisaChave(true);
      },
    );
  }, []);
  useEffect(carregar, [carregar]);
  // Enquanto algum exemplo é gerado, consulta de novo a cada 3 s (só nesta tela e só enquanto há geração).
  const gerando = painel?.empresas.some((e) => e.status === "gerando");
  useEffect(() => {
    if (!gerando) return;
    const t = window.setTimeout(carregar, 3000);
    return () => window.clearTimeout(t);
  }, [gerando, painel, carregar]);

  const gerar = async (segmento: string) => {
    setErro("");
    try {
      await post(`/demonstracao/segmentos/${segmento}`);
      carregar();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não foi possível gerar.");
    }
  };

  if (indisponivel) {
    return (
      <main className="tela-acesso" id="conteudo">
        <div className="cartao">
          <h1>Demonstração</h1>
          <p>A demonstração não está ligada neste servidor.</p>
        </div>
      </main>
    );
  }
  if (precisaChave) {
    return (
      <main className="tela-acesso" id="conteudo">
        <Chave aoEntrar={carregar} />
      </main>
    );
  }
  if (!painel) return <p className="carregando">Carregando…</p>;
  return (
    <main className="pagina-aberta" id="conteudo">
      <h1>Demonstração</h1>
      <p className="dica">Cada exemplo é uma empresa separada, com 90 dias de dados fictícios. Nenhum dado real é usado ou alterado.</p>
      <Mensagem tipo="erro">{erro}</Mensagem>
      <section className="cartao" aria-labelledby="titulo-segmentos">
        <h2 id="titulo-segmentos">Carregar exemplo</h2>
        <ul className="lista">
          {painel.segmentos.map((s) => (
            <li key={s.id} className="item">
              <div className="item-principal">
                <strong>{s.empresa}</strong>
                <span className="item-detalhe">
                  {s.nome} — {s.descricao}
                </span>
              </div>
              <div className="item-acoes">
                <button type="button" className="botao botao-secundario" disabled={painel.empresas.some((e) => e.segmento === s.id && e.status === "gerando")} onClick={() => void gerar(s.id)}>
                  {painel.empresas.some((e) => e.segmento === s.id && e.status === "pronta") ? "Gerar de novo" : "Carregar exemplo"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="cartao" aria-labelledby="titulo-exemplos">
        <h2 id="titulo-exemplos">Empresas de exemplo</h2>
        {!painel.empresas.length && <p className="dica">Nenhuma ainda. Carregue um exemplo acima.</p>}
        <ul className="lista">
          {painel.empresas.map((e) => (
            <CartaoEmpresa key={e.id} e={e} aoMudar={carregar} />
          ))}
        </ul>
      </section>
    </main>
  );
}
