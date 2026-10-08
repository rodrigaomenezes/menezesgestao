// Listas iniciais da telefonia e da fila (a empresa edita depois): resultados de ligação e tipos de base.
import type { Tx } from "../../infra/banco.js";
import { resultadoLigacao, tipoBase, type AcaoResultado } from "../../infra/esquema.js";

const RESULTADOS: [string, AcaoResultado, number | null, boolean][] = [
  ["Atendeu — conversa feita", "encerrar", null, true],
  ["Não atendeu", "reagendar", 4, false],
  ["Caixa postal", "reagendar", 24, false],
  ["Retornar em…", "reagendar", null, true],
  ["Número errado", "descartar", null, false],
  ["Sem interesse", "encerrar", null, true],
  ["Convertido", "converter", null, true],
];

export async function criarListasTelefonia(tx: Tx, empresaId: string): Promise<void> {
  await tx.db.insert(resultadoLigacao).values(RESULTADOS.map(([nome, acao, horas, atendida], i) => ({ empresaId, nome, acao, horas, atendida, ordem: i * 10 })));
  await tx.db.insert(tipoBase).values(["Leads novos", "Ex-clientes", "Indicações"].map((nome) => ({ empresaId, nome })));
}
