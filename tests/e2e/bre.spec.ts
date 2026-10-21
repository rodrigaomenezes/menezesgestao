// Motor BRE nas cinco larguras: a reentrada combinada para hoje põe o cliente na fila do dia, o registro de
// 30 segundos sai pelo modal e a tela não rola para o lado.
import { expect, test } from "@playwright/test";
import pg from "pg";
import { urlBancoTeste } from "../apoio/ambiente.js";
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

test("SQ-BRE: o gestor pede a prévia da IA na conversa, ajusta e confirma; o desempenho aparece", async ({ page }, info) => {
  const { a } = dados();
  const pool = new pg.Pool({ connectionString: urlBancoTeste() });
  let conversaId: string;
  try {
    const vendedor = (await pool.query("SELECT id FROM usuario WHERE lower(email) = lower($1)", [pessoa(a, "vendedor").email])).rows[0].id;
    const canal = (await pool.query("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, $2, 'demonstracao') RETURNING id", [a.id, `SQ ${info.project.name}`])).rows[0].id;
    const contato = (await pool.query("INSERT INTO contato (empresa_id, nome, responsavel_id) VALUES ($1, $2, $3) RETURNING id", [a.id, `Cliente SQ ${info.project.name}`, vendedor])).rows[0].id;
    conversaId = (await pool.query("INSERT INTO conversa (empresa_id, canal_id, contato_id, atribuida_a) VALUES ($1, $2, $3, $4) RETURNING id", [a.id, canal, contato, vendedor])).rows[0].id;
    for (const [i, [direcao, texto]] of [["saida", "Oi! Como foi com o perfume?"], ["entrada", "Amei, quero outro"]].entries()) {
      await pool.query(
        "INSERT INTO mensagem (empresa_id, conversa_id, canal_id, direcao, tipo, status, texto, criado_em) VALUES ($1, $2, $3, $4, 'texto', 'recebida', $5, now() + make_interval(secs => $6))",
        [a.id, conversaId, canal, direcao, texto, i],
      );
    }
  } finally {
    await pool.end();
  }

  await entrar(page, pessoa(a, "gestor").email);
  await page.goto(`/conversas/${conversaId}`);
  await page.getByRole("button", { name: "SQ-BRE", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("Prévia da IA");
  await modal.getByLabel(/^Humanização/).selectOption("20");
  await semRolagemLateral(page);
  await modal.getByRole("button", { name: "Confirmar nota" }).click();
  await expect(page.getByText(/Nota SQ-BRE confirmada: \d+/)).toBeVisible();

  await page.goto("/qualidade");
  await expect(page.getByRole("region", { name: "SQ-BRE" })).toContainText("Vendedor A1");
  await page.goto("/bre");
  await expect(page.getByRole("heading", { name: "Desempenho (BPI)" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Desempenho (BPI)" })).toContainText("Vendedor A1");
  await semRolagemLateral(page);
});

test("encerramento guiado na ficha, motivos de Break e painel IA × equipe", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const cabecalho = { headers: { "x-csrf-token": csrf } };
  const contato = await page.request.post("/api/contatos", { ...cabecalho, data: { nome: `Encerra ${info.project.name}` } });
  expect(contato.ok(), await contato.text()).toBe(true);
  const contatoId = (await contato.json()).id as string;
  const funilId = (await (await page.request.get("/api/crm/configuracao")).json()).funis[0].id as string;
  const op = await page.request.post("/api/oportunidades", { ...cabecalho, data: { contatoId, funilId, titulo: "Plano anual" } });
  expect(op.ok(), await op.text()).toBe(true);

  await page.goto(`/contatos/${contatoId}`);
  await page.getByRole("button", { name: "Encerrar (BRE)" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Critério").selectOption({ label: "Mudança de perfil incompatível" });
  for (const item of ["Motivo compreendido", "CRM atualizado", "Temperatura definida", "Próximo gatilho definido", "Data ou evento de reentrada", "Nenhuma informação sem registro"]) {
    await modal.getByLabel(item).check();
  }
  await modal.getByLabel("Motivo da reentrada").fill("Mudou de cidade");
  await semRolagemLateral(page);
  await modal.getByRole("button", { name: "Encerrar", exact: true }).click();
  await expect(page.getByText("Encerrado pelo método BRE.")).toBeVisible();
  await expect(page.getByText("Encerrada pelo método BRE: Mudança de perfil incompatível")).toBeVisible();

  await page.goto("/bre");
  await expect(page.getByRole("heading", { name: "IA × equipe" })).toBeVisible();
  const motivos = page.getByRole("region", { name: "Motivos de Break" });
  await motivos.getByLabel("Categoria").selectOption({ label: "C — Financeiro" });
  await motivos.getByLabel("Novo motivo", { exact: true }).fill(`Frete ${info.project.name}`);
  await motivos.getByRole("button", { name: "Adicionar" }).click();
  await expect(motivos.getByText(`Frete ${info.project.name}`)).toBeVisible();
  await semRolagemLateral(page);
});

test("automação: o administrador cria, e ligar sem o painel IA × equipe liberado explica o motivo", async ({ page }, info) => {
  const { a } = dados();
  const pool = new pg.Pool({ connectionString: urlBancoTeste() });
  try {
    await pool.query("INSERT INTO canal (empresa_id, nome, provedor) VALUES ($1, $2, 'demonstracao')", [a.id, `Canal auto ${info.project.name}`]);
  } finally {
    await pool.end();
  }
  await entrar(page, pessoa(a, "dono").email);
  await page.goto("/bre");
  const secao = page.getByRole("region", { name: "Automação" });
  const nome = `Chegou bem ${info.project.name}`;
  await secao.getByLabel("Nome", { exact: true }).fill(nome);
  await secao.getByLabel("Dias depois da venda").fill("2");
  await secao.getByRole("button", { name: "Criar automação" }).click();
  const item = secao.locator("li.item", { hasText: nome });
  await expect(item).toContainText("desligada");
  await semRolagemLateral(page);
  await item.getByRole("button", { name: "Ligar" }).click();
  await expect(page.getByText(/o painel IA × equipe precisa estar liberado/)).toBeVisible();
  await expect(item).toContainText("desligada");
});
