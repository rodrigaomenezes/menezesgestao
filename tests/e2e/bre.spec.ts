// Motor BRE nas cinco larguras: a reentrada combinada para hoje põe o cliente na fila do dia, o registro de
// 30 segundos sai pelo modal e a tela não rola para o lado.
import { expect, test } from "@playwright/test";
import { dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

test("fila do dia e registro de conversa", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "vendedor").email);
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const nome = `Cliente BRE ${info.project.name}`;
  const criado = await page.request.post("/api/contatos", { headers: { "x-csrf-token": csrf }, data: { nome } });
  expect(criado.ok(), await criado.text()).toBe(true);
  const contatoId = (await criado.json()).id as string;
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const r = await page.request.post("/api/bre/reentradas", { headers: { "x-csrf-token": csrf }, data: { contatoId, tipo: "TIME", previstaPara: hoje, motivo: "Combinou retorno hoje" } });
  expect(r.ok(), await r.text()).toBe(true);

  await page.goto("/bre");
  await expect(page.getByRole("heading", { name: "Motor BRE", level: 1 })).toBeVisible();
  const item = page.getByRole("region", { name: "Fila do dia" }).locator("li.item", { hasText: nome }).first();
  await expect(item).toContainText("Reentrada: Combinou retorno hoje");
  await semRolagemLateral(page);

  await item.getByRole("button", { name: "Registrar conversa" }).click();
  await page.getByLabel("Resultado").selectOption({ label: "Avançou" });
  await page.getByLabel("Temperatura").selectOption({ label: "Quente" });
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Salvar registro" }).click();
  await expect(page.getByText("Conversa registrada.")).toBeVisible();
});
