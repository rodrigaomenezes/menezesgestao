// Senha de uso único por tempo (TOTP, RFC 6238): HMAC-SHA1, passos de 30 s, 6 dígitos. Sem dependência externa.
import { createHmac, randomBytes } from "node:crypto";

const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const PASSO_SEGUNDOS = 30;

export function base32(dados: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of dados) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO[(valor << (5 - bits)) & 31];
  return saida;
}

export function deBase32(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpo) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error("Chave base32 inválida");
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Chave nova (160 bits), em base32 — o formato que os apps autenticadores leem. */
export function novoSegredoTotp(): string {
  return base32(randomBytes(20));
}

export function passoAtual(agoraMs = Date.now()): number {
  return Math.floor(agoraMs / 1000 / PASSO_SEGUNDOS);
}

export function codigoTotp(segredo: string, passo: number, digitos = 6): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(passo));
  const hmac = createHmac("sha1", deBase32(segredo)).update(contador).digest();
  const deslocamento = hmac[hmac.length - 1] & 0xf;
  const numero = (hmac.readUInt32BE(deslocamento) & 0x7fffffff) % 10 ** digitos;
  return numero.toString().padStart(digitos, "0");
}

/**
 * Confere o código aceitando um passo antes e um depois (relógio do celular adiantado ou atrasado).
 * Devolve o passo usado — quem chama grava e recusa passos já usados (o mesmo código não vale duas vezes).
 */
export function conferirTotp(segredo: string, codigo: string, ultimoPassoUsado: number | null, agoraMs = Date.now()): number | null {
  const limpo = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpo)) return null;
  const atual = passoAtual(agoraMs);
  for (const passo of [atual - 1, atual, atual + 1]) {
    if (ultimoPassoUsado !== null && passo <= ultimoPassoUsado) continue;
    if (codigoTotp(segredo, passo) === limpo) return passo;
  }
  return null;
}

/** Endereço que o app autenticador lê pelo QR code. */
export function uriTotp(emissor: string, conta: string, segredo: string): string {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  return `otpauth://totp/${rotulo}?secret=${segredo}&issuer=${encodeURIComponent(emissor)}&algorithm=SHA1&digits=6&period=${PASSO_SEGUNDOS}`;
}

/** Códigos de recuperação legíveis: 8 caracteres sem letras ambíguas, em dois grupos (ex.: k7mq-2xpd). */
export function novosCodigosRecuperacao(qtd: number): string[] {
  const letras = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: qtd }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => letras[x % letras.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const normalizarCodigoRecuperacao = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
