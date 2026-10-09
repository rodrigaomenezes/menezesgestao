// Datas da operação: o dia "de hoje" é o do fuso da empresa; horários digitados são do aparelho da pessoa.
import { FUSO_PADRAO } from "@mg/shared";
import { useSessao } from "../../app/sessao";

export function hojeNoFuso(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function useFuso(): string {
  return useSessao().eu?.empresa?.fuso ?? FUSO_PADRAO;
}

export const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Data (AAAA-MM-DD) + hora (HH:MM) digitadas → instante ISO. */
export const instante = (dia: string, hora: string) => new Date(`${dia}T${hora}`).toISOString();

/** Instante ISO → hora (HH:MM) no fuso. */
export const horaNoFuso = (iso: string, fuso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fuso });

/** "segunda-feira, 5 de outubro" */
export const diaPorExtenso = (dia: string) =>
  new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export const mesAtual = (fuso: string) => hojeNoFuso(fuso).slice(0, 7);

export function nomeDoMes(mes: string): string {
  const t = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
