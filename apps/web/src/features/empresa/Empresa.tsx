import { useEffect, useState } from "react";
import { get, patch } from "../../app/api";
import { Campo, Escolha, Mensagem, Titulo, useEnvio } from "../../ui/ui";
import { useSessao } from "../../app/sessao";
import { Link } from "react-router-dom";
import { SegurancaEmpresa } from "./SegurancaEmpresa";
import { PrivacidadeEmpresa } from "./PrivacidadeEmpresa";
import { EnviarLogo, FormCores, FormDominio, FormVocabulario, useConfigMarca } from "../whitelabel/Marca";

interface DadosEmpresa {
  nome: string;
  fuso: string;
  plano: string;
  marca: { nomeProduto?: string; corPrimaria: string; corDestaque: string };
}

const FUSOS_BR = [
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Fortaleza",
  "America/Recife",
  "America/Belem",
  "America/Manaus",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco",
  "America/Noronha",
];


export function Empresa() {
  const { pode, recarregar } = useSessao();
  const marca = useConfigMarca();
  const [dados, setDados] = useState<DadosEmpresa | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    get<DadosEmpresa>("/empresa")
      .then(setDados)
      .catch((err: Error) => setErroCarga(err.message));
  }, []);

  const { enviando, erro, enviar } = useEnvio(async () => {
    if (!dados) return;
    await patch("/empresa", { nome: dados.nome, fuso: dados.fuso });
    setOk("Dados salvos.");
    await recarregar();
  });

  if (erroCarga) return <Mensagem tipo="erro">{erroCarga}</Mensagem>;
  if (!dados) return <p>Carregando…</p>;

  const mudar = (parcial: Partial<DadosEmpresa>) => {
    setOk("");
    setDados({ ...dados, ...parcial });
  };
  const fusos = FUSOS_BR.includes(dados.fuso) ? FUSOS_BR : [dados.fuso, ...FUSOS_BR];

  return (
    <>
      <Titulo>Empresa e marca</Titulo>
      <form className="cartao" onSubmit={enviar}>
        <fieldset disabled={!pode("configuracoes", "editar")}>
          <div className="grade-campos">
            <Campo rotulo="Nome da empresa" nome="empresa-nome" valor={dados.nome} aoMudar={(nome) => mudar({ nome })} obrigatorio />
            <Escolha rotulo="Fuso horário" nome="empresa-fuso" valor={dados.fuso} aoMudar={(fuso) => mudar({ fuso })}
              opcoes={fusos.map((f) => ({ valor: f, texto: f.replace("America/", "").replace("_", " ") }))} />
          </div>
          <p className="dica">
            Plano atual: {dados.plano}. <Link to="/plano">Ver plano e cobrança</Link>
          </p>
          <Mensagem tipo="erro">{erro}</Mensagem>
          <Mensagem tipo="sucesso">{ok}</Mensagem>
          <button type="submit" className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </fieldset>
      </form>
      <Mensagem tipo="erro">{marca.erro}</Mensagem>
      {marca.config && (
        <fieldset className="sem-borda" disabled={!pode("configuracoes", "editar")}>
          <section className="cartao" aria-labelledby="titulo-marca">
            <h2 id="titulo-marca">Marca</h2>
            <FormCores config={marca.config} aoSalvar={marca.setConfig} />
            <div className="grade-campos">
              <EnviarLogo tipo="claro" atual={marca.config.logoClaro} aoSalvar={marca.setConfig} />
              <EnviarLogo tipo="escuro" atual={marca.config.logoEscuro} aoSalvar={marca.setConfig} />
            </div>
          </section>
          <section className="cartao" aria-labelledby="titulo-vocabulario">
            <h2 id="titulo-vocabulario">Vocabulário</h2>
            <FormVocabulario config={marca.config} aoSalvar={marca.setConfig} />
          </section>
          {pode("configuracoes", "administrar") && (
            <section className="cartao" aria-labelledby="titulo-endereco">
              <h2 id="titulo-endereco">Endereço</h2>
              <FormDominio config={marca.config} aoSalvar={marca.setConfig} />
            </section>
          )}
        </fieldset>
      )}
      <SegurancaEmpresa />
      <PrivacidadeEmpresa />
    </>
  );
}
