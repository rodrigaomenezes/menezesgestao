// Consultas de duplicados e fusão (sempre dentro de comEmpresa; RLS por empresa em todas as tabelas).
import { sql } from "drizzle-orm";
import type { Escopo } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { filtroUsuariosVisiveis, type QuemVe } from "../acesso/escopo.js";

/**
 * Onde um contato aparece fora do cadastro, e o que a fusão faz em cada tabela. `conflito` é a condição do índice
 * único da tabela: a linha da origem que bateria com uma do destino não muda (fica no cadastro arquivado, nada some).
 */
export const TRANSFERENCIAS: readonly { tabela: string; nome: string; conflito?: string }[] = [
  { tabela: "oportunidade", nome: "oportunidades" },
  { tabela: "tarefa", nome: "tarefas" },
  { tabela: "nota", nome: "notas" },
  { tabela: "conversa", nome: "conversas" },
  { tabela: "ligacao", nome: "ligacoes" },
  { tabela: "compromisso", nome: "compromissos" },
  { tabela: "venda", nome: "vendas" },
  { tabela: "analise_bre", nome: "analisesBre" },
  { tabela: "break_bre", nome: "breaksBre" },
  { tabela: "reentrada", nome: "reentradas" },
  { tabela: "registro_bre", nome: "registrosBre" },
  { tabela: "fila_item", nome: "filas", conflito: "x.fila_id = t.fila_id" },
  { tabela: "entrega_participante", nome: "entregas", conflito: "x.entrega_id = t.entrega_id AND x.status = 'ativo' AND t.status = 'ativo'" },
  { tabela: "ciclo_contato", nome: "ciclosBre", conflito: "x.encerrado_em IS NULL AND t.encerrado_em IS NULL" },
  { tabela: "escalonamento", nome: "escalonamentos", conflito: "x.situacao = t.situacao AND x.status = 'aberto' AND t.status = 'aberto'" },
];
/**
 * Tabelas com `contato_id` que a fusão trata à parte (canais, endereços, etiquetas) ou não muda: `evento` e
 * `bre_automacao_execucao` são somente inserção — o histórico do destino lê também os eventos dos fundidos nele.
 * Um teste confere que toda coluna `contato_id` do banco está aqui ou em TRANSFERENCIAS.
 */
export const TRATADAS_A_PARTE = ["contato_canal", "contato_endereco", "contato_etiqueta", "evento", "bre_automacao_execucao"] as const;

export async function transferir(tx: Tx, empresaId: string, origemId: string, destinoId: string): Promise<Record<string, number>> {
  const movidos: Record<string, number> = {};
  for (const { tabela, nome, conflito } of TRANSFERENCIAS) {
    const r = await tx.cliente.query(
      `UPDATE ${tabela} t SET contato_id = $3 WHERE t.empresa_id = $1 AND t.contato_id = $2${
        conflito ? ` AND NOT EXISTS (SELECT 1 FROM ${tabela} x WHERE x.empresa_id = $1 AND x.contato_id = $3 AND ${conflito})` : ""
      }`,
      [empresaId, origemId, destinoId],
    );
    if (r.rowCount) movidos[nome] = r.rowCount;
  }
  // Pessoas ligadas à origem como empresa passam para o destino (o destino nunca é a própria empresa).
  const pessoas = await tx.cliente.query(
    "UPDATE contato SET organizacao_id = CASE WHEN id = $3 THEN NULL ELSE $3::uuid END, atualizado_em = now() WHERE empresa_id = $1 AND organizacao_id = $2",
    [empresaId, origemId, destinoId],
  );
  if (pessoas.rowCount) movidos.pessoasDaEmpresa = pessoas.rowCount;
  return movidos;
}

/** As duas linhas travadas até o fim da transação, na mesma ordem para qualquer par (sem trava cruzada). */
export async function travarContatos(tx: Tx, empresaId: string, ids: string[]) {
  await tx.cliente.query("SELECT id FROM contato WHERE empresa_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE", [empresaId, ids]);
}

/** O documento inteiro da origem (cifrado, hash, final e tipo), para passar ao destino sem decifrar. */
export async function colunasDocumento(tx: Tx, empresaId: string, id: string) {
  const { rows } = await tx.cliente.query<{ documentoTipo: "cpf" | "cnpj" | null; documentoFinal: string | null; documentoCifrado: string | null; documentoHash: string | null }>(
    `SELECT documento_tipo AS "documentoTipo", documento_final AS "documentoFinal", documento_cifrado AS "documentoCifrado", documento_hash AS "documentoHash"
       FROM contato WHERE empresa_id = $1 AND id = $2`,
    [empresaId, id],
  );
  return rows[0]!;
}

