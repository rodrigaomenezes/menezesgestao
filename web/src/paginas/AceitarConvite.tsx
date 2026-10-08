import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { SENHA_MINIMO } from "../../../src/compartilhado/limites";
import { ErroApi, get, post } from "../api";
import { Campo, Mensagem, useEnvio } from "../componentes/ui";
import { useSessao } from "../sessao";

interface Convite {
  empresaNome: string;
  email: string;
  nome: string;
  precisaSenha: boolean;
}

export function AceitarConvite() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navegar = useNavigate();
  const { recarregar } = useSessao();
  const [convite, setConvite] = useState<Convite | null>(null);
  const [problema, setProblema] = useState("");
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");

  useEffect(() => {
    get<Convite>(`/auth/convite?token=${encodeURIComponent(token)}`)
      .then((c) => {
        setConvite(c);
        setNome(c.nome);
      })
      .catch((err) => setProblema(err instanceof ErroApi ? err.message : "Não foi possível abrir o convite."));
  }, [token]);

  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/auth/aceitar-convite", convite?.precisaSenha ? { token, nome, senha } : { token });
    await recarregar();
    navegar("/", { replace: true });
  });

  return (
    <main className="tela-acesso">
      <form className="cartao" onSubmit={enviar}>
        <h1>Convite</h1>
        {problema && (
          <>
            <Mensagem tipo="erro">{problema}</Mensagem>
            <Link to="/" className="link-secundario">
              Ir para a entrada
            </Link>
          </>
        )}
        {!problema && !convite && <p>Carregando…</p>}
        {convite && (
          <>
            <p className="subtitulo">
              Você recebeu um convite para a empresa <strong>{convite.empresaNome}</strong>, no e-mail {convite.email}.
            </p>
            {convite.precisaSenha ? (
              <>
                <Campo rotulo="Seu nome" nome="nome" valor={nome} aoMudar={setNome} obrigatorio autoComplete="name" />
                <Campo rotulo="Crie uma senha" nome="senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio
                  minimo={SENHA_MINIMO} autoComplete="new-password"
                  dica={`Pelo menos ${SENHA_MINIMO} caracteres. Uma frase fácil de lembrar funciona bem.`} />
              </>
            ) : (
              <p>Você já tem cadastro: é só aceitar e continuar usando a mesma senha.</p>
            )}
            <Mensagem tipo="erro">{erro}</Mensagem>
            <button type="submit" className="botao botao-largo" disabled={enviando}>
              {enviando ? "Entrando…" : "Aceitar e entrar"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
