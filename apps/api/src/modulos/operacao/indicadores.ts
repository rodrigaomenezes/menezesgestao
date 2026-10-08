// Indicadores de desempenho: SEMPRE contados da tabela evento (somente inserção). Nenhum número é digitado ou
// guardado à parte — se a ação não gerou evento, ela não conta (e se gerou, conta do mesmo jeito para todos).
import { sql, type SQL } from "drizzle-orm";
import { IDS_INDICADORES, type IndicadorId } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";

interface Definicao {
  tipo: string;
  /** Quem recebe o crédito: quem fez (ator) ou o dono do registro (responsável — ex.: venda é do vendedor). */
  quem: "ator" | "responsavel";
  /** Condição extra sobre o evento (constante do código, nunca entrada do usuário). */
  filtro?: string;
  /** Sem soma = contagem. */
  soma?: { expr: string; divisor: number };
}

export const DEFINICOES: Record<IndicadorId, Definicao> = {
  ligacoes: { tipo: "ligacao.encerrada", quem: "ator" },
  ligacoes_atendidas: { tipo: "ligacao.encerrada", quem: "ator", filtro: "(dados->>'atendida')::boolean" },
  minutos_ligacao: { tipo: "ligacao.encerrada", quem: "ator", soma: { expr: "(dados->>'duracaoSegundos')::numeric", divisor: 60 } },
  mensagens: { tipo: "mensagem.criada", quem: "ator" },
  conversas_resolvidas: { tipo: "conversa.resolvida", quem: "ator" },
  // Contatos de planilha importada não contam como cadastro feito à mão.
  contatos_novos: { tipo: "contato.criado", quem: "ator", filtro: "NOT (dados ? 'importacaoId')" },
  oportunidades_criadas: { tipo: "oportunidade.criada", quem: "ator" },
  vendas: { tipo: "oportunidade.ganha", quem: "responsavel" },
  valor_vendido: { tipo: "oportunidade.ganha", quem: "responsavel", soma: { expr: "(dados->>'valorCentavos')::numeric", divisor: 100 } },
  tarefas_concluidas: { tipo: "tarefa.concluida", quem: "ator" },
  resultados_fila: { tipo: "fila.resultado_registrado", quem: "ator" },
};

function agregado(id: IndicadorId): SQL {
  const d = DEFINICOES[id];
  const condicao = `tipo = '${d.tipo}'${d.filtro ? ` AND ${d.filtro}` : ""}`;
  if (!d.soma) return sql.raw(`count(*) FILTER (WHERE ${condicao})`);
  return sql.raw(`round(coalesce(sum(${d.soma.expr}) FILTER (WHERE ${condicao}), 0) / ${d.soma.divisor}, 2)`);
}

export type Valores = Record<IndicadorId, number>;
export const zerados = (): Valores => Object.fromEntries(IDS_INDICADORES.map((i) => [i, 0])) as Valores;

/**
 * Soma os indicadores no intervalo [de, ate).
 * `usuarios` = null soma a empresa toda; com lista, só essas pessoas.
 * `porPessoa` devolve um valor por pessoa; senão, a chave "total".
 */
export async function calcularIndicadores(
  tx: Tx,
  empresaId: string,
  de: SQL,
  ate: SQL,
  usuarios: string[] | null,
  porPessoa: boolean,
): Promise<Map<string, Valores>> {
  const resultado = new Map<string, Valores>();
  if (usuarios && !usuarios.length) return resultado;
  for (const quem of ["ator", "responsavel"] as const) {
    const ids = IDS_INDICADORES.filter((i) => DEFINICOES[i].quem === quem);
    const coluna = sql.raw(quem === "ator" ? "ator_id" : "responsavel_id");
    const tipos = [...new Set(ids.map((i) => DEFINICOES[i].tipo))];
    const colunas = sql.join(
      ids.map((i) => sql`${agregado(i)} AS ${sql.identifier(i)}`),
      sql`, `,
    );
    const filtroUsuarios = usuarios ? sql`AND ${coluna} IN (${sql.join(usuarios.map((u) => sql`${u}::uuid`), sql`, `)})` : sql``;
    const chave = porPessoa ? sql`${coluna}::text` : sql`'total'`;
    const { rows } = await tx.db.execute<Record<string, string | number>>(sql`
      SELECT ${chave} AS chave, ${colunas}
      FROM evento
      WHERE empresa_id = ${empresaId} AND criado_em >= ${de} AND criado_em < ${ate}
        AND tipo IN (${sql.join(tipos.map((t) => sql`${t}`), sql`, `)})
        AND ${coluna} IS NOT NULL ${filtroUsuarios}
      GROUP BY 1`);
    for (const r of rows) {
      const k = String(r.chave);
      const atual = resultado.get(k) ?? zerados();
      for (const i of ids) atual[i] = Number(r[i] ?? 0);
      resultado.set(k, atual);
    }
  }
  return resultado;
}
