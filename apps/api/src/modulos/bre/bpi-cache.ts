// Invalidação do BPI guardado (bre_bpi). Arquivo leve de propósito: vendas e funil chamam isto sem carregar o motor
// BRE inteiro (IA, filas). A próxima leitura do BPI recalcula.
import type { Tx } from "../../infra/banco.js";

export async function marcarBpiVelho(tx: Tx): Promise<void> {
  await tx.cliente.query("UPDATE bre_bpi SET calculado_em = '-infinity' WHERE empresa_id = $1", [tx.empresaId]);
}
