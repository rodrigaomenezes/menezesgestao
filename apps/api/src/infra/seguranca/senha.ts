import { hash, verify } from "@node-rs/argon2";

export { SENHA_MAXIMO, SENHA_MINIMO } from "@mg/shared";

// Argon2id é o algoritmo padrão do @node-rs/argon2.
export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha);
}

export async function conferirSenha(hashGuardado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, senha);
  } catch {
    return false;
  }
}

// Usado quando o e-mail não existe, para o tempo de resposta não revelar quem tem cadastro.
let hashFicticio: Promise<string> | null = null;
export function hashParaComparacaoFicticia(): Promise<string> {
  hashFicticio ??= hash("senha-ficticia-para-igualar-tempo");
  return hashFicticio;
}

/** Bloqueio progressivo: a partir da 5ª falha, 1, 2, 4… minutos, no máximo 60. */
export function minutosDeBloqueio(tentativasFalhas: number): number {
  if (tentativasFalhas < 5) return 0;
  return Math.min(2 ** (tentativasFalhas - 5), 60);
}
