// CPF e CNPJ (Konecta RF-CRM-002 e campo mascarado): validação pelos dígitos verificadores, normalização para só
// dígitos e a máscara que quem não pode ver o documento inteiro enxerga. Regras puras, sem servidor.
export const TIPOS_DOCUMENTO = ["cpf", "cnpj"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

const repetido = (d: string) => /^(\d)\1+$/.test(d);

function digitoCpf(base: string): number {
  const soma = [...base].reduce((t, c, i) => t + Number(c) * (base.length + 1 - i), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || repetido(digitos)) return false;
  return digitoCpf(digitos.slice(0, 9)) === Number(digitos[9]) && digitoCpf(digitos.slice(0, 10)) === Number(digitos[10]);
}

function digitoCnpj(base: string): number {
  const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const resto = [...base].reduce((t, c, i) => t + Number(c) * pesos[i]!, 0) % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjValido(digitos: string): boolean {
  if (!/^\d{14}$/.test(digitos) || repetido(digitos)) return false;
  return digitoCnpj(digitos.slice(0, 12)) === Number(digitos[12]) && digitoCnpj(digitos.slice(0, 13)) === Number(digitos[13]);
}

/** Texto digitado (com ou sem pontuação) → tipo e dígitos; null quando não é CPF nem CNPJ válido. */
export function normalizarDocumento(entrada: string): { tipo: TipoDocumento; digitos: string } | null {
  const digitos = entrada.replace(/\D/g, "");
  if (digitos.length === 11 && cpfValido(digitos)) return { tipo: "cpf", digitos };
  if (digitos.length === 14 && cnpjValido(digitos)) return { tipo: "cnpj", digitos };
  return null;
}

/** O final que fica guardado em claro para a máscara: 5 dígitos do CPF, 6 do CNPJ. */
export const finalDoDocumento = (tipo: TipoDocumento, digitos: string) => digitos.slice(tipo === "cpf" ? -5 : -6);

/** "•••.•••.123-45" (CPF) ou "••.•••.•••/0001-45" (CNPJ), a partir só do final guardado. */
export function mascararDocumento(tipo: TipoDocumento, final: string): string {
  return tipo === "cpf" ? `•••.•••.${final.slice(0, 3)}-${final.slice(3)}` : `••.•••.•••/${final.slice(0, 4)}-${final.slice(4)}`;
}

/** Documento inteiro com pontuação (para quem pode ver). */
export function formatarDocumento(tipo: TipoDocumento, d: string): string {
  return tipo === "cpf" ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Máscara enquanto digita (RC-09): até 11 dígitos vira CPF, acima vira CNPJ; colar com ou sem pontuação dá igual. */
export function mascararDigitando(entrada: string): string {
  const d = entrada.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
