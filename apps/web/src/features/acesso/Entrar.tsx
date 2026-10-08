import { useState } from "react";
import { Link } from "react-router-dom";
import { post } from "../../app/api";
import { Campo, Mensagem, useEnvio } from "../../ui/ui";
import { useSessao } from "../../app/sessao";

export function Entrar() {
  const { recarregar } = useSessao();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/auth/entrar", { email, senha });
    await recarregar();
  });

  return (
    <main className="tela-acesso">
      <form className="cartao" onSubmit={enviar}>
        <h1>{document.title}</h1>
        <p className="subtitulo">Entre com seu e-mail e senha.</p>
        <Campo rotulo="E-mail" nome="email" tipo="email" valor={email} aoMudar={setEmail} obrigatorio autoComplete="username" />
        <Campo rotulo="Senha" nome="senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio autoComplete="current-password" />
        <Mensagem tipo="erro">{erro}</Mensagem>
        <button type="submit" className="botao botao-largo" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
        <Link to="/esqueci-senha" className="link-secundario">
          Esqueci a senha
        </Link>
      </form>
    </main>
  );
}
