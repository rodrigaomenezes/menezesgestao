import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import pg from "pg";
import type { DescricaoEmpresa } from "../../apps/api/src/modulos/empresas/semear.js";
import { urlBancoTeste } from "../apoio/ambiente.js";

interface Dados {
  senha: string;
  a: DescricaoEmpresa & { id: string };
  b: DescricaoEmpresa & { id: string };
}

export function dados(): Dados {
  return JSON.parse(readFileSync("test-results/e2e-dados.json", "utf8")) as Dados;
}

export function pessoa(empresa: DescricaoEmpresa, chave: string) {
  const p = empresa.pessoas.find((x) => x.chave === chave);
  if (!p) throw new Error(`pessoa ${chave} não existe`);
  return p;
}

export async function entrar(page: Page, email: string, senha = dados().senha) {
  await page.goto("/");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();
}

/** Abre o menu no celular (no computador ele já fica visível). */
export async function abrirMenu(page: Page) {
  const botao = page.getByRole("button", { name: "Abrir menu" });
  if (await botao.isVisible()) await botao.click();
}

export async function semRolagemLateral(page: Page) {
  const largura = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(largura, "a tela rola para o lado").toBeLessThanOrEqual(0);
}

/** Lê o e-mail do provedor de demonstração direto no banco de testes. */
export async function linkDoEmail(para: string, depoisDe = new Date(0)): Promise<string> {
  const pool = new pg.Pool({ connectionString: urlBancoTeste() });
  try {
    for (let i = 0; i < 60; i++) {
      const { rows } = await pool.query<{ texto: string }>(
        "SELECT texto FROM aviso_saida WHERE lower(para) = lower($1) AND criado_em >= $2 ORDER BY criado_em DESC LIMIT 1",
        [para, depoisDe],
      );
      const link = rows[0]?.texto.match(/https?:\/\/\S+token=[\w-]+/)?.[0];
      if (link) return new URL(link).pathname + new URL(link).search;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`nenhum e-mail para ${para}`);
  } finally {
    await pool.end();
  }
}
