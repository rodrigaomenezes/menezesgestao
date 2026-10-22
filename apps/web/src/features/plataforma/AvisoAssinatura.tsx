// Faixa no topo de todas as telas: teste acabando, pagamento atrasado (ainda grava) ou só consulta (não grava).
import { Link } from "react-router-dom";
import { DIAS_TOLERANCIA_ATRASO } from "@mg/shared";
import { useEu, useSessao } from "../../app/sessao";

const AVISAR_TESTE_DIAS = 3;

function diasAte(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Math.ceil((Date.UTC(a!, m! - 1, d!) - Date.now()) / 86_400_000);
}

export function AvisoAssinatura() {
  const eu = useEu();
  const { pode } = useSessao();
  const s = eu.assinatura;
  if (!s) return null;
  const admin = pode("configuracoes", "administrar");
  const link = admin ? (
    <>
      {" "}
      <Link to="/plano">Ver plano e cobrança</Link>
    </>
  ) : (
    " Avise quem administra a empresa."
  );
  if (s.status === "suspensa") {
    return (
      <p className="mensagem mensagem-erro aviso-assinatura" role="alert">
        A empresa está suspensa: dá para consultar os dados, mas não para gravar. Fale com o suporte na central de ajuda.
      </p>
    );
  }
  if (s.somenteLeitura) {
    return (
      <p className="mensagem mensagem-erro aviso-assinatura" role="alert">
        Só para consulta: o pagamento está atrasado há {s.diasAtraso} dias. Nada foi apagado; ao pagar, tudo volta na hora.{link}
      </p>
    );
  }
  if (s.diasAtraso > 0) {
    const restam = DIAS_TOLERANCIA_ATRASO - s.diasAtraso + 1;
    return (
      <p className="mensagem mensagem-erro aviso-assinatura" role="status">
        Pagamento atrasado há {s.diasAtraso} dia(s). Em {restam} dia(s) a empresa fica só para consulta.{link}
      </p>
    );
  }
  if (s.status === "teste" && s.testeAte) {
    const dias = diasAte(s.testeAte);
    if (dias <= AVISAR_TESTE_DIAS) {
      return (
        <p className="mensagem mensagem-info aviso-assinatura" role="status">
          {dias <= 0 ? "O período de teste termina hoje." : `O período de teste termina em ${dias} dia(s).`}
          {link}
        </p>
      );
    }
  }
  return null;
}
