// Cadastro aberto: a empresa cria a conta e cai direto no assistente de primeiro acesso.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DIAS_TESTE, SENHA_MINIMO } from "@mg/shared";
import { post } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { Campo, Mensagem, useEnvio } from "../../ui/ui";
import { useMarcaPublica } from "../acesso/Entrar";

export function Cadastro() {
  const { recarregar } = useSessao();
  const navegar = useNavigate();
  const marca = useMarcaPublica();
  const [empresa, setEmpresa] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [aceite, setAceite] = useState(false);
  const envio = useEnvio(async () => {
    await post("/cadastro", { empresa, nome, email, senha, aceite });
    await post("/auth/entrar", { email, senha });
    // Vai para o assistente antes de carregar a sessão (a troca de telas abertas → internas desmonta esta).
    navegar("/primeiros-passos", { replace: true });
    await recarregar();
  });

  if (marca && !marca.cadastroAberto) {
    return (
      <main className="tela-acesso">
        <div className="cartao">
          <h1>Cadastro fechado</h1>
          <p>O cadastro de novas empresas está fechado. Fale com quem administra a plataforma.</p>
          <Link to="/" className="link-secundario">
            Voltar para a entrada
          </Link>
        </div>
      </main>
    );
  }
  return (
    <main className="tela-acesso">
      <form className="cartao" onSubmit={envio.enviar} aria-label="Cadastrar empresa">
        <h1>Cadastre sua empresa</h1>
        <p className="subtitulo">Grátis por {DIAS_TESTE} dias, com todos os módulos. Em seguida, um passo a passo deixa tudo pronto.</p>
        <Campo rotulo="Nome da empresa" nome="cad-empresa" valor={empresa} aoMudar={setEmpresa} obrigatorio />
        <Campo rotulo="Seu nome" nome="cad-nome" valor={nome} aoMudar={setNome} obrigatorio autoComplete="name" />
        <Campo rotulo="Seu e-mail" nome="cad-email" tipo="email" valor={email} aoMudar={setEmail} obrigatorio autoComplete="username" />
        <Campo rotulo="Crie uma senha" nome="cad-senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio minimo={SENHA_MINIMO} autoComplete="new-password" dica={`Pelo menos ${SENHA_MINIMO} caracteres.`} />
        <label className="marcar">
          <input type="checkbox" checked={aceite} required onChange={(e) => setAceite(e.target.checked)} />
          Li e aceito os termos de uso e a política de privacidade.
        </label>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <button type="submit" className="botao botao-largo" disabled={envio.enviando}>
          {envio.enviando ? "Criando…" : "Criar conta"}
        </button>
        <Link to="/" className="link-secundario">
          Já tenho conta
        </Link>
      </form>
    </main>
  );
}
