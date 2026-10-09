// Ligar/desligar os avisos neste aparelho (push quando a pessoa está fora do sistema).
import { useEffect, useState } from "react";
import type { PushConfigDto } from "@mg/shared";
import { ErroApi, get } from "../../app/api";
import { desligarAvisos, inscricaoAtual, ligarAvisos, pushSuportado } from "../../app/offline";
import { useAviso } from "../../ui/sobreposicoes";
import { Mensagem, useEnvio } from "../../ui/ui";

export function AvisosNoCelular() {
  const avisar = useAviso();
  const [config, setConfig] = useState<PushConfigDto | null>(null);
  const [ligado, setLigado] = useState(false);
  useEffect(() => {
    get<PushConfigDto>("/push/config").then(setConfig, () => undefined);
    void inscricaoAtual()
      .then((i) => setLigado(Boolean(i)))
      .catch(() => undefined);
  }, []);
  const ligar = useEnvio(async () => {
    const r = await ligarAvisos();
    if (r === "ligado") {
      setLigado(true);
      avisar("Avisos ligados neste aparelho.");
    } else if (r === "negado") throw new ErroApi(0, "DADOS_INVALIDOS", "O navegador bloqueou os avisos. Libere nas configurações do site e tente de novo.");
    else throw new ErroApi(0, "DADOS_INVALIDOS", "Avisos no celular não estão disponíveis agora.");
  });
  const desligar = useEnvio(async () => {
    await desligarAvisos();
    setLigado(false);
    avisar("Avisos desligados neste aparelho.");
  });
  if (!config) return null;

  return (
    <section className="cartao" aria-labelledby="titulo-avisos-celular">
      <h2 id="titulo-avisos-celular">Avisos neste aparelho</h2>
      {!config.ativo ? (
        <p className="dica">Os avisos fora do sistema ainda não foram configurados na plataforma. Enquanto isso, eles aparecem no sino.</p>
      ) : !pushSuportado() ? (
        <p className="dica">Este navegador não recebe avisos. No iPhone, instale o app (Compartilhar → Adicionar à Tela de Início) e abra por ele.</p>
      ) : (
        <>
          <p className="dica">
            Quando você estiver fora do sistema, os avisos do sino chegam aqui. Lembretes de ligação chegam só no celular.
          </p>
          <Mensagem tipo="erro">{ligar.erro || desligar.erro}</Mensagem>
          {ligado ? (
            <button type="button" className="botao botao-secundario" disabled={desligar.enviando} onClick={() => void desligar.enviar()}>
              Desligar avisos
            </button>
          ) : (
            <button type="button" className="botao" disabled={ligar.enviando} onClick={() => void ligar.enviar()}>
              Ligar avisos
            </button>
          )}
        </>
      )}
    </section>
  );
}
