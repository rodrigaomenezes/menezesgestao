// Servidor dos testes de ponta a ponta: banco limpo, duas empresas de exemplo e o servidor real (com o front compilado).
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";
import { criarBanco } from "../src/db/banco.js";
import { migrar } from "../src/db/migrar.js";
import { semearEmpresa } from "../src/nucleo/semear.js";
import { gerarHashSenha } from "../src/seguranca/senha.js";
import { descricoesTeste } from "../src/teste/app-teste.js";
import { urlBancoTeste } from "../src/teste/ambiente.js";

const url = urlBancoTeste();
const limpar = new pg.Pool({ connectionString: url });
await limpar.query("DROP SCHEMA IF EXISTS pgboss CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
await limpar.end();

const banco = criarBanco(url);
await migrar(banco.pool);
const senha = randomBytes(9).toString("base64url");
const hash = await gerarHashSenha(senha);
const { a, b } = descricoesTeste();
const empresaA = await semearEmpresa(banco, a, hash);
const empresaB = await semearEmpresa(banco, b, hash);
await banco.pool.end();

await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/e2e-dados.json",
  JSON.stringify({ senha, a: { ...a, id: empresaA.empresaId }, b: { ...b, id: empresaB.empresaId } }),
);

Object.assign(process.env, {
  NODE_ENV: "test",
  PORT: process.env.PORT ?? "3100",
  DATABASE_URL: url,
  SESSION_SECRET: randomBytes(32).toString("hex"),
  CRM_CHAVE: randomBytes(32).toString("hex"),
  LIMITE_LOGIN_MINUTO: "1000",
  LIMITE_REQ_MINUTO: "100000",
});
await import("../src/server.js");
