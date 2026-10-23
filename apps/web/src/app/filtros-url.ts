// Filtros de tela guardados no endereço (?inicio=…&usuarioId=…): o "voltar" do navegador desfaz o último clique,
// o link pode ser enviado a outra pessoa e trocar de tela não perde o filtro. Toda tela com filtro usa este hook.
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type Filtros<K extends string> = Partial<Record<K, string>>;

/**
 * Lê os filtros `chaves` do endereço (com os padrões) e devolve como mudar.
 * Mudar cria um novo passo no histórico (o "voltar" volta ao filtro anterior); `substituir` não cria.
 */
export function useFiltrosUrl<K extends string>(chaves: readonly K[], padroes: Filtros<K> = {}) {
  const [params, setParams] = useSearchParams();
  const valores = useMemo(() => {
    const v: Filtros<K> = {};
    for (const k of chaves) v[k] = params.get(k) ?? padroes[k];
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const mudar = useCallback(
    (mudancas: Filtros<K>, opcoes: { substituir?: boolean } = {}) => {
      setParams(
        (atual) => {
          const novo = new URLSearchParams(atual);
          for (const [k, v] of Object.entries(mudancas) as [K, string | undefined][]) {
            if (v === undefined || v === "" || v === padroes[k]) novo.delete(k);
            else novo.set(k, v);
          }
          return novo;
        },
        { replace: Boolean(opcoes.substituir) },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );

  return { valores, mudar };
}

/** Soma dias a uma data AAAA-MM-DD (sem fuso: é só o calendário). */
export function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** "2026-10-22" → "22/10" (ou "22/10/2026" com ano). */
export function diaCurto(dia: string, comAno = false): string {
  const [a, m, d] = dia.split("-");
  return comAno ? `${d}/${m}/${a}` : `${d}/${m}`;
}

export interface Intervalo {
  inicio: string;
  fim: string;
}

/** Atalhos de período, do mais usado ao menos. `hoje` é a data local da empresa. */
export function atalhosDePeriodo(hoje: string): { id: string; nome: string; intervalo: Intervalo }[] {
  const mes = `${hoje.slice(0, 7)}-01`;
  const fimMesPassado = somarDias(mes, -1);
  return [
    { id: "hoje", nome: "Hoje", intervalo: { inicio: hoje, fim: hoje } },
    { id: "7d", nome: "7 dias", intervalo: { inicio: somarDias(hoje, -6), fim: hoje } },
    { id: "30d", nome: "30 dias", intervalo: { inicio: somarDias(hoje, -29), fim: hoje } },
    { id: "mes", nome: "Este mês", intervalo: { inicio: mes, fim: hoje } },
    { id: "mes-passado", nome: "Mês passado", intervalo: { inicio: `${fimMesPassado.slice(0, 7)}-01`, fim: fimMesPassado } },
  ];
}

/** Texto do intervalo para a etiqueta de filtro ("Hoje", "7 dias", "15/10 a 22/10"). */
export function nomeDoIntervalo(i: Intervalo, hoje: string): string {
  const atalho = atalhosDePeriodo(hoje).find((a) => a.intervalo.inicio === i.inicio && a.intervalo.fim === i.fim);
  if (atalho) return atalho.nome;
  return i.inicio === i.fim ? diaCurto(i.inicio, true) : `${diaCurto(i.inicio)} a ${diaCurto(i.fim, true)}`;
}
