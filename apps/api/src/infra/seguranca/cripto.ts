import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM para segredos guardados no banco (credenciais de canais, dados sensíveis de jobs).
// Formato: "v1:" + base64(iv[12] | tag[16] | texto cifrado).
export function cifrar(chave: Buffer, texto: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  const corpo = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return `v1:${Buffer.concat([iv, cifra.getAuthTag(), corpo]).toString("base64")}`;
}

export function decifrar(chave: Buffer, valor: string): string {
  if (!valor.startsWith("v1:")) throw new Error("Formato de valor cifrado desconhecido");
  const bruto = Buffer.from(valor.slice(3), "base64");
  const decifra = createDecipheriv("aes-256-gcm", chave, bruto.subarray(0, 12));
  decifra.setAuthTag(bruto.subarray(12, 28));
  return Buffer.concat([decifra.update(bruto.subarray(28)), decifra.final()]).toString("utf8");
}

/** Token aleatório para cookies e links (sessão, convite, recuperação). */
export function novoToken(): string {
  return randomBytes(32).toString("base64url");
}

/** O banco guarda só o HMAC do token: vazar a tabela não entrega sessões nem links válidos. */
export function hashToken(segredo: string, token: string): string {
  return createHmac("sha256", segredo).update(token).digest("hex");
}

export function iguaisSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
