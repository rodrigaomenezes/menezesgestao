// Fluxos do CRM no navegador, nas cinco larguras: cadastro, ficha (nota, tarefa, oportunidade), kanban com
// motivo de perda e importação de planilha sem duplicar. A empresa A chama contato de "aluno" (vocabulário).
import { expect, test, type Page } from "@playwright/test";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

/** Telefone único por largura e execução (o telefone é a chave de deduplicação). */
function telefoneUnico(projeto: string, n: number): string {
  const indice = ["celular-360", "celular-390", "tablet-768", "notebook-1024", "computador-1440"].indexOf(projeto) + 1;
  const sufixo = String((Date.now() + n) % 10000).padStart(4, "0");
  return `(11) 9${indice}${n}${String(Date.now()).slice(-2)}-${sufixo}`;
}

async function irPara(page: Page, item: string, titulo: string | RegExp) {
  await abrirMenu(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: item, exact: true }).click();
  await expect(page.getByRole("heading", { name: titulo, level: 1 })).toBeVisible();
}

test("telas do CRM usam o vocabulário da empresa e cabem na largura do aparelho", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  for (const [item, titulo] of [
    ["Alunos", "Alunos"],
    ["Funil", "Funil"],
    ["Tarefas", "Tarefas"],
    ["Importar planilha", "Importar alunos"],
    ["Configurar CRM", "Configurar CRM"],
  ]) {
    await irPara(page, item, titulo);
    await semRolagemLateral(page);
  }
});

test("cadastro e ficha: nota, tarefa e oportunidade aparecem no histórico", async ({ page }, info) => {
  const { a } = dados();
  const nome = `Aluno Ficha ${info.project.name}`;
  await entrar(page, pessoa(a, "dono").email);
  await irPara(page, "Alunos", "Alunos");
  await page.getByRole("button", { name: "Novo aluno" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(nome);
  await page.getByLabel("Telefone (WhatsApp)").fill(telefoneUnico(info.project.name, 1));
  await page.getByRole("button", { name: "Cadastrar aluno" }).click();

  await expect(page.getByRole("heading", { name: nome, level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp" })).toBeVisible();
  await semRolagemLateral(page);

  await page.getByLabel("Nova nota").fill("Pediu para ligar depois das 18h.");
  await page.getByRole("button", { name: "Salvar nota" }).click();
  await expect(page.getByRole("region", { name: "Notas" }).getByText("Pediu para ligar depois das 18h.")).toBeVisible();

  await page.getByLabel("Nova tarefa").fill("Ligar às 18h");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("region", { name: "Tarefas" }).getByText("Ligar às 18h", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nova", exact: true }).click();
  await page.getByLabel("Título").fill("Matrícula 2027");
  await page.getByLabel("Valor (R$)").fill("1.250,00");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(page.getByRole("region", { name: "Oportunidades" }).getByText(/R\$\s1\.250,00/)).toBeVisible();

  const historico = page.getByRole("region", { name: "Histórico" });
  await expect(historico.getByText("Nota escrita")).toBeVisible();
  await expect(historico.getByText("Tarefa criada")).toBeVisible();
  await expect(historico.getByText("Oportunidade criada")).toBeVisible();
  await semRolagemLateral(page);
});

test("kanban: mover para Perdido pede o motivo e registra", async ({ page }, info) => {
  const { a } = dados();
  const titulo = `Kanban ${info.project.name} ${Date.now()}`;
  await entrar(page, pessoa(a, "dono").email);
  // Prepara pela API (mesma sessão): contato + oportunidade na primeira etapa.
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const cab = { "x-csrf-token": csrf };
  const contato = await (await page.request.post("/api/contatos", { headers: cab, data: { nome: `Aluno ${titulo}`, telefone: telefoneUnico(info.project.name, 2) } })).json();
  const config = await (await page.request.get("/api/crm/configuracao")).json();
  const op = await page.request.post("/api/oportunidades", { headers: cab, data: { contatoId: contato.id, funilId: config.funis[0].id, titulo } });
  expect(op.status()).toBe(201);

  await irPara(page, "Funil", "Funil");
  await page.getByLabel("Buscar aluno ou título").fill(titulo);
  await page.getByLabel("Buscar aluno ou título").press("Enter");
  const cartao = page.getByRole("listitem").filter({ hasText: titulo });
  await expect(cartao).toBeVisible();
  await semRolagemLateral(page);

  await cartao.getByLabel(`Mover ${titulo} para`).selectOption({ label: "Perdido" });
  const modal = page.getByRole("dialog", { name: "Mover para “Perdido”" });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Mover" }).click();
  // Sem motivo o navegador não deixa enviar; escolhe e move.
  await modal.getByLabel("Motivo da perda").selectOption({ index: 1 });
  await modal.getByRole("button", { name: "Mover" }).click();
  await expect(modal).toBeHidden();
  const colunaPerdido = page.getByRole("region", { name: "Perdido" });
  await expect(colunaPerdido.getByRole("link", { name: titulo })).toBeVisible();
  // Cartões nas últimas colunas não podem alargar a página (só o quadro rola de lado).
  await semRolagemLateral(page);
});

test("importação: a mesma planilha duas vezes não duplica ninguém", async ({ page }, info) => {
  const { a } = dados();
  const t1 = telefoneUnico(info.project.name, 3);
  const t2 = telefoneUnico(info.project.name, 4);
  const csv = `Nome;Celular;Cidade\nImportado Um ${info.project.name};${t1};Santos\nImportado Dois ${info.project.name};${t2};Santos\n`;
  await entrar(page, pessoa(a, "dono").email);

  for (const [rodada, esperado] of [
    [1, { Novos: "2", "Sem mudança": "0" }],
    [2, { Novos: "0", "Sem mudança": "2" }],
  ] as const) {
    await page.goto("/importar");
    await page.getByLabel("Planilha").setInputFiles({ name: `alunos-${rodada}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByRole("button", { name: "Enviar e conferir" }).click();
    // As colunas são sugeridas pelo cabeçalho ("Celular" → Telefone).
    await expect(page.getByLabel("Telefone *")).toHaveValue("Celular");
    await expect(page.getByLabel("Nome *")).toHaveValue("Nome");
    await semRolagemLateral(page);
    await page.getByRole("button", { name: /^Importar 2 linha/ }).click();
    await expect(page.getByRole("heading", { name: /Concluída/ })).toBeVisible({ timeout: 20_000 });
    for (const [rotulo, valor] of Object.entries(esperado)) {
      await expect(page.locator(".numeros div").filter({ hasText: rotulo }).locator("dd")).toHaveText(valor);
    }
  }
});
