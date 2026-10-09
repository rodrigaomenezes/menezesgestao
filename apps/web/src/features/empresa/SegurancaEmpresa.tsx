// Regras de segurança da empresa: quem precisa do login em duas etapas.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EXIGENCIAS_DUAS_ETAPAS, NOMES_EXIGENCIAS_DUAS_ETAPAS, type ExigenciaDuasEtapas, type SegurancaEmpresaDto } from "@mg/shared";
import { get, put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { Escolha, Mensagem, useEnvio } from "../../ui/ui";

export function SegurancaEmpresa() {
  const { eu, pode, recarregar } = useSessao();
  const [valor, setValor] = useState<ExigenciaDuasEtapas | "">("");
  const [ok, setOk] = useState("");
  useEffect(() => {
    get<SegurancaEmpresaDto>("/empresa/seguranca").then((r) => setValor(r.exigirDuasEtapas), () => undefined);
  }, []);
  const envio = useEnvio(async () => {
    await put("/empresa/seguranca", { exigirDuasEtapas: valor });
    setOk("Regra salva. Quem precisar configurar vai ver o aviso ao entrar.");
    await recarregar();
  });
  if (!valor) return null;
  const admin = pode("configuracoes", "administrar");
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-labelledby="titulo-seguranca">
      <h2 id="titulo-seguranca">Segurança</h2>
      <fieldset disabled={!admin}>
        <Escolha
          rotulo="Login em duas etapas"
          nome="exigir-duas-etapas"
          valor={valor}
          aoMudar={(v) => (setOk(""), setValor(v as ExigenciaDuasEtapas))}
          opcoes={EXIGENCIAS_DUAS_ETAPAS.map((x) => ({ valor: x, texto: NOMES_EXIGENCIAS_DUAS_ETAPAS[x] }))}
        />
        <p className="dica">
          Quando for obrigatória, quem ainda não configurou só consegue usar o sistema depois de configurar.
          {!eu?.duasEtapas.ativa && (
            <>
              {" "}
              Para exigir da equipe, ligue antes na sua conta: <Link to="/seguranca">Segurança da conta</Link>.
            </>
          )}
        </p>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <Mensagem tipo="sucesso">{ok}</Mensagem>
        {admin && (
          <button type="submit" className="botao" disabled={envio.enviando}>
            Salvar regra
          </button>
        )}
      </fieldset>
    </form>
  );
}
