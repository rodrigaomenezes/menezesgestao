// Cliente da API: mesmo domínio, cookie de sessão HttpOnly e cabeçalho de CSRF em toda escrita.

import type { CodigoErro, RespostaErro } from "@mg/shared";

/** Erro da API no formato padrão { error: { code, message, details } }. */
export class ErroApi extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: CodigoErro | "SEM_CONEXAO",
    mensagem: string,
  ) {
    super(mensagem);
  }
}

function tokenCsrf(): string {
  const par = document.cookie.split("; ").find((c) => c.startsWith("mg_csrf="));
  return par ? decodeURIComponent(par.slice("mg_csrf=".length)) : "";
}

type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function api<T>(metodo: Metodo, caminho: string, corpo?: unknown): Promise<T> {
  const escrita = metodo !== "GET";
  // Arquivo vai como multipart (o navegador monta o boundary); o resto, como JSON.
  const arquivo = corpo instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: "same-origin",
      headers: escrita ? { ...(arquivo ? {} : { "content-type": "application/json" }), "x-csrf-token": tokenCsrf() } : {},
      body: escrita ? (arquivo ? corpo : JSON.stringify(corpo ?? {})) : undefined,
    });
  } catch {
    throw new ErroApi(0, "SEM_CONEXAO", "Sem conexão com o servidor. Confira a internet e tente de novo.");
  }
  const dados = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const erro = (dados as Partial<RespostaErro> | null)?.error;
    throw new ErroApi(res.status, erro?.code ?? "ERRO_INTERNO", erro?.message ?? "Não foi possível concluir. Tente de novo em instantes.");
  }
  return dados as T;
}

export const get = <T,>(caminho: string) => api<T>("GET", caminho);
export const post = <T,>(caminho: string, corpo?: unknown) => api<T>("POST", caminho, corpo);
export const patch = <T,>(caminho: string, corpo?: unknown) => api<T>("PATCH", caminho, corpo);
export const put = <T,>(caminho: string, corpo?: unknown) => api<T>("PUT", caminho, corpo);
export const del = <T,>(caminho: string) => api<T>("DELETE", caminho);

/** Envia um arquivo (campo "arquivo") por multipart/form-data. */
export function enviarArquivo<T>(caminho: string, arquivo: File, campos: Record<string, string> = {}): Promise<T> {
  const dados = new FormData();
  for (const [nome, valor] of Object.entries(campos)) dados.append(nome, valor);
  dados.append("arquivo", arquivo);
  return api<T>("POST", caminho, dados);
}

export type { Pagina } from "@mg/shared";

/** Monta a query string ignorando valores vazios. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
