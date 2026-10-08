import { expect, test } from "@playwright/test";
import { abrirMenu, dados, entrar, linkDoEmail, pessoa, semRolagemLateral } from "./apoio.js";

test("login funciona e as telas cabem na largura do aparelho", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  await expect(page.getByText(a.nome)).toBeVisible();
  await semRolagemLateral(page);

  for (const [item, titulo] of [
    ["Usuários", "Usuários"],
    ["Equipes", "Equipes"],
    ["Perfis e permissões", "Perfis e permissões"],
    ["Unidades", "Unidades"],
    ["Empresa e marca", "Empresa e marca"],
    ["Auditoria", "Auditoria"],
    ["Meus dispositivos", "Meus dispositivos"],
  ]) {
    await abrirMenu(page);
    await page.getByRole("link", { name: item, exact: true }).click();
    await expect(page.getByRole("heading", { name: titulo, level: 1 })).toBeVisible();
    await semRolagemLateral(page);
  }
});

test("senha errada mostra mensagem clara", async ({ page }) => {
  const { a } = dados();
  await page.goto("/");
  await page.getByLabel("E-mail").fill(pessoa(a, "gestor").email);
  await page.getByLabel("Senha").fill("senha errada demais");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toContainText("E-mail ou senha incorretos");
});

test("vendedor não vê a administração e não enxerga outra empresa", async ({ page }) => {
  const { a, b } = dados();
  await entrar(page, pessoa(a, "vendedor").email);
  await abrirMenu(page);
  const menu = page.getByRole("navigation", { name: "Menu principal" });
  await expect(menu.getByRole("link", { name: "Notificações" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Usuários" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Auditoria" })).toHaveCount(0);

  await page.goto("/usuarios");
  await expect(page.getByRole("alert")).toContainText("não tem acesso");
  await expect(page.getByText(b.nome)).toHaveCount(0);
});

test("convite: a pessoa cria a senha pelo link e entra; quem convidou é avisado na hora", async ({ page, browser }, info) => {
  const { a } = dados();
  const novo = `convite.${info.project.name}.${Date.now()}@teste.example.com`;
  await entrar(page, pessoa(a, "dono").email);
  await page.goto("/usuarios");
  const sino = page.getByRole("link", { name: /^Notificações: \d+/ });
  const { naoLidas: antes } = (await (await page.request.get("/api/notificacoes?limite=1")).json()) as { naoLidas: number };
  await page.getByRole("button", { name: "Convidar pessoa" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Pessoa Convidada");
  await page.getByLabel("E-mail", { exact: true }).fill(novo);
  await page.getByLabel("Perfil", { exact: true }).selectOption({ label: "Vendedor / Atendente" });
  await page.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.getByText(`Convite enviado para ${novo}.`)).toBeVisible();
  await expect(page.getByText("Convite pendente")).toBeVisible();

  const contexto = await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL });
  const convidada = await contexto.newPage();
  await convidada.goto(await linkDoEmail(novo));
  await expect(convidada.getByText(a.nome)).toBeVisible();
  await convidada.getByLabel("Crie uma senha").fill("minha senha nova e longa");
  await convidada.getByRole("button", { name: "Aceitar e entrar" }).click();
  await expect(convidada.getByRole("heading", { name: "Olá, Pessoa!" })).toBeVisible();
  await expect(convidada.getByRole("main").getByText("Vendedor / Atendente")).toBeVisible();
  await contexto.close();

  // O sino de quem convidou atualiza em tempo real.
  await expect(sino).toHaveAttribute("aria-label", `Notificações: ${antes + 1} não lida(s)`);
});

test("esqueci a senha: o link permite criar uma nova", async ({ page }, info) => {
  const { b } = dados();
  const alvo = pessoa(b, info.project.name === "celular" ? "gestor" : "vendedor").email;
  await page.goto("/esqueci-senha");
  await page.getByLabel("E-mail").fill(alvo);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(page.getByText(/Se o e-mail estiver cadastrado/)).toBeVisible();

  await page.goto(await linkDoEmail(alvo));
  await page.getByLabel("Nova senha").fill("outra senha bem comprida");
  await page.getByLabel("Repita a senha").fill("outra senha bem comprida");
  await page.getByRole("button", { name: "Salvar senha" }).click();
  await expect(page.getByText(/Senha criada/)).toBeVisible();
  await entrar(page, alvo, "outra senha bem comprida");
});

test("quem está em duas empresas troca sem sair", async ({ page }) => {
  const { a, b } = dados();
  await entrar(page, pessoa(a, "consultor").email);
  const principal = page.getByRole("main");
  await expect(principal.getByText(a.nome)).toBeVisible();
  await abrirMenu(page);
  await page.getByLabel("Empresa").selectOption({ label: b.nome });
  await expect(principal.getByText(b.nome)).toBeVisible();
  await expect(principal.getByText("Financeiro")).toBeVisible();
});

test("app instalável: manifesto e service worker", async ({ page, request }) => {
  const manifesto = await (await request.get("/manifest.webmanifest")).json();
  expect(manifesto).toMatchObject({ display: "standalone", start_url: "/", lang: "pt-BR" });
  expect(manifesto.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icone of manifesto.icons) expect((await request.get(icone.src)).ok()).toBe(true);

  await page.goto("/");
  const ativo = await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.ready;
    return Boolean(registro.active);
  });
  expect(ativo).toBe(true);
});
