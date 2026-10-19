// Vocabulário da empresa no servidor: para textos gravados fora de uma requisição (avisos, automações, importação).
// Na resposta de erro, o tratador do app já aplica o vocabulário de quem pediu.
import { eq } from "drizzle-orm";
import type { Vocabulario } from "@mg/shared";
import { empresa } from "../../infra/esquema.js";
import type { Tx } from "../../infra/banco.js";

export async function vocabularioDa(tx: Tx, empresaId: string): Promise<Vocabulario> {
  const [e] = await tx.db.select({ vocabulario: empresa.vocabulario }).from(empresa).where(eq(empresa.id, empresaId));
  return Object.fromEntries(Object.entries((e?.vocabulario ?? {}) as Record<string, unknown>).filter((x): x is [string, string] => typeof x[1] === "string"));
}
