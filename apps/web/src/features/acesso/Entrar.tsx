import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EntrarResposta, MarcaPublicaDto } from "@mg/shared";
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

/** Segunda etapa: código do app autenticador, do e-mail ou de recuperação. */
function Codigo({ desafio, aoVoltar }: { desafio: NonNullable<EntrarResposta["duasEtapas"]>; aoVoltar(): void }) {
  const { recarregar } = useSessao();
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState("");
  const { enviando, erro, enviar } = useEnvio(async () => {
    await post("/auth/duas-etapas", { codigo });
    await recarregar();
  });
  const reenvio = useEnvio(async () => {
    await post("/auth/duas-etapas/reenviar");
    setAviso("Enviamos um código novo. O anterior deixou de valer.");
  });
  return (
    <form className="cartao" onSubmit={enviar} aria-label="Código de verificação">
      <h1>Confirme que é você</h1>
      <p className="subtitulo">
        {desafio.metodo === "totp"
          ? "Abra o app autenticador no celular e digite o código de 6 dígitos."
          : `Enviamos um código de 6 dígitos para ${desafio.destino ?? "o seu e-mail"}.`}
      </p>
      <div className="campo">
        <label htmlFor="codigo-verificacao">Código</label>
        <input
          id="codigo-verificacao"
          name="codigo"
          inputMode="text"
          autoComplete="one-time-code"
          required
          minLength={6}
          maxLength={20}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          aria-describedby="codigo-verificacao-dica"
        />
        <small id="codigo-verificacao-dica" className="dica">
          Sem acesso ao {desafio.metodo === "totp" ? "app" : "e-mail"}? Use um dos códigos de recuperação (ex.: k7mq-2xpd).
        </small>
      </div>
      <Mensagem tipo="erro">{erro || reenvio.erro}</Mensagem>
      <Mensagem tipo="info">{aviso}</Mensagem>
      <button type="submit" className="botao botao-largo" disabled={enviando}>
        {enviando ? "Conferindo…" : "Entrar"}
      </button>
      {desafio.metodo === "email" && (
        <button type="button" className="link-secundario" disabled={reenvio.enviando} onClick={() => void reenvio.enviar()}>
          Mandar outro código
        </button>
      )}
      <button type="button" className="link-secundario" onClick={aoVoltar}>
        Voltar
      </button>
    </form>
  );
}

export function Entrar() {
  const { recarregar } = useSessao();
  const marca = useMarcaPublica();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [desafio, setDesafio] = useState<EntrarResposta["duasEtapas"] | null>(null);
  const { enviando, erro, enviar } = useEnvio(async () => {
    const r = await post<EntrarResposta>("/auth/entrar", { email, senha });
    if (r.duasEtapas) {
      setSenha("");
      setDesafio(r.duasEtapas);
      return;
    }
    await recarregar();
  });

  if (desafio) {
    return (
      <main className="tela-acesso">
        <Codigo desafio={desafio} aoVoltar={() => setDesafio(null)} />
      </main>
    );
  }
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
