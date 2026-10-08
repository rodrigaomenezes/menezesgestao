// Erros com mensagem para a pessoa: o que aconteceu e o que ela pode fazer.

export class ErroHttp extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export const naoEncontrado = (oQue = "Registro") =>
  new ErroHttp(404, `${oQue} não encontrado. Ele pode ter sido arquivado ou o link está errado.`);

export const semPermissao = () =>
  new ErroHttp(403, "Seu perfil não tem acesso a esta ação. Se precisar, fale com o administrador da empresa.");

export const sessaoExpirada = () => new ErroHttp(401, "Sua sessão terminou. Entre de novo para continuar.");

export const conflito = (mensagem: string) => new ErroHttp(409, mensagem);

export const invalido = (mensagem: string) => new ErroHttp(400, mensagem);
