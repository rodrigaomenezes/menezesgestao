import { useState } from "react";
import { Link } from "react-router-dom";
import { post } from "../api";
import { Campo, Mensagem, useEnvio } from "../componentes/ui";

export function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/auth/esqueci", { email });
    setEnviado(true);
  });

  return (
    <main className="tela-acesso">
      <form className="cartao" onSubmit={enviar}>
        <h1>Esqueci a senha</h1>
        {enviado ? (
          <Mensagem tipo="sucesso">
            Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha. Confira também a caixa de spam.
          </Mensagem>
        ) : (
          <>
            <p className="subtitulo">Informe seu e-mail. Vamos mandar um link para você criar uma nova senha.</p>
            <Campo rotulo="E-mail" nome="email" tipo="email" valor={email} aoMudar={setEmail} obrigatorio autoComplete="username" />
            <Mensagem tipo="erro">{erro}</Mensagem>
            <button type="submit" className="botao botao-largo" disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar link"}
            </button>
          </>
        )}
        <Link to="/" className="link-secundario">
          Voltar para a entrada
        </Link>
      </form>
    </main>
  );
}
