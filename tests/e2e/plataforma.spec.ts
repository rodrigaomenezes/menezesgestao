// Fase 9 nas cinco larguras: empresa em teste vê o uso do plano; a equipe da plataforma estende o teste e suspende
// (a faixa avisa e tudo fica só consulta); atraso deixa só consulta até pagar; ajuda da tela; documentos e status
// abertos; versão nova dos termos pede aceite antes de usar.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { urlBancoTeste } from "../apoio/ambiente.js";
import { entrar, semRolagemLateral } from "./apoio.js";

const SENHA = "uma senha bem comprida";

async function sql(texto: string, valores: unknown[] = []) {
  const pool = new pg.Pool({ connectionString: urlBancoTeste() });
  try {
    return (await pool.query(texto, valores)).rows;
  } finally {
    await pool.end();
  }
}

/** Empresa nova pelo cadastro aberto, com o assistente já concluído; devolve o id. */
async function cadastrar(page: Page, email: string, empresa: string): Promise<string> {
  await page.goto("/");
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.post("/api/cadastro", { headers: { "x-csrf-token": csrf }, data: { empresa, nome: "Paula Plataforma", email, senha: SENHA, aceite: true } });
  expect(r.status()).toBe(201);
  const [e] = await sql(
    `UPDATE empresa SET onboarding = jsonb_build_object('passo', 6, 'concluidoEm', now())
      WHERE id = (SELECT v.empresa_id FROM vinculo v JOIN usuario u ON u.id = v.usuario_id WHERE u.email = $1) RETURNING id`,
    [email],
  );
  return e.id as string;
}

test("plano, painel da plataforma, bloqueio por atraso, ajuda, documentos e aceite de termos", async ({ page }, info) => {
  const email = `plataforma.${info.project.name}@teste.example.com`;
  const nomeEmpresa = `Loja Plataforma ${info.project.name}`;
  const empresaId = await cadastrar(page, email, nomeEmpresa);
  await entrar(page, email, SENHA);

  // Uso do plano e ajuda da própria tela.
  await page.goto("/plano");
  await expect(page.getByRole("heading", { name: "Uso do plano" })).toBeVisible();
  await expect(page.getByText("Pessoas ativas")).toBeVisible();
  await semRolagemLateral(page);
  await page.getByRole("link", { name: "Ajuda desta tela" }).click();
  await expect(page.locator("details[open] summary")).toHaveText("Plano, limites e pagamento");
  await semRolagemLateral(page);

  // Painel da plataforma: estender teste e suspender a própria empresa (a faixa aparece), depois reativar.
  await page.goto("/plataforma");
  const linha = page.locator("li.item", { hasText: nomeEmpresa });
  await expect(linha).toContainText("Em teste");
  await linha.getByRole("button", { name: "Estender teste" }).click();
  await linha.getByLabel("Mais quantos dias").fill("5");
  await linha.getByRole("button", { name: "Estender", exact: true }).click();
  await expect(page.getByText("Teste estendido.")).toBeVisible();
  await semRolagemLateral(page);
  await linha.getByRole("button", { name: "Suspender" }).click();
  await linha.getByLabel("Motivo da suspensão").fill("Teste de ponta a ponta");
  await linha.getByRole("button", { name: "Suspender" }).last().click();
  await expect(linha).toContainText("Suspensa");
  await page.reload();
  await expect(page.getByText(/A empresa está suspensa/).first()).toBeVisible();
  await page.locator("li.item", { hasText: nomeEmpresa }).getByRole("button", { name: "Reativar" }).click();
  await expect(page.getByText("Empresa reativada.")).toBeVisible();

  // Atraso de 10 dias: só consulta, com a faixa; pagar libera na hora.
  const [a] = await sql("UPDATE assinatura SET status = 'atrasada' WHERE empresa_id = $1 RETURNING id", [empresaId]);
  await sql(
    `INSERT INTO fatura (empresa_id, assinatura_id, plano, valor_centavos, vencimento, status)
     VALUES ($1, $2, 'completo', 39900, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 10, 'vencida')`,
    [empresaId, a.id],
  );
  await page.goto("/plano");
  await expect(page.getByText(/Só para consulta: o pagamento está atrasado há 10 dias/)).toBeVisible();
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Pagar (simulado)" }).click();
  await expect(page.getByText("Pagamento registrado (simulado).")).toBeVisible();
  await expect(page.getByText(/Só para consulta/)).toHaveCount(0);

  // Documentos e status abertos.
  await page.goto("/privacidade");
  await expect(page.getByRole("heading", { name: "Política de Privacidade", level: 1 }).last()).toBeVisible();
  await semRolagemLateral(page);
  await page.goto("/status");
  await expect(page.getByText("Banco de dados")).toBeVisible();

  // Pessoa nova sem aceite: precisa aceitar antes de usar.
  const nova = `nova.${info.project.name}.${Date.now()}@teste.example.com`;
  const [hash] = await sql("SELECT senha_hash FROM usuario WHERE email = $1", [email]);
  const [u] = await sql("INSERT INTO usuario (email, nome, senha_hash) VALUES ($1, 'Nina Nova', $2) RETURNING id", [nova, hash.senha_hash]);
  await sql(
    `INSERT INTO vinculo (empresa_id, usuario_id, perfil_id, status)
     SELECT $1, $2, p.id, 'ativo' FROM perfil p WHERE p.empresa_id = $1 AND p.nome ILIKE 'Vendedor%' LIMIT 1`,
    [empresaId, u.id],
  );
  await page.context().clearCookies();
  await page.goto("/");
  await page.getByLabel("E-mail").fill(nova);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Antes de continuar" })).toBeVisible();
  await semRolagemLateral(page);
  await page.getByLabel(/Li e aceito/).check();
  await page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await expect(page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite), Nina$/ })).toBeVisible();
});
