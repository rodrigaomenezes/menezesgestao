// Cliente da API: mesmo domínio, cookie de sessão HttpOnly e cabeçalho de CSRF em toda escrita.

export class ErroApi extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

function tokenCsrf(): string {
  const par = document.cookie.split("; ").find((c) => c.startsWith("mg_csrf="));
  return par ? decodeURIComponent(par.slice("mg_csrf=".length)) : "";
}

type Metodo = "GET" | "POST" | "PATCH" | "DELETE";

export async function api<T>(metodo: Metodo, caminho: string, corpo?: unknown): Promise<T> {
  const escrita = metodo !== "GET";
  let res: Response;
  try {
    res = await fetch(`/api${caminho}`, {
      method: metodo,
      credentials: "same-origin",
      headers: escrita ? { "content-type": "application/json", "x-csrf-token": tokenCsrf() } : {},
      body: escrita ? JSON.stringify(corpo ?? {}) : undefined,
    });
  } catch {
    throw new ErroApi(0, "Sem conexão com o servidor. Confira a internet e tente de novo.");
  }
  const dados = (await res.json().catch(() => null)) as { erro?: string } | null;
  if (!res.ok) {
    throw new ErroApi(res.status, dados?.erro ?? "Não foi possível concluir. Tente de novo em instantes.");
  }
  return dados as T;
}

export const get = <T,>(caminho: string) => api<T>("GET", caminho);
export const post = <T,>(caminho: string, corpo?: unknown) => api<T>("POST", caminho, corpo);
export const patch = <T,>(caminho: string, corpo?: unknown) => api<T>("PATCH", caminho, corpo);
export const del = <T,>(caminho: string) => api<T>("DELETE", caminho);

export interface Pagina<T> {
  itens: T[];
  proximoCursor: string | null;
}

/** Monta a query string ignorando valores vazios. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}
