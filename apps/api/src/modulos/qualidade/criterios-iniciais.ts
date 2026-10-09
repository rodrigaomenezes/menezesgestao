// Critérios iniciais do monitoramento de qualidade (a empresa edita depois).
import type { Tx } from "../../infra/banco.js";
import { criterioQualidade } from "../../infra/esquema.js";

const CRITERIOS: [string, number][] = [
  ["Abertura e apresentação", 1],
  ["Entendeu a necessidade", 2],
  ["Apresentou a solução", 2],
  ["Tratou objeções", 2],
  ["Próximo passo combinado", 1],
];

export async function criarCriteriosQualidade(tx: Tx, empresaId: string): Promise<void> {
  await tx.db.insert(criterioQualidade).values(CRITERIOS.map(([nome, peso], i) => ({ empresaId, nome, peso, ordem: i * 10 })));
}
