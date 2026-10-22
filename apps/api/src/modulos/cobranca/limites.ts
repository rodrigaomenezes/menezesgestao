// Limites do plano (pessoas, canais, armazenamento). Conferidos no servidor, na mesma transação que cria o recurso;
// passar do limite nunca apaga nada: só impede acrescentar (trocar para um plano menor também não apaga).
import { NOMES_RECURSOS_PLANO, RECURSOS_PLANO, limitesDoPlano, type RecursoPlano, type UsoPlanoDto } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { ErroApp } from "../../infra/erros.js";

const MB = 1024 * 1024;

/** Uso atual da empresa (uma consulta, índices por empresa). */
export async function usoDaEmpresa(tx: Tx, empresaId: string): Promise<{ plano: string; uso: Record<RecursoPlano, number> }> {
  const { rows } = await tx.cliente.query<{ plano: string; usuarios: number; canais: number; armazenamento: string }>(
    `SELECT e.plano,
            (SELECT count(*)::int FROM vinculo v WHERE v.empresa_id = e.id AND v.arquivado_em IS NULL) AS usuarios,
            (SELECT count(*)::int FROM canal c WHERE c.empresa_id = e.id AND c.arquivado_em IS NULL) AS canais,
            (SELECT coalesce(sum(a.tamanho), 0) FROM arquivo a WHERE a.empresa_id = e.id AND a.arquivado_em IS NULL) AS armazenamento
       FROM empresa e WHERE e.id = $1`,
    [empresaId],
  );
  const l = rows[0];
  return { plano: l?.plano ?? "sob_medida", uso: { usuarios: l?.usuarios ?? 0, canais: l?.canais ?? 0, armazenamento: Number(l?.armazenamento ?? 0) } };
}

export async function usoDoPlano(tx: Tx, empresaId: string): Promise<UsoPlanoDto[]> {
  const { plano, uso } = await usoDaEmpresa(tx, empresaId);
  const limites = limitesDoPlano(plano);
  return RECURSOS_PLANO.map((recurso) => ({ recurso, usado: uso[recurso], limite: limites?.[recurso] ?? null }));
}

const formatar = (recurso: RecursoPlano, n: number) => (recurso === "armazenamento" ? `${Math.round(n / MB).toLocaleString("pt-BR")} MB` : String(n));

/** Recusa acrescentar `quanto` ao recurso se passar do limite do plano. Sem limite (sob medida): sempre passa. */
export async function exigirLimite(tx: Tx, empresaId: string, recurso: RecursoPlano, quanto = 1): Promise<void> {
  // Trava a empresa até o fim da transação: dois cadastros ao mesmo tempo não passam juntos do limite.
  await tx.cliente.query("SELECT 1 FROM empresa WHERE id = $1 FOR UPDATE", [empresaId]);
  const { plano, uso } = await usoDaEmpresa(tx, empresaId);
  const limite = limitesDoPlano(plano)?.[recurso];
  if (limite === undefined || uso[recurso] + quanto <= limite) return;
  throw new ErroApp(
    409,
    "LIMITE_DO_PLANO",
    `${NOMES_RECURSOS_PLANO[recurso]}: o plano da empresa permite ${formatar(recurso, limite)} e já está em ${formatar(recurso, uso[recurso])}. Quem administra pode trocar de plano em “Plano e cobrança”.`,
    { recurso, limite, usado: uso[recurso] },
  );
}
