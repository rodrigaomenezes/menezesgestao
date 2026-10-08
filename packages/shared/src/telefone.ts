// Normalização central de telefone (Prompt Mestre, princípio 014): E.164, com a regra do nono dígito brasileiro.
// É a chave de deduplicação em contatos, conversas e filas. Nenhum módulo normaliza telefone por conta própria.

const PAIS_PADRAO = "55";

/** Número brasileiro (sem o 55): DDD + assinante. Celular antigo de 8 dígitos ganha o 9 na frente. */
function normalizarBrasil(nacional: string): string | null {
  if (!/^[1-9][1-9]\d{8,9}$/.test(nacional)) return null;
  const ddd = nacional.slice(0, 2);
  let assinante = nacional.slice(2);
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) assinante = `9${assinante}`; // celular sem o nono dígito
  if (assinante.length === 9 && !assinante.startsWith("9")) return null;
  if (assinante.length === 8 && !/^[2-5]/.test(assinante)) return null;
  return `+55${ddd}${assinante}`;
}

/**
 * Converte o que a pessoa digitou (ou o que veio da planilha/provedor) em E.164: "+5511987654321".
 * Devolve null quando não dá para entender o número.
 */
export function normalizarTelefone(entrada: string | null | undefined, paisPadrao = PAIS_PADRAO): string | null {
  if (!entrada) return null;
  const texto = String(entrada).trim();
  const internacional = texto.startsWith("+") || texto.startsWith("00");
  let digitos = texto.replace(/\D/g, "");
  if (texto.startsWith("00")) digitos = digitos.slice(2);
  if (!digitos) return null;

  if (!internacional) {
    // Prefixo de discagem nacional (0) e código de operadora (0 + 2 dígitos) antes do DDD.
    if (digitos.startsWith("0")) {
      digitos = digitos.replace(/^0+/, "");
      if ((digitos.length === 12 || digitos.length === 13) && !digitos.startsWith(paisPadrao)) digitos = digitos.slice(2);
    }
    if (paisPadrao === PAIS_PADRAO) {
      // Número brasileiro sem "+": DDD + assinante (10 ou 11 dígitos), ou já com o 55 na frente.
      if (digitos.length === 10 || digitos.length === 11) return normalizarBrasil(digitos);
      if (digitos.startsWith(PAIS_PADRAO) && (digitos.length === 12 || digitos.length === 13)) return normalizarBrasil(digitos.slice(2));
      return null;
    }
    if (!digitos.startsWith(paisPadrao)) digitos = `${paisPadrao}${digitos}`;
  }

  if (digitos.startsWith(PAIS_PADRAO) && (digitos.length === 12 || digitos.length === 13)) {
    return normalizarBrasil(digitos.slice(2));
  }
  if (digitos.length < 8 || digitos.length > 15 || digitos.startsWith("0")) return null;
  return `+${digitos}`;
}

/**
 * Formas equivalentes do mesmo número (com e sem o nono dígito), para achar registros antigos ou
 * identificadores de provedores que não usam o 9. A primeira é sempre a forma canônica.
 */
export function variantesTelefone(e164: string): string[] {
  const m = /^\+55(\d{2})9(\d{8})$/.exec(e164);
  return m ? [e164, `+55${m[1]}${m[2]}`] : [e164];
}

/** Exibição amigável: "+5511987654321" → "(11) 98765-4321"; outros países ficam em E.164. */
export function formatarTelefone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
