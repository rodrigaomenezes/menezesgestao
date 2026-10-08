import { useEffect, useState } from "react";
import { contraste, corDoTextoSobre } from "../../../src/compartilhado/marca";
import { get, patch } from "../api";
import { Campo, Escolha, Mensagem, Titulo, useEnvio } from "../componentes/ui";
import { useSessao } from "../sessao";

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

function Cor({ rotulo, nome, valor, aoMudar }: { rotulo: string; nome: string; valor: string; aoMudar(v: string): void }) {
  const legivel = contraste(valor, corDoTextoSobre(valor)) >= 4.5;
  return (
    <div className="campo">
      <label htmlFor={nome}>{rotulo}</label>
      <div className="cor">
        <input id={nome} type="color" value={valor} onChange={(e) => aoMudar(e.target.value)} />
        <span className="cor-amostra" style={{ background: valor, color: corDoTextoSobre(valor) }}>
          Texto de exemplo
        </span>
      </div>
      {!legivel && <small className="dica">Pouco contraste: o texto pode ficar difícil de ler.</small>}
    </div>
  );
}

export function Empresa() {
  const { pode, recarregar } = useSessao();
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
    await patch("/empresa", {
      nome: dados.nome,
      fuso: dados.fuso,
      marca: { ...dados.marca, nomeProduto: dados.marca.nomeProduto || undefined },
    });
    setOk("Dados salvos. A nova marca já aparece para todos da empresa.");
    await recarregar();
  });

  if (erroCarga) return <Mensagem tipo="erro">{erroCarga}</Mensagem>;
  if (!dados) return <p>Carregando…</p>;

  const mudar = (parcial: Partial<DadosEmpresa>) => {
    setOk("");
    setDados({ ...dados, ...parcial });
  };
  const mudarMarca = (parcial: Partial<DadosEmpresa["marca"]>) => mudar({ marca: { ...dados.marca, ...parcial } });
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
            <Campo rotulo="Nome do produto (opcional)" nome="empresa-produto" valor={dados.marca.nomeProduto ?? ""}
              aoMudar={(nomeProduto) => mudarMarca({ nomeProduto })} dica="Aparece no topo, na aba do navegador e no app instalado." />
            <Cor rotulo="Cor principal" nome="cor-primaria" valor={dados.marca.corPrimaria} aoMudar={(corPrimaria) => mudarMarca({ corPrimaria })} />
            <Cor rotulo="Cor de destaque" nome="cor-destaque" valor={dados.marca.corDestaque} aoMudar={(corDestaque) => mudarMarca({ corDestaque })} />
          </div>
          <p className="dica">Plano atual: {dados.plano}. Para mudar de plano, fale com o suporte.</p>
          <Mensagem tipo="erro">{erro}</Mensagem>
          <Mensagem tipo="sucesso">{ok}</Mensagem>
          <button type="submit" className="botao" disabled={enviando}>
            {enviando ? "Salvando…" : "Salvar"}
          </button>
        </fieldset>
      </form>
    </>
  );
}
