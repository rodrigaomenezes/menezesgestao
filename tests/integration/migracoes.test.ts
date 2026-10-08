// Migrações aplicadas sobre um banco "antigo" (como o de produção), num banco temporário só deste teste.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrar } from "../../apps/api/src/infra/migrar.js";
import { urlBancoTeste } from "../apoio/ambiente.js";

const base = new URL(urlBancoTeste());
const nomeTemp = `${base.pathname.slice(1)}_migracoes`;
const urlTemp = new URL(base);
urlTemp.pathname = `/${nomeTemp}`;
let admin: pg.Client;
let pool: pg.Pool;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${nomeTemp}"`);
  await admin.query(`CREATE DATABASE "${nomeTemp}"`);
  pool = new pg.Pool({ connectionString: urlTemp.toString() });
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS "${nomeTemp}"`);
  await admin.end();
});

describe("0002 — permissões em tabela e slug", () => {
  it("copia as permissões válidas do JSON e dá slug único mesmo para nomes iguais criados juntos", async () => {
    // Estado da fase 0: só a 0001 aplicada, permissões em JSON (com lixo) e duas empresas de mesmo nome.
    await pool.query(await readFile(new URL("../../database/migrations/0001_fundacao.sql", import.meta.url), "utf8"));
    await pool.query(`CREATE TABLE _migracao (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now());
      INSERT INTO _migracao VALUES ('0001_fundacao.sql');
      INSERT INTO empresa (id, nome) VALUES
        ('11111111-1111-4111-8111-111111111111', 'Clínica São José'),
        ('22222222-2222-4222-8222-222222222222', 'Clínica São José');
      INSERT INTO perfil (empresa_id, nome, base, protegido, permissoes) VALUES
        ('11111111-1111-4111-8111-111111111111', 'Dono', 'dono', true,
         '{"usuarios":{"ver":"empresa","administrar":"empresa"},"crm":{"ver":"proprio","voar":"x"},"inexistente":{"ver":"empresa"}}');`);

    expect(await migrar(pool)).toContain("0002_permissao_e_slug.sql");

    const permissoes = await pool.query("SELECT modulo, acao, escopo FROM permissao ORDER BY modulo, acao");
    expect(permissoes.rows).toEqual([
      { modulo: "crm", acao: "ver", escopo: "proprio" },
      { modulo: "usuarios", acao: "administrar", escopo: "empresa" },
      { modulo: "usuarios", acao: "ver", escopo: "empresa" },
    ]);
    const slugs = await pool.query("SELECT slug FROM empresa ORDER BY id");
    expect(slugs.rows.map((r) => r.slug)).toEqual(["clinica-sao-jose", "clinica-sao-jose-22222222"]);

    // Rodar de novo não aplica nada.
    expect(await migrar(pool)).toEqual([]);
  });
});
