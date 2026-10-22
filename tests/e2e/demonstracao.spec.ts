// Demonstração nas cinco larguras: cada largura carrega um segmento, entra como dono e vê as telas cheias de dados
// fictícios; depois entra como vendedor e vê só a própria carteira.
import { expect, test } from "@playwright/test";
import { semRolagemLateral } from "./apoio.js";

const SEGMENTOS = [
  ["celular-360", "Escola Horizonte de Idiomas"],
  ["celular-390", "Clínica Bem Viver"],
  ["tablet-768", "Vértice Consultoria Empresarial"],
  ["notebook-1024", "Lar Ideal Imóveis"],
  ["computador-1440", "Distribuidora Ponto Certo"],
] as const;

test("carrega a empresa de exemplo do segmento e entra como dono e como vendedor", async ({ page }, info) => {
  test.setTimeout(120_000);
  const empresa = SEGMENTOS.find(([p]) => p === info.project.name)![1];
  await page.goto("/demonstracao");
  await page.getByLabel("Chave da demonstração").fill("errada");
  await page.getByRole("button", { name: "Abrir" }).click();
  await expect(page.getByText("Chave da demonstração incorreta.")).toBeVisible();
  await page.getByLabel("Chave da demonstração").fill("chave-da-demonstracao-e2e");
  await page.getByRole("button", { name: "Abrir" }).click();
  await expect(page.getByRole("heading", { name: "Carregar exemplo" })).toBeVisible();
  await semRolagemLateral(page);

  const segmento = page.getByRole("region", { name: "Carregar exemplo" }).locator("li.item", { hasText: empresa });
  await segmento.getByRole("button", { name: /Carregar exemplo|Gerar de novo/ }).click();
  const cartao = page.getByRole("region", { name: "Empresas de exemplo" }).locator("li.item", { hasText: empresa }).first();
  await expect(cartao.getByRole("button", { name: "Entrar como dono" })).toBeVisible({ timeout: 60_000 });
  await expect(cartao).toContainText("300 contatos");
  await semRolagemLateral(page);

  await cartao.getByRole("button", { name: "Entrar como dono" }).click();
  await expect(page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite), / })).toBeVisible();
  await semRolagemLateral(page);
  await page.goto("/funil");
  await expect(page.locator(".cartao-kanban").first()).toBeVisible();
  await semRolagemLateral(page);
  await page.goto("/desempenho");
  await expect(page.getByText(/Ligações/).first()).toBeVisible();
  await semRolagemLateral(page);
  await page.goto("/vendas");
  await expect(page.locator("li.item").first()).toBeVisible();
  await semRolagemLateral(page);

  // Volta à demonstração (o acesso pela chave continua valendo) e entra como vendedor.
  await page.goto("/demonstracao");
  await page
    .getByRole("region", { name: "Empresas de exemplo" })
    .locator("li.item", { hasText: empresa })
    .first()
    .getByRole("button", { name: "Entrar como vendedor" })
    .click();
  await expect(page.getByRole("heading", { name: /^(Bom dia|Boa tarde|Boa noite), / })).toBeVisible();
  await page.goto("/conversas");
  await expect(page.locator("li").first()).toBeVisible();
  await semRolagemLateral(page);
});
