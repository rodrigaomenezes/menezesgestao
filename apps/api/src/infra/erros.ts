// Erros da aplicação: código estável + mensagem para a pessoa (o que aconteceu e o que fazer).
// A API responde sempre { error: { code, message, details } }.
import type { CodigoErro } from "@mg/shared";

export class ErroApp extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: CodigoErro,
    mensagem: string,
    public readonly detalhes?: Record<string, unknown>,
  ) {
    super(mensagem);
  }
}

export const naoEncontrado = (oQue = "Registro") =>
  new ErroApp(404, "NAO_ENCONTRADO", `${oQue} não encontrado. Ele pode ter sido arquivado ou o link está errado.`);

export const semPermissao = () =>
  new ErroApp(403, "SEM_PERMISSAO", "Seu perfil não tem acesso a esta ação. Se precisar, fale com o administrador da empresa.");

export const naoAutenticado = () => new ErroApp(401, "NAO_AUTENTICADO", "Sua sessão terminou. Entre de novo para continuar.");

export const conflito = (mensagem: string) => new ErroApp(409, "CONFLITO", mensagem);

export const invalido = (mensagem: string, detalhes?: Record<string, unknown>) =>
  new ErroApp(400, "DADOS_INVALIDOS", mensagem, detalhes);

/** Código de erro do PostgreSQL (o Drizzle embrulha o erro original em `cause`). */
export function codigoPg(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
