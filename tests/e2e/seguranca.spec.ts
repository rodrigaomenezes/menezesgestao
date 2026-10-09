// Login em duas etapas na tela: liga pelo app autenticador, guarda os códigos, entra com o código,
// e a regra da empresa obriga quem ainda não configurou.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { codigoTotp, passoAtual } from "../../apps/api/src/infra/seguranca/totp.js";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

const SENHA = "uma senha bem comprida";

async function cadastrar(page: Page, nome: string, email: string) {
  await page.goto("/cadastro");
  const form = page.getByRole("form", { name: "Cadastrar empresa" });
  await form.getByLabel("Nome da empresa").fill(nome);
  await form.getByLabel("Seu nome").fill("Sara Segura");
  await form.getByLabel("Seu e-mail").fill(email);
  await form.getByLabel("Crie uma senha").fill(SENHA);
  await form.getByLabel(/Li e aceito/).check();
  await form.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Primeiros passos", level: 1 })).toBeVisible();
}

test("liga duas etapas pelo app, entra com o código e exige da equipe", async ({ page }, info) => {
  const email = `segura.${info.project.name}.${Date.now()}@teste.example.com`;
  await cadastrar(page, `Empresa segura ${info.project.name}`, email);

  // A regra não pode ser ligada por quem ainda não protegeu a própria conta.
  await page.goto("/empresa");
  await page.getByLabel("Login em duas etapas").selectOption("todos");
  await page.getByRole("button", { name: "Salvar regra" }).click();
  await expect(page.getByText(/Ligue o login em duas etapas na sua conta/).first()).toBeVisible();

  await abrirMenu(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Segurança da conta" }).click();
  await page.getByRole("button", { name: "Ligar duas etapas" }).click();
  await page.getByLabel(/App autenticador/).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("img", { name: "QR code para o app autenticador" })).toBeVisible();
  await semRolagemLateral(page);
  const segredo = (await page.locator(".chave-totp").textContent()) ?? "";
  await page.getByRole("textbox", { name: "Código" }).fill(codigoTotp(segredo, passoAtual()));
  await page.getByRole("button", { name: "Ligar" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos de recuperação" })).toBeVisible();
  await expect(page.locator(".codigos-recuperacao li")).toHaveCount(10);
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Já guardei" }).click();
  await expect(page.getByText("Ligado", { exact: true })).toBeVisible();

  // Agora a empresa pode exigir de todos.
  await page.goto("/empresa");
  await page.getByLabel("Login em duas etapas").selectOption("todos");
  await page.getByRole("button", { name: "Salvar regra" }).click();
  await expect(page.getByText(/Regra salva/)).toBeVisible();

  // Sair e entrar de novo: a senha não basta.
  await abrirMenu(page);
  await page.getByRole("button", { name: "Sair" }).click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Confirme que é você" })).toBeVisible();
  await page.getByRole("textbox", { name: "Código" }).fill("000000");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/Código incorreto/)).toBeVisible();
  await page.getByRole("textbox", { name: "Código" }).fill(codigoTotp(segredo, passoAtual() + 1));
  await page.getByRole("button", { name: "Entrar" }).click();
  // Volta para onde estava (a página da empresa), já logada.
  await expect(page.getByRole("heading", { name: "Empresa e marca", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Login em duas etapas")).toHaveValue("todos");
});

test("LGPD na ficha: exporta os dados do titular, anonimiza e define a retenção", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const sufixo = String(Date.now()).slice(-4);
  const nome = `Titular ${info.project.name} ${sufixo}`;
  const criado = await page.request.post("/api/contatos", { data: { nome, telefone: `(11) 9${sufixo}-${String(info.project.name.length).padStart(4, "0")}` }, headers: { "x-csrf-token": csrf } });
  expect(criado.status(), await criado.text()).toBe(201);
  const { id } = (await criado.json()) as { id: string };

  await page.goto(`/contatos/${id}`);
  const secao = page.getByRole("region", { name: "Privacidade (LGPD)" });
  const [arquivo] = await Promise.all([page.waitForEvent("download"), secao.getByRole("button", { name: "Exportar dados" }).click()]);
  expect(arquivo.suggestedFilename()).toMatch(/^dados-pessoais-.*\.json$/);
  const conteudo = JSON.parse(readFileSync((await arquivo.path()) ?? "", "utf8")) as { contato: { nome: string } };
  expect(conteudo.contato.nome).toBe(nome);

  await secao.getByRole("button", { name: "Anonimizar" }).click();
  const apagar = secao.getByRole("button", { name: "Apagar dados pessoais" });
  await expect(apagar).toBeDisabled();
  await secao.getByLabel(/Digite ANONIMIZAR/).fill("ANONIMIZAR");
  await semRolagemLateral(page);
  await apagar.click();
  await expect(page.getByRole("heading", { name: "Contato anonimizado", level: 1 })).toBeVisible();
  await expect(secao.getByText(/Dados pessoais apagados em/)).toBeVisible();

  await page.goto("/empresa");
  await page.getByLabel("Apagar o conteúdo de mensagens com mais de").selectOption("24");
  await page.getByRole("button", { name: "Salvar prazos" }).click();
  await expect(page.getByText(/Prazos salvos/)).toBeVisible();
  await page.getByLabel("Apagar o conteúdo de mensagens com mais de").selectOption("");
  await page.getByRole("button", { name: "Salvar prazos" }).click();
  await semRolagemLateral(page);
});

test("sem internet, mostra os dados recentes; ao sair, o cache é apagado", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "gestor").email);
  // O service worker assume a página (Workbox: clientsClaim) e passa a guardar as respostas da API.
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, undefined, { timeout: 15_000 });
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const nome = `Offline ${info.project.name} ${Date.now()}`;
  expect((await page.request.post("/api/contatos", { data: { nome }, headers: { "x-csrf-token": csrf } })).status()).toBe(201);
  await page.goto("/contatos");
  await expect(page.getByText(nome, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open("mg-dados")).keys()).some((r) => r.url.includes("/api/contatos")))).toBe(true);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByText(/Sem conexão com a internet/)).toBeVisible();
  await expect(page.getByText(nome, { exact: true }).first()).toBeVisible();
  await page.context().setOffline(false);

  // Avisos no celular: sem as chaves da plataforma, a tela explica que ficam no sino.
  await page.goto("/notificacoes");
  await expect(page.getByText(/ainda não foram configurados/)).toBeVisible();

  await abrirMenu(page);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByLabel("Senha")).toBeVisible();
  // Nada da pessoa fica no aparelho (só a marca pública da tela de entrada pode voltar ao cache).
  const guardados = await page.evaluate(async () => ((await caches.has("mg-dados")) ? (await (await caches.open("mg-dados")).keys()).map((r) => new URL(r.url).pathname) : []));
  expect(guardados.filter((p) => p !== "/api/marca")).toEqual([]);
});
