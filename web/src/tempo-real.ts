// Assinatura dos avisos em tempo real (SSE). Uma conexão por aba; as telas escutam os tipos que interessam.
import { useEffect, useRef } from "react";

export interface AvisoTempoReal {
  tipo: string;
  entidade?: string;
  entidadeId?: string | null;
}

type Ouvinte = (aviso: AvisoTempoReal) => void;

const ouvintes = new Set<Ouvinte>();

export function conectarTempoReal(): () => void {
  const fonte = new EventSource("/api/tempo-real");
  fonte.onmessage = (msg) => {
    try {
      const aviso = JSON.parse(msg.data) as AvisoTempoReal;
      for (const ouvinte of ouvintes) ouvinte(aviso);
    } catch {
      // aviso malformado: ignora
    }
  };
  return () => fonte.close();
}

/** Chama `aoReceber` quando chega um aviso cujo tipo começa com algum dos prefixos. */
export function useTempoReal(prefixos: string[], aoReceber: (aviso: AvisoTempoReal) => void): void {
  const ref = useRef(aoReceber);
  useEffect(() => {
    ref.current = aoReceber;
  });
  const chave = prefixos.join("|");
  useEffect(() => {
    const lista = chave.split("|");
    const ouvinte: Ouvinte = (a) => {
      if (lista.some((p) => a.tipo.startsWith(p))) ref.current(a);
    };
    ouvintes.add(ouvinte);
    return () => {
      ouvintes.delete(ouvinte);
    };
  }, [chave]);
}
