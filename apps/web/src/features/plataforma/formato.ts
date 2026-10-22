const MB = 1024 * 1024;
/** Tamanho legível: "350 MB", "2,4 GB". */
export function formatarBytes(n: number): string {
  return n >= 1024 * MB ? `${(n / (1024 * MB)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : `${Math.round(n / MB).toLocaleString("pt-BR")} MB`;
}
