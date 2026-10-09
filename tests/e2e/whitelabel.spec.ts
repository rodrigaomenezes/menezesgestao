// White-label nas cinco larguras: empresa nova se cadastra e configura marca e segmento sozinha pelo
// assistente; plano troca módulos sem apagar; automação criada na tela; logo aparece no topo.
import { expect, test } from "@playwright/test";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("empresa nova: cadastro, assistente de 5 passos, vocabulário do segmento e troca de plano", async ({ page }, info) => {
  const inicio = Date.now();
  const email = `fundador.${info.project.name}.${Date.now()}@teste.example.com`;
  await page.goto("/");
  await page.getByRole("link", { name: "Ainda não tem conta? Cadastre sua empresa" }).click();
  const form = page.getByRole("form", { name: "Cadastrar empresa" });
  await form.getByLabel("Nome da empresa").fill(`Escola ${info.project.name}`);
  await form.getByLabel("Seu nome").fill("Fernanda Fundadora");
  await form.getByLabel("Seu e-mail").fill(email);
  await form.getByLabel("Crie uma senha").fill("uma senha bem comprida");
  await form.getByLabel(/Li e aceito/).check();
  await semRolagemLateral(page);
  await form.getByRole("button", { name: "Criar conta" }).click();

  // 1. Marca
  await expect(page.getByRole("heading", { name: "Primeiros passos", level: 1 })).toBeVisible();
  await page.getByLabel("Nome do produto (opcional)").fill(`Escola ${info.project.name}`);
  await page.getByLabel("Cor principal").fill("#0b5394");
  await page.getByRole("button", { name: "Salvar marca" }).click();
  await expect(page.getByText("Marca salva.", { exact: false })).toBeVisible();
  await page.getByLabel("Logo para fundo claro").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Logo atualizado.")).toBeVisible();
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  // 2. Segmento
  await page.getByText("Escola e cursos").click();
  await page.getByRole("button", { name: "Aplicar e continuar" }).click();
  // 3. Equipe
  await expect(page.getByRole("heading", { name: "3. Equipe" })).toBeVisible();
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Pular por enquanto" }).click();
  // 4. Canais
  await page.getByRole("button", { name: "Criar canal de demonstração" }).click();
  await expect(page.getByText("Canal de demonstração conectado.")).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  // 5. Contatos
  await page.getByRole("button", { name: "Usar dados de exemplo" }).click();
  await expect(page.getByText(/Exemplos criados/)).toBeVisible();
  await page.getByRole("button", { name: "Concluir" }).click();
  await expect(page.getByRole("heading", { name: /^Olá, Fernanda/ })).toBeVisible();
  // Menos de 15 minutos (aqui, segundos) do cadastro ao sistema pronto.
  expect(Date.now() - inicio).toBeLessThan(15 * 60_000);

  // O vocabulário do segmento já vale no menu; o logo aparece no topo.
  await expect(page.getByRole("banner").getByRole("img", { name: `Escola ${info.project.name}` })).toBeVisible();
  await abrirMenu(page);
  await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Alunos", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Início", exact: true }).click();
  await page.getByRole("button", { name: "Apagar os exemplos" }).click();
  await expect(page.getByText(/Exemplos apagados/)).toBeVisible();

  // Plano: mudar para o Essencial tira Conversas do menu; voltar traz de novo.
  await page.goto("/plano");
  await expect(page.getByText("Em teste")).toBeVisible();
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Mudar para Essencial" }).click();
  await page.getByRole("dialog", { name: "Mudar para o plano Essencial" }).getByRole("button", { name: "Mudar de plano" }).click();
  await expect(page.getByText("Plano alterado.")).toBeVisible();
  await abrirMenu(page);
  await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Conversas", exact: true })).toHaveCount(0);
  await page.goto("/plano");
  await page.getByRole("button", { name: "Mudar para Completo" }).click();
  await page.getByRole("dialog", { name: "Mudar para o plano Completo" }).getByRole("button", { name: "Mudar de plano" }).click();
  await abrirMenu(page);
  await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Conversas", exact: true })).toBeVisible();
});

test("automação criada na tela aparece na lista e pode ser desligada", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  await page.goto("/automacoes");
  await page.getByRole("button", { name: "Nova automação" }).click();
  const form = page.getByRole("form", { name: "Nova automação" });
  const nome = `Avisar ligação perdida ${info.project.name}`;
  await form.getByLabel("Nome").fill(nome);
  await form.getByLabel("Acontecer").selectOption("ligacao.encerrada");
  await form.getByLabel("Condição").selectOption("atendida");
  await form.getByLabel("Valor").selectOption("nao");
  await form.getByLabel("Ação").selectOption("avisar");
  await form.getByLabel("Texto do aviso").fill("Ligue de novo para {nome}.");
  await semRolagemLateral(page);
  await form.getByRole("button", { name: "Criar automação" }).click();
  await expect(page.getByText(/Automação criada/)).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: nome });
  await expect(item.getByText(/Quando: Ligação encerrada · se Foi atendida é · então: Avisar/)).toBeVisible();
  await item.getByRole("button", { name: "Desligar" }).click();
  await expect(item.getByText("desligada")).toBeVisible();
  await semRolagemLateral(page);
});

test("telas de marca, plano e automações cabem na largura do aparelho", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  for (const item of ["Empresa e marca", "Plano e cobrança", "Automações"]) {
    await abrirMenu(page);
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: item, exact: true }).click();
    await expect(page.getByRole("heading", { name: item, level: 1 })).toBeVisible();
    await semRolagemLateral(page);
  }
  await expect(page.getByRole("heading", { name: "Automações", level: 1 })).toBeVisible();
});
