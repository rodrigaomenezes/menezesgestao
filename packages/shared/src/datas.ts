// Datas: gravadas em UTC; exibidas no fuso da empresa.
export const FUSO_PADRAO = "America/Sao_Paulo";

export function formatarDataHora(iso: string, fuso = FUSO_PADRAO): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: fuso });
}

export function formatarData(iso: string, fuso = FUSO_PADRAO): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: fuso });
}
