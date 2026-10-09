import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MarcaPublicaDto } from "@mg/shared";
import { get, post } from "../../app/api";
import { Campo, Mensagem, useEnvio } from "../../ui/ui";
import { useSessao } from "../../app/sessao";
import { Logo } from "../whitelabel/Logo";

/** Marca do endereço (subdomínio ou domínio próprio) para as telas abertas. */
export function useMarcaPublica(): MarcaPublicaDto | null {
  const [m, setM] = useState<MarcaPublicaDto | null>(null);
  useEffect(() => {
    get<MarcaPublicaDto>("/marca").then(setM, () => undefined);
  }, []);
  return m;
}

export function Entrar() {
  const { recarregar } = useSessao();
  const marca = useMarcaPublica();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/auth/entrar", { email, senha });
    await recarregar();
  });

  return (
    <main className="tela-acesso">
      <form className="cartao" onSubmit={enviar}>
        {marca && <Logo claro={marca.logoClaro} escuro={marca.logoEscuro} nome={marca.empresa ?? marca.nomeProduto} classe="logo-entrada" />}
        <h1>{marca?.nomeProduto ?? document.title}</h1>
        <p className="subtitulo">{marca?.empresa ? `Entre na ${marca.empresa} com seu e-mail e senha.` : "Entre com seu e-mail e senha."}</p>
        <Campo rotulo="E-mail" nome="email" tipo="email" valor={email} aoMudar={setEmail} obrigatorio autoComplete="username" />
        <Campo rotulo="Senha" nome="senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio autoComplete="current-password" />
        <Mensagem tipo="erro">{erro}</Mensagem>
        <button type="submit" className="botao botao-largo" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
        <Link to="/esqueci-senha" className="link-secundario">
          Esqueci a senha
        </Link>
        {marca?.cadastroAberto && !marca.empresa && (
          <Link to="/cadastro" className="link-secundario">
            Ainda não tem conta? Cadastre sua empresa
          </Link>
        )}
      </form>
    </main>
  );
}
