// LGPD na ficha do contato: exportar os dados do titular e anonimizar (sem volta).
import { useState } from "react";
import { PALAVRA_ANONIMIZAR, type ContatoDto, type DadosTitularDto } from "@mg/shared";
import { get, post } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useAviso } from "../../ui/sobreposicoes";
import { Campo, Mensagem, useEnvio } from "../../ui/ui";

/** Baixa um JSON como arquivo, sem guardar nada no navegador. */
function baixarJson(dados: unknown, nome: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

export function Privacidade({ contato, aoMudar }: { contato: ContatoDto; aoMudar(): void }) {
  const { pode } = useSessao();
  const dataHora = useDataHora();
  const avisar = useAviso();
  const [anonimizando, setAnonimizando] = useState(false);
  const [palavra, setPalavra] = useState("");
  const exportar = useEnvio(async () => {
    const dados = await get<DadosTitularDto>(`/contatos/${contato.id}/dados-pessoais`);
    baixarJson(dados, `dados-pessoais-${contato.id.slice(0, 8)}.json`);
    avisar(dados.limitado ? "Arquivo gerado (listas muito longas vieram até o limite)." : "Arquivo gerado. Entregue ao titular por um canal seguro.");
  });
  const anonimizar = useEnvio(async () => {
    await post(`/contatos/${contato.id}/anonimizar`, { confirmacao: palavra });
    setAnonimizando(false);
    avisar("Dados pessoais apagados. O histórico ficou, sem identificar a pessoa.");
    aoMudar();
  });
  const podeExportar = pode("crm", "exportar");
  const podeAnonimizar = pode("crm", "administrar");
  if (!podeExportar && !podeAnonimizar) return null;

  return (
    <section className="cartao" aria-labelledby="titulo-privacidade">
      <h2 id="titulo-privacidade">Privacidade (LGPD)</h2>
      {contato.anonimizadoEm ? (
        <p>Dados pessoais apagados em {dataHora(contato.anonimizadoEm)}. O histórico continua contando para metas e relatórios.</p>
      ) : (
        <p className="dica">Pedido do titular: exporte tudo o que a empresa guarda sobre ele, ou apague os dados pessoais.</p>
      )}
      {!anonimizando && !contato.anonimizadoEm && (
        <div className="acoes-linha">
          {podeExportar && (
            <button type="button" className="botao botao-secundario" disabled={exportar.enviando} onClick={() => void exportar.enviar()}>
              Exportar dados
            </button>
          )}
          {podeAnonimizar && (
            <button type="button" className="botao botao-secundario" onClick={() => setAnonimizando(true)}>
              Anonimizar
            </button>
          )}
        </div>
      )}
      <Mensagem tipo="erro">{exportar.erro}</Mensagem>
      {anonimizando && (
        <form onSubmit={anonimizar.enviar} aria-label="Anonimizar contato">
          <Mensagem tipo="erro">
            Não tem volta: nome, telefone, e-mail, notas, mensagens, gravações e campos deste cadastro serão apagados. Vendas e números
            (metas, comissões) continuam valendo.
          </Mensagem>
          <Campo rotulo={`Digite ${PALAVRA_ANONIMIZAR} para confirmar`} nome="confirmar-anonimizar" valor={palavra} aoMudar={setPalavra} obrigatorio />
          <Mensagem tipo="erro">{anonimizar.erro}</Mensagem>
          <div className="acoes-linha">
            <button type="submit" className="botao botao-perigo" disabled={anonimizar.enviando || palavra !== PALAVRA_ANONIMIZAR}>
              Apagar dados pessoais
            </button>
            <button type="button" className="botao botao-secundario" onClick={() => setAnonimizando(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