/** Canais da origem: telefones vão todos (já são únicos); e-mail que o destino já tem é arquivado. */
export async function moverCanais(tx: Tx, empresaId: string, origemId: string, destinoId: string, emailsDoDestino: string[]) {
  const arquivados = await tx.cliente.query(
    `UPDATE contato_canal SET arquivado_em = now()
      WHERE empresa_id = $1 AND contato_id = $2 AND arquivado_em IS NULL AND tipo = 'email'
        AND (valor = ANY($3::text[]) OR EXISTS (SELECT 1 FROM contato_canal x WHERE x.contato_id = $4 AND x.arquivado_em IS NULL AND x.tipo = 'email' AND x.valor = contato_canal.valor))`,
    [empresaId, origemId, emailsDoDestino, destinoId],
  );
  const movidos = await tx.cliente.query("UPDATE contato_canal SET contato_id = $3 WHERE empresa_id = $1 AND contato_id = $2 AND arquivado_em IS NULL", [empresaId, origemId, destinoId]);
  return { movidos: movidos.rowCount ?? 0, repetidos: arquivados.rowCount ?? 0 };
}

/** Endereços da origem: vão todos; se o destino já tem principal, chegam sem a marca. */
export async function moverEnderecos(tx: Tx, empresaId: string, origemId: string, destinoId: string) {
  const r = await tx.cliente.query(
    `UPDATE contato_endereco SET contato_id = $3, atualizado_em = now(),
            principal = principal AND NOT EXISTS (SELECT 1 FROM contato_endereco x WHERE x.contato_id = $3 AND x.principal AND x.arquivado_em IS NULL)
      WHERE empresa_id = $1 AND contato_id = $2 AND arquivado_em IS NULL`,
    [empresaId, origemId, destinoId],
  );
  return r.rowCount ?? 0;
}

/** Etiquetas da origem somam às do destino (as da origem ficam também no cadastro arquivado). */
export async function somarEtiquetas(tx: Tx, empresaId: string, origemId: string, destinoId: string) {
  const r = await tx.cliente.query(
    `INSERT INTO contato_etiqueta (empresa_id, contato_id, etiqueta_id)
     SELECT empresa_id, $3, etiqueta_id FROM contato_etiqueta WHERE empresa_id = $1 AND contato_id = $2
     ON CONFLICT DO NOTHING`,
    [empresaId, origemId, destinoId],
  );
  return r.rowCount ?? 0;
}

/** O contato e os que foram fundidos nele, em cadeia (A → B → C: o histórico de C mostra os três). */
export async function comFundidos(tx: Tx, empresaId: string, id: string): Promise<string[]> {
  const { rows } = await tx.cliente.query<{ id: string }>(
    `WITH RECURSIVE f AS (
       SELECT id FROM contato WHERE empresa_id = $1 AND id = $2
       UNION SELECT c.id FROM contato c JOIN f ON c.fundido_em_id = f.id WHERE c.empresa_id = $1
     ) SELECT id FROM f`,
    [empresaId, id],
  );
  return rows.map((r) => r.id);
}

export interface LinhaPar {
  a: string;
  b: string;
  motivos: ("email" | "nome")[];
}

/**
 * Pares de possíveis duplicados entre os contatos ativos que a pessoa vê: mesmo e-mail (principal ou extra, sem
 * diferença de maiúsculas) ou mesmo nome (sem diferença de maiúsculas e espaços). Fora os pares marcados como "não é
 * duplicado". Em ordem estável (a, b), paginado pelo par.
 */
export async function pares(tx: Tx, empresaId: string, quem: QuemVe, escopo: Escopo, depois: { a: string; b: string } | null, limite: number): Promise<LinhaPar[]> {
  const { rows } = await tx.db.execute<{ a: string; b: string; motivos: string[] | string }>(
    sql`WITH ativos AS (
          SELECT c.id, c.nome, c.email FROM contato c
           WHERE c.empresa_id = ${empresaId} AND c.arquivado_em IS NULL AND c.anonimizado_em IS NULL AND ${filtroUsuariosVisiveis(quem, escopo, sql`c.responsavel_id`)}
        ),
        chaves AS (
          SELECT id, 'nome' AS motivo, lower(regexp_replace(trim(nome), '\\s+', ' ', 'g')) AS chave FROM ativos
          UNION SELECT id, 'email', lower(email) FROM ativos WHERE email IS NOT NULL
          UNION SELECT cc.contato_id, 'email', cc.valor FROM contato_canal cc JOIN ativos av ON av.id = cc.contato_id
           WHERE cc.tipo = 'email' AND cc.arquivado_em IS NULL
        )
        SELECT x.id AS a, y.id AS b, array_agg(DISTINCT x.motivo ORDER BY x.motivo) AS motivos
          FROM chaves x JOIN chaves y ON y.chave = x.chave AND y.motivo = x.motivo AND x.id < y.id
         WHERE NOT EXISTS (SELECT 1 FROM contato_par_ignorado i WHERE i.contato_a = x.id AND i.contato_b = y.id)
           ${depois ? sql`AND (x.id, y.id) > (${depois.a}::uuid, ${depois.b}::uuid)` : sql``}
         GROUP BY x.id, y.id
         ORDER BY x.id, y.id
         LIMIT ${limite + 1}`,
  );
  // array_agg de text chega como lista (ou como literal "{a,b}" em drivers sem o tipo registrado).
  return rows.map((r) => ({ a: r.a, b: r.b, motivos: (Array.isArray(r.motivos) ? r.motivos : r.motivos.replace(/[{}]/g, "").split(",")) as LinhaPar["motivos"] }));
}
