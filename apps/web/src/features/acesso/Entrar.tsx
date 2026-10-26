import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EntrarResposta, MarcaPublicaDto } from "@mg/shared";
import { ErroApi, get, post } from "../../app/api";
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

/** Segundos até `ate` (instante em ms), atualizados a cada segundo; 0 quando passou. */
function useContagem(ate: number | null): number {
  const [agora, setAgora] = useState(() => Date.now());
  const restante = ate ? Math.max(0, Math.ceil((ate - agora) / 1000)) : 0;
  useEffect(() => {
    if (!restante) return;
    const t = window.setTimeout(() => setAgora(Date.now()), 1000);
    return () => window.clearTimeout(t);
  }, [restante, agora]);
  return restante;
}

const tempo = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`);

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
  // Login bloqueado por tentativas: contagem regressiva e botão desligado até zerar (RC-07).
  const [liberaEm, setLiberaEm] = useState<number | null>(null);
  const bloqueio = useContagem(liberaEm);
  const { enviando, erro, enviar } = useEnvio(async () => {
    setLiberaEm(null);
    const r = await post<EntrarResposta>("/auth/entrar", { email, senha }).catch((e: unknown) => {
      const s = e instanceof ErroApi && e.codigo === "LOGIN_BLOQUEADO" ? e.detalhes.tenteEmSegundos : undefined;
      setLiberaEm(typeof s === "number" ? Date.now() + s * 1000 : null);
      throw e;
    });
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
        <Mensagem tipo="erro">{bloqueio ? `Muitas tentativas erradas. Tente de novo em ${tempo(bloqueio)} ou use “Esqueci a senha”.` : liberaEm ? "" : erro}</Mensagem>
        <button type="submit" className="botao botao-largo" disabled={enviando || bloqueio > 0}>
          {enviando ? "Entrando…" : bloqueio ? `Aguarde ${tempo(bloqueio)}` : "Entrar"}
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
