// Logs estruturados (uma linha JSON por fato), sem dados pessoais: só tipos, ids e códigos.
// Os eventos de negócio saem depois do COMMIT (o que foi desfeito não aparece no log).

const testes = process.env.NODE_ENV === "test" && process.env.LOG_TESTE !== "1";

export interface LinhaLog {
  level: "info" | "warn" | "error";
  event: string;
  [campo: string]: unknown;
}

export function registrarLog(linha: LinhaLog): void {
  if (testes) return;
  const texto = JSON.stringify({ time: new Date().toISOString(), ...linha });
  if (linha.level === "error") console.error(texto);
  else if (linha.level === "warn") console.warn(texto);
  else console.info(texto);
}

/** Evento de negócio publicado: quem (id), o quê (tipo), onde (empresa) — nunca o conteúdo (`dados`). */
export function logEvento(e: { id: string; empresaId: string; tipo: string; atorId: string | null; entidade: string; entidadeId: string | null }): void {
  registrarLog({ level: "info", event: "negocio", tipo: e.tipo, eventoId: e.id, empresaId: e.empresaId, atorId: e.atorId, entidade: e.entidade, entidadeId: e.entidadeId });
}

/**
 * Erro inesperado sem dados pessoais. O PostgreSQL põe valores em `detail` ("Key (telefone)=(+55…)") e o
 * Drizzle repete a consulta com os parâmetros na mensagem: nada disso vai para o log.
 */
export function erroSeguro(err: unknown): Record<string, unknown> {
  const e = err as { name?: string; message?: string; code?: string; stack?: string; table?: string; constraint?: string; column?: string; cause?: unknown };
  const pg = (e?.cause && typeof e.cause === "object" ? e.cause : e) as { code?: string; table?: string; constraint?: string; column?: string; routine?: string; message?: string };
  const ehBanco = typeof pg?.code === "string" && /^[0-9A-Z]{5}$/.test(pg.code);
  if (ehBanco) {
    return {
      tipo: "banco",
      codigo: pg.code,
      tabela: pg.table ?? null,
      restricao: pg.constraint ?? null,
      coluna: pg.column ?? null,
      // A mensagem do PostgreSQL nomeia o problema sem os valores (o valor fica em `detail`, que é descartado).
      mensagem: (pg.message ?? "").replace(/"[^"]*"\s*$/, '"[oculto]"').slice(0, 200),
    };
  }
  const mensagem = (e?.message ?? String(err)).split("\n")[0];
  return {
    tipo: e?.name ?? "Error",
    // "Failed query: … params: …" é do Drizzle: corta antes dos parâmetros.
    mensagem: mensagem.replace(/\bparams:.*$/s, "params: [ocultos]").slice(0, 300),
    pilha: e?.stack?.split("\n").slice(1, 8).join("\n"),
  };
}
