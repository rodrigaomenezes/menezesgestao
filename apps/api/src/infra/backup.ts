// Conferência de backup: um retrato do banco (migrações, segurança por empresa e contagens) para comparar
// a cópia restaurada com a original. Os backups diários são do Railway (ADR-028); isto prova que voltam.
import type pg from "pg";
import { arquivosDeMigracao } from "./migrar.js";

export interface RetratoBanco {
  migracoes: string[];
  /** Tabelas com RLS ligado e quantas políticas existem (a segurança entre empresas veio junto?). */
  tabelasComRls: number;
  politicas: number;
  /** Linhas por tabela de negócio (só das empresas pedidas, quando informadas). */
  linhas: Record<string, number>;
  ultimoEvento: string | null;
}

export async function retratoDoBanco(pool: pg.Pool, empresaIds?: string[]): Promise<RetratoBanco> {
  const migracoes = (await pool.query<{ nome: string }>("SELECT nome FROM _migracao ORDER BY nome")).rows.map((r) => r.nome);
  const { rows: seg } = await pool.query<{ rls: number; politicas: number }>(
    `SELECT (SELECT count(*)::int FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity) AS rls,
            (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') AS politicas`,
  );
  const { rows: tabelas } = await pool.query<{ t: string }>(
    `SELECT table_name AS t FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'empresa_id' ORDER BY table_name`,
  );
  const linhas: Record<string, number> = {};
  for (const { t } of tabelas) {
    const filtro = empresaIds ? "WHERE empresa_id = ANY($1::uuid[])" : "";
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}" ${filtro}`, empresaIds ? [empresaIds] : []);
    linhas[t] = rows[0].n;
  }
  const filtroEvento = empresaIds ? "WHERE empresa_id = ANY($1::uuid[])" : "";
  const { rows: ev } = await pool.query<{ ultimo: Date | null }>(`SELECT max(criado_em) AS ultimo FROM evento ${filtroEvento}`, empresaIds ? [empresaIds] : []);
  return { migracoes, tabelasComRls: seg[0].rls, politicas: seg[0].politicas, linhas, ultimoEvento: ev[0].ultimo?.toISOString() ?? null };
}

/** Problemas da cópia em relação à referência (vazio = a restauração confere). */
export async function conferirRestauracao(restaurado: RetratoBanco, referencia?: RetratoBanco): Promise<string[]> {
  const problemas: string[] = [];
  const esperadas = await arquivosDeMigracao();
  const faltando = esperadas.filter((m) => !restaurado.migracoes.includes(m));
  if (faltando.length) problemas.push(`Migrações que faltam na cópia: ${faltando.join(", ")} (rode npm run db:migrate depois de restaurar).`);
  if (restaurado.tabelasComRls === 0 || restaurado.politicas === 0) problemas.push("A cópia veio sem Row Level Security: NÃO use — a separação entre empresas não está garantida.");
  if (referencia) {
    if (restaurado.politicas !== referencia.politicas) problemas.push(`Políticas de segurança: ${restaurado.politicas} na cópia, ${referencia.politicas} na original.`);
    for (const [t, n] of Object.entries(referencia.linhas)) {
      const r = restaurado.linhas[t];
      if (r === undefined) problemas.push(`Tabela ${t} não existe na cópia.`);
      else if (r < n) problemas.push(`Tabela ${t}: ${r} linhas na cópia, ${n} na original.`);
    }
  }
  return problemas;
}
