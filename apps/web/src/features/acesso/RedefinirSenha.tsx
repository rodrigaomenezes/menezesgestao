import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SENHA_MINIMO } from "@mg/shared";
import { post } from "../../app/api";
import { Campo, Mensagem, useEnvio } from "../../ui/ui";

export function RedefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [pronto, setPronto] = useState(false);
  const { enviando, erro, setErro, enviar } = useEnvio(async () => {
    if (senha !== confirmacao) {
      setErro("As duas senhas estão diferentes. Digite de novo.");
      return;
    }
    await post("/auth/redefinir", { token, senha });
    setPronto(true);
  });

  return (
    <main className="tela-acesso">
      <form className="cartao" onSubmit={enviar}>
        <h1>Criar nova senha</h1>
        {pronto ? (
          <Mensagem tipo="sucesso">Senha criada. Por segurança, encerramos as sessões abertas: entre de novo.</Mensagem>
        ) : (
          <>
            <Campo rotulo="Nova senha" nome="senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio minimo={SENHA_MINIMO}
              autoComplete="new-password" dica={`Pelo menos ${SENHA_MINIMO} caracteres. Uma frase fácil de lembrar funciona bem.`} />
            <Campo rotulo="Repita a senha" nome="confirmacao" tipo="password" valor={confirmacao} aoMudar={setConfirmacao} obrigatorio
              autoComplete="new-password" />
            <Mensagem tipo="erro">{erro}</Mensagem>
            <button type="submit" className="botao botao-largo" disabled={enviando}>
              {enviando ? "Salvando…" : "Salvar senha"}
            </button>
          </>
        )}
        <Link to="/" className="link-secundario">
          Ir para a entrada
        </Link>
      </form>
    </main>
  );
}
