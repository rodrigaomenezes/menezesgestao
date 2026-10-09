// Prazos de retenção (LGPD): quanto tempo a empresa guarda mensagens e contatos arquivados.
import { useEffect, useState } from "react";
import { LIMITES_RETENCAO, type RetencaoDto } from "@mg/shared";
import { get, put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { Escolha, Mensagem, useEnvio } from "../../ui/ui";

const MESES_MENSAGENS = [6, 12, 24, 36, 60];
const MESES_ARQUIVADOS = [1, 3, 6, 12, 24];
const texto = (m: number) => (m % 12 === 0 ? `${m / 12} ano(s)` : `${m} meses`);

export function PrivacidadeEmpresa() {
  const { pode } = useSessao();
  const [r, setR] = useState<RetencaoDto | null>(null);
  const [ok, setOk] = useState("");
  useEffect(() => {
    get<RetencaoDto>("/empresa/retencao").then(setR, () => undefined);
  }, []);
  const envio = useEnvio(async () => {
    if (!r) return;
    setR(await put<RetencaoDto>("/empresa/retencao", r));
    setOk("Prazos salvos. A limpeza roda todo dia de madrugada.");
  });
  if (!r) return null;
  const admin = pode("configuracoes", "administrar");
  const opcoes = (lista: number[], limite: { min: number; max: number }) => [
    { valor: "", texto: "Guardar sem prazo" },
    ...lista.filter((m) => m >= limite.min && m <= limite.max).map((m) => ({ valor: String(m), texto: texto(m) })),
  ];
  const mudar = (campo: keyof RetencaoDto, v: string) => (setOk(""), setR({ ...r, [campo]: v ? Number(v) : null }));
  return (
    <form className="cartao" onSubmit={envio.enviar} aria-labelledby="titulo-privacidade-empresa">
      <h2 id="titulo-privacidade-empresa">Privacidade (LGPD)</h2>
      <fieldset disabled={!admin}>
        <div className="grade-campos">
          <Escolha
            rotulo="Apagar o conteúdo de mensagens com mais de"
            nome="retencao-mensagens"
            valor={r.mensagensMeses ? String(r.mensagensMeses) : ""}
            aoMudar={(v) => mudar("mensagensMeses", v)}
            opcoes={opcoes(MESES_MENSAGENS, LIMITES_RETENCAO.mensagensMeses)}
          />
          <Escolha
            rotulo="Anonimizar contatos arquivados há mais de"
            nome="retencao-arquivados"
            valor={r.arquivadosMeses ? String(r.arquivadosMeses) : ""}
            aoMudar={(v) => mudar("arquivadosMeses", v)}
            opcoes={opcoes(MESES_ARQUIVADOS, LIMITES_RETENCAO.arquivadosMeses)}
          />
        </div>
        <p className="dica">
          A conversa e os números continuam (metas, relatórios); só o conteúdo pessoal sai. Gravações de ligação seguem o prazo da
          configuração de telefonia. Quem pediu para não ser contatado fica marcado na ficha e não recebe mensagens nem ligações.
        </p>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <Mensagem tipo="sucesso">{ok}</Mensagem>
        {admin && (
          <button type="submit" className="botao" disabled={envio.enviando}>
            Salvar prazos
          </button>
        )}
      </fieldset>
    </form>
  );
}
