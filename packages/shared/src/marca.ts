// Marca por empresa (white-label). O tema claro/escuro deriva das cores com contraste verificado.

export interface Marca {
  nomeProduto?: string;
  corPrimaria: string;
  corDestaque: string;
  /** Arquivos do logo (versões para fundo claro e escuro). */
  logoClaroId?: string;
  logoEscuroId?: string;
}

export const MARCA_PADRAO: Marca = { corPrimaria: "#1f5fbf", corDestaque: "#e07a1f" };

export const COR_HEX = /^#[0-9a-fA-F]{6}$/;

function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Cor do texto sobre a cor dada: a que tiver mais contraste entre branco e quase-preto. */
export function corDoTextoSobre(fundo: string): string {
  return contraste(fundo, "#ffffff") >= contraste(fundo, "#111111") ? "#ffffff" : "#111111";
}

const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export function lerMarca(bruto: unknown): Marca {
  const m = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const cor = (v: unknown, padrao: string) => (typeof v === "string" && COR_HEX.test(v) ? v : padrao);
  return {
    nomeProduto: typeof m.nomeProduto === "string" && m.nomeProduto.trim() ? m.nomeProduto.trim() : undefined,
    corPrimaria: cor(m.corPrimaria, MARCA_PADRAO.corPrimaria),
    corDestaque: cor(m.corDestaque, MARCA_PADRAO.corDestaque),
    logoClaroId: uuid(m.logoClaroId),
    logoEscuroId: uuid(m.logoEscuroId),
  };
}
