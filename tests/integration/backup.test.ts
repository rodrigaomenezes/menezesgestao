// Fase 7: backup que volta. Faz a cópia (pg_dump), restaura num banco novo e confere migrações,
// segurança por empresa (RLS) e contagens — o mesmo roteiro de docs/BACKUP.md.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comEmpresa, criarBanco } from "../../apps/api/src/infra/banco.js";
import { conferirRestauracao, retratoDoBanco } from "../../apps/api/src/infra/backup.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";
import { urlBancoTeste } from "../apoio/ambiente.js";

const executar = promisify(execFile);
let t: AmbienteTeste;
let e: EmpresasTeste;
let pasta: string;
const url = urlBancoTeste();
const urlCopia = (() => {
  const u = new URL(url);
  u.pathname = `${u.pathname}_restauro`;
  return u.toString();
})();

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  pasta = await mkdtemp(join(tmpdir(), "mg-backup-"));
});
afterAll(async () => {
  await t.fechar();
  await rm(pasta, { recursive: true, force: true });
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS "${new URL(urlCopia).pathname.slice(1)}" WITH (FORCE)`).catch(() => undefined);
  await admin.end();
});

describe("backup e restauração", () => {
  it("a cópia restaurada tem as migrações, a segurança entre empresas e todos os dados", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    expect((await dono.post("/api/contatos", { nome: "Cliente do backup", telefone: "(11) 96200-0001" })).statusCode).toBe(201);
    const empresas = [e.a.empresaId, e.b.empresaId];
    const original = await retratoDoBanco(t.banco.pool, empresas);
    expect(original.linhas.contato).toBeGreaterThan(0);

    const arquivo = join(pasta, "copia.dump");
    await executar("pg_dump", ["--format=custom", "--file", arquivo, url]);
    const nomeCopia = new URL(urlCopia).pathname.slice(1);
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS "${nomeCopia}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${nomeCopia}"`);
    await admin.end();
    await executar("pg_restore", ["--dbname", urlCopia, "--exit-on-error", arquivo]);

    const copia = criarBanco(urlCopia);
    try {
      const restaurado = await retratoDoBanco(copia.pool, empresas);
      expect(await conferirRestauracao(restaurado, original)).toEqual([]);
      expect(restaurado.linhas).toEqual(original.linhas);
      // A separação entre empresas veio junto: com a empresa A no contexto, nada de B aparece.
      const { rows } = await comEmpresa(copia, e.a.empresaId, (tx) => tx.cliente.query("SELECT DISTINCT empresa_id FROM contato"));
      expect(rows.map((r) => r.empresa_id)).toEqual([e.a.empresaId]);
    } finally {
      await copia.pool.end();
    }
  }, 120_000);

  it("acusa cópia sem segurança ou com dados faltando", async () => {
    const r = await retratoDoBanco(t.banco.pool, [e.a.empresaId]);
    expect(await conferirRestauracao({ ...r, politicas: 0 })).toEqual([expect.stringMatching(/sem Row Level Security/)]);
    expect(await conferirRestauracao({ ...r, linhas: { ...r.linhas, contato: 0 } }, r)).toEqual([expect.stringMatching(/Tabela contato: 0 linhas/)]);
    expect(await conferirRestauracao({ ...r, migracoes: [] })).toEqual([expect.stringMatching(/Migrações que faltam/)]);
  });
});
