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
/** Quem entra na conta: null = empresa toda; lista = essas pessoas; função = condição sobre a coluna (escopo). */
export type Quem = string[] | null | ((coluna: SQL) => SQL);

function filtroQuem(quem: Quem, coluna: SQL): SQL {
  if (quem === null) return sql``;
  if (typeof quem === "function") return sql`AND ${quem(coluna)}`;
  return sql`AND ${coluna} IN (${sql.join(quem.map((u) => sql`${u}::uuid`), sql`, `)})`;
}
const colunaDe = (id: IndicadorId) => sql.raw(DEFINICOES[id].quem === "ator" ? "ator_id" : "responsavel_id");
const condicaoDe = (id: IndicadorId) => {
  const d = DEFINICOES[id];
  return sql.raw(`tipo = '${d.tipo}'${d.filtro ? ` AND ${d.filtro}` : ""}`);
};
/** Quanto um evento soma no indicador (1 numa contagem). */
const valorDe = (id: IndicadorId) => {
  const d = DEFINICOES[id];
  return sql.raw(d.soma ? `round(coalesce(${d.soma.expr}, 0) / ${d.soma.divisor}, 2)` : "1");
};

export async function calcularIndicadores(
  tx: Tx,
  empresaId: string,
  de: SQL,
  ate: SQL,
  usuarios: Quem,
  porPessoa: boolean,
): Promise<Map<string, Valores>> {
  const resultado = new Map<string, Valores>();
  if (Array.isArray(usuarios) && !usuarios.length) return resultado;
  for (const quem of ["ator", "responsavel"] as const) {
    const ids = IDS_INDICADORES.filter((i) => DEFINICOES[i].quem === quem);
    const coluna = sql.raw(quem === "ator" ? "ator_id" : "responsavel_id");
    const tipos = [...new Set(ids.map((i) => DEFINICOES[i].tipo))];
    const colunas = sql.join(
      ids.map((i) => sql`${agregado(i)} AS ${sql.identifier(i)}`),
      sql`, `,
    );
    const filtroUsuarios = filtroQuem(usuarios, coluna);
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

/** Valor do indicador por dia (no fuso da empresa), com zero nos dias sem ação. */
export async function serieIndicador(
  tx: Tx,
  empresaId: string,
  inicio: string,
  fim: string,
  de: SQL,
  ate: SQL,
  fuso: string,
  id: IndicadorId,
  quem: Quem,
): Promise<{ dia: string; valor: number }[]> {
  const coluna = colunaDe(id);
  const { rows } = await tx.db.execute<{ dia: string; valor: string }>(sql`
    SELECT to_char((criado_em AT TIME ZONE ${fuso})::date, 'YYYY-MM-DD') AS dia, sum(${valorDe(id)}) AS valor
    FROM evento
    WHERE empresa_id = ${empresaId} AND criado_em >= ${de} AND criado_em < ${ate} AND ${condicaoDe(id)}
      AND ${coluna} IS NOT NULL ${filtroQuem(quem, coluna)}
    GROUP BY 1`);
  const porDia = new Map(rows.map((r) => [r.dia, Math.round(Number(r.valor) * 100) / 100]));
  const serie: { dia: string; valor: number }[] = [];
  for (let d = inicio; d <= fim; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    serie.push({ dia: d, valor: porDia.get(d) ?? 0 });
  }
  return serie;
}

/** Quem mais fez no indicador (só quem tem valor), maior primeiro. */
export async function rankingIndicador(
  tx: Tx,
  empresaId: string,
  de: SQL,
  ate: SQL,
  id: IndicadorId,
  quem: Quem,
  limite: number,
): Promise<{ usuarioId: string; nome: string; valor: number }[]> {
  const coluna = colunaDe(id);
  // Condição e valor calculados dentro da subconsulta: "tipo" e "dados" ali são só do evento.
  const { rows } = await tx.db.execute<{ usuario_id: string; nome: string; valor: string }>(sql`
    SELECT ev.usuario_id, u.nome, ev.valor
    FROM (
      SELECT ${coluna} AS usuario_id, sum(${valorDe(id)}) AS valor
      FROM evento
      WHERE empresa_id = ${empresaId} AND criado_em >= ${de} AND criado_em < ${ate} AND ${condicaoDe(id)}
        AND ${coluna} IS NOT NULL ${filtroQuem(quem, coluna)}
      GROUP BY 1
    ) ev JOIN usuario u ON u.id = ev.usuario_id
    ORDER BY ev.valor DESC, u.nome
    LIMIT ${limite}`);
  return rows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, valor: Math.round(Number(r.valor) * 100) / 100 }));
}

export interface LinhaEventoIndicador {
  id: string;
  criadoEm: Date;
  tipo: string;
  entidade: string;
  entidadeId: string | null;
  usuarioId: string | null;
  usuarioNome: string | null;
  contatoId: string | null;
  contatoNome: string | null;
  dados: Record<string, unknown>;
  valor: number;
}

/** As ações que entraram na conta do indicador (mais recentes primeiro), paginadas por (criado_em, id). */
export async function eventosIndicador(
  tx: Tx,
  empresaId: string,
  de: SQL,
  ate: SQL,
  id: IndicadorId,
  quem: Quem,
  cursor: { criadoEm: string; id: string } | null,
  limite: number,
): Promise<LinhaEventoIndicador[]> {
  const coluna = colunaDe(id);
  const { rows } = await tx.db.execute<{
    id: string;
    criado_em: string | Date;
    tipo: string;
    entidade: string;
    entidade_id: string | null;
    usuario_id: string | null;
    usuario_nome: string | null;
    contato_id: string | null;
    contato_nome: string | null;
    dados: Record<string, unknown>;
    valor: string;
  }>(sql`
    SELECT ev.*, u.nome AS usuario_nome, c.nome AS contato_nome
    FROM (
      SELECT id, criado_em, tipo, entidade, entidade_id, ${coluna} AS usuario_id, contato_id, empresa_id, dados, ${valorDe(id)} AS valor
      FROM evento
      WHERE empresa_id = ${empresaId} AND criado_em >= ${de} AND criado_em < ${ate} AND ${condicaoDe(id)}
        AND ${coluna} IS NOT NULL ${filtroQuem(quem, coluna)}
        ${cursor ? sql`AND (criado_em, id) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : sql``}
      ORDER BY criado_em DESC, id DESC
      LIMIT ${limite + 1}
    ) ev
    LEFT JOIN usuario u ON u.id = ev.usuario_id
    LEFT JOIN contato c ON c.id = ev.contato_id AND c.empresa_id = ev.empresa_id
    ORDER BY ev.criado_em DESC, ev.id DESC`);
  return rows.map((r) => ({
    id: r.id,
    criadoEm: new Date(r.criado_em),
    tipo: r.tipo,
    entidade: r.entidade,
    entidadeId: r.entidade_id,
    usuarioId: r.usuario_id,
    usuarioNome: r.usuario_nome,
    contatoId: r.contato_id,
    contatoNome: r.contato_nome,
    dados: r.dados ?? {},
    valor: Number(r.valor),
  }));
}

