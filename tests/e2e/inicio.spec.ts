// Início que cada pessoa monta, nas cinco larguras: tirar, mudar a ordem e adicionar blocos; a escolha continua
// depois de recarregar. No celular e no tablet, a barra de baixo leva aos lugares mais usados.
import { expect, test, type Page } from "@playwright/test";
import { dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

async function voltarAoPadrao(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.fetch("/api/inicio", { method: "DELETE", headers: { "x-csrf-token": csrf } });
  expect(r.ok(), await r.text()).toBe(true);
}

/** Confere os primeiros blocos, na ordem (esperando a tela carregar). */
async function comecaCom(page: Page, ...titulos: string[]) {
  const h = page.locator(".blocos > section h2");
  for (const [i, t] of titulos.entries()) await expect(h.nth(i)).toHaveText(t);
}

test("cada pessoa monta o próprio Início e a escolha fica salva", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "vendedor").email);
  await voltarAoPadrao(page);
  await page.reload();

  await expect(page.getByRole("region", { name: "Conversas esperando" })).toBeVisible();
  await comecaCom(page, "Atalhos", "Conversas esperando");
  await semRolagemLateral(page);

  await page.getByRole("button", { name: "Personalizar início" }).click();
  await page.getByRole("button", { name: "Tirar Conversas esperando do início" }).click();
  await expect(page.getByRole("region", { name: "Conversas esperando" })).toHaveCount(0);
  await page.getByRole("button", { name: "Descer Atalhos" }).click();
  await page.getByRole("button", { name: "Adicionar Conversas esperando" }).click();
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Concluir" }).click();

  await page.reload();
  await comecaCom(page, "Minhas metas", "Atalhos");
  await expect(page.locator(".blocos > section h2").last()).toHaveText("Conversas esperando");

  // Voltar ao padrão do perfil desfaz a escolha (e nada mais).
  await page.getByRole("button", { name: "Personalizar início" }).click();
  await page.getByRole("button", { name: "Voltar ao padrão do perfil" }).click();
  await expect(page.getByText("Início de volta ao padrão do seu perfil.")).toBeVisible();
  await comecaCom(page, "Atalhos", "Conversas esperando");
});

test("barra de baixo no celular e no tablet; menu lateral fixo no computador", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "vendedor").email);
  const barra = page.getByRole("navigation", { name: "Atalhos do celular" });
  if (["notebook-1024", "computador-1440"].includes(info.project.name)) {
    await expect(barra).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Início", exact: true })).toBeVisible();
    return;
  }
  await expect(barra).toBeVisible();
  await barra.getByRole("link", { name: "Conversas" }).click();
  await expect(page.getByRole("heading", { name: "Conversas", level: 1 })).toBeVisible();
  await barra.getByRole("button", { name: "Mais: abrir menu" }).click();
  await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Tarefas", exact: true })).toBeVisible();
  await semRolagemLateral(page);
});

test("blocos do Início levam ao detalhe: a etapa do funil abre o painel com a lista exata", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  await voltarAoPadrao(page);
  await page.goto("/");
  const funil = page.locator("section.bloco", { has: page.getByRole("heading", { name: "Seu funil" }) });
  if (!(await funil.count())) test.skip(true, "o perfil não tem o bloco do funil no padrão");
  await funil.getByRole("link", { name: /Ver a lista/ }).first().click();
  await expect(page).toHaveURL(/ver=painel/);
  await expect(page).toHaveURL(/lista=/);
  await expect(page.getByRole("tab", { name: "Painel" })).toHaveAttribute("aria-selected", "true");
  await semRolagemLateral(page);
});

