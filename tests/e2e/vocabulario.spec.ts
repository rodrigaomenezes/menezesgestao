// Segmento e termos nas cinco larguras: a clínica aplica o segmento, ajusta um termo com gênero e as telas passam
// a falar "Pacientes", "Novo paciente" e "Nova consulta" — os módulos são os mesmos, só os nomes mudam.
import { expect, test } from "@playwright/test";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

test("clínica aplica o segmento, ajusta um termo e as telas usam os novos nomes", async ({ page }) => {
  const { b } = dados();
  await entrar(page, pessoa(b, "dono").email);
  const menu = page.getByRole("navigation", { name: "Menu principal" });

  await abrirMenu(page);
  await menu.getByRole("link", { name: "Segmento e termos" }).click();
  await expect(page.getByRole("heading", { name: "Segmento e termos", level: 1 })).toBeVisible();
  await semRolagemLateral(page);

  // 1. Segmento: aplicar (ou voltar ao padrão, nas larguras seguintes) pede confirmação e não apaga nada.
  await page.getByRole("radiogroup", { name: "Segmento" }).getByText("Clínica e saúde").click();
  await page.getByRole("button", { name: /^(Aplicar segmento|Voltar ao padrão do segmento)$/ }).click();
  await page.getByRole("dialog", { name: "Aplicar segmento" }).getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("Segmento aplicado. As telas já usam os novos termos.")).toBeVisible();

  const previa = page.getByRole("region", { name: "Assim vai aparecer" });
  await expect(previa.getByText("Botões: Novo paciente · Novo atendimento · Nova consulta")).toBeVisible();

  // 2. Termos: quem usa o sistema na clínica é "a recepcionista".
  await page.getByLabel("Singular (padrão: colaborador)").fill("recepcionista");
  await page.getByLabel("a recepcionista", { exact: true }).check();
  await expect(previa.getByText("Ranking: Recepcionistas que mais venderam")).toBeVisible();
  await page.getByRole("button", { name: "Salvar termos" }).click();
  await expect(page.getByText("Termos salvos. As telas já usam os novos nomes.")).toBeVisible();
  await semRolagemLateral(page);

  // As telas seguem o vocabulário: menu, título e botão com gênero certo.
  await abrirMenu(page);
  await menu.getByRole("link", { name: "Pacientes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pacientes", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo paciente" })).toBeVisible();
  await semRolagemLateral(page);
});
