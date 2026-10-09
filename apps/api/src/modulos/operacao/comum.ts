// Peças comuns da operação: pessoas visíveis pelo escopo (paginadas), "quem gerencia quem" e períodos no fuso
// da empresa.
import { and, eq, isNull, sql } from "drizzle-orm";
import { FUSO_PADRAO, type Escopo, type PeriodoId } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { usuario, vinculo } from "../../infra/esquema.js";
import { invalido, semPermissao } from "../../infra/erros.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis, usuariosVisiveis } from "../acesso/escopo.js";

export const fusoDe = (ctx: { fuso: string | null }) => ctx.fuso ?? FUSO_PADRAO;

/** Hoje (AAAA-MM-DD) no fuso da empresa. */
export function hojeNoFuso(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Primeiro e último dia do período que contém `dia` (semana começa na segunda). */
export function limitesPeriodo(periodo: PeriodoId, dia: string): { inicio: string; fim: string } {
  if (periodo === "dia") return { inicio: dia, fim: dia };
  if (periodo === "semana") {
    const dow = new Date(`${dia}T00:00:00Z`).getUTCDay(); // 0 = domingo
    const inicio = somarDias(dia, -((dow + 6) % 7));
    return { inicio, fim: somarDias(inicio, 6) };
  }
  const inicio = `${dia.slice(0, 7)}-01`;
  const d = new Date(`${inicio}T00:00:00Z`);
  const proximo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { inicio, fim: somarDias(proximo.toISOString().slice(0, 10), -1) };
}

/** Instantes [de, ate) que cobrem os dias inicio..fim no fuso. */
export function instantesDoPeriodo(inicio: string, fim: string, fuso: string) {
  return {
    de: sql`(${inicio}::date::timestamp AT TIME ZONE ${fuso})`,
    ate: sql`((${fim}::date + 1)::timestamp AT TIME ZONE ${fuso})`,
  };
}

export { somarDias };

export interface Pessoa {
  id: string;
  nome: string;
}

/** Pessoas ativas que o escopo enxerga, por nome (paginadas). */
export async function pessoasVisiveis(
  tx: Tx,
  ctx: ContextoEmpresa,
  escopo: Escopo,
  f: { equipeId?: string; cursor?: string; limite: number },
): Promise<{ pessoas: Pessoa[]; proximoCursor: string | null }> {
  let cursor: [string, string] | null = null;
  if (f.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(f.cursor, "base64url").toString("utf8")) as [string, string];
    } catch {
      throw invalido("O marcador de página é inválido. Volte ao início da lista.");
    }
  }
  const linhas = await tx.db
    .select({ id: usuario.id, nome: usuario.nome })
    .from(vinculo)
    .innerJoin(usuario, eq(usuario.id, vinculo.usuarioId))
    .where(
      and(
        eq(vinculo.empresaId, ctx.empresaId),
        eq(vinculo.status, "ativo"),
        isNull(vinculo.arquivadoEm),
        filtroUsuariosVisiveis(ctx, escopo, vinculo.usuarioId),
        f.equipeId ? eq(vinculo.equipeId, f.equipeId) : undefined,
        cursor ? sql`(${usuario.nome}, ${usuario.id}) > (${cursor[0]}, ${cursor[1]}::uuid)` : undefined,
      ),
    )
    .orderBy(usuario.nome, usuario.id)
    .limit(f.limite + 1);
  const temMais = linhas.length > f.limite;
  const pessoas = linhas.slice(0, f.limite);
  const ultima = pessoas[pessoas.length - 1];
  return {
    pessoas,
    proximoCursor: temMais && ultima ? Buffer.from(JSON.stringify([ultima.nome, ultima.id])).toString("base64url") : null,
  };
}

/** A pessoa-alvo está ativa na empresa e dentro do escopo de quem pede (a própria pessoa sempre está). */
export async function exigirPessoa(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, alvo: string | null | undefined): Promise<string> {
  const id = alvo ?? ctx.usuarioId;
  if (id !== ctx.usuarioId) {
    const visiveis = await usuariosVisiveis(tx, ctx, escopo);
    if (visiveis !== "todos" && !visiveis.has(id)) throw semPermissao();
  }
  const [v] = await tx.db
    .select({ id: vinculo.id })
    .from(vinculo)
    .where(and(eq(vinculo.empresaId, ctx.empresaId), eq(vinculo.usuarioId, id), eq(vinculo.status, "ativo"), isNull(vinculo.arquivadoEm)));
  if (!v) throw invalido("Essa pessoa não está ativa na empresa.");
  return id;
}

/** Gerenciar (validar horas, montar escala) é para quem enxerga além de si — e nunca sobre si mesmo. */
export async function exigirGestao(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, alvo: string): Promise<void> {
  if (escopo === "proprio") throw semPermissao();
  await exigirPessoa(tx, ctx, escopo, alvo);
}
