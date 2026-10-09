// Login em duas etapas na tela: liga pelo app autenticador, guarda os códigos, entra com o código,
// e a regra da empresa obriga quem ainda não configurou.
import { expect, test, type Page } from "@playwright/test";
import { codigoTotp, passoAtual } from "../../apps/api/src/infra/seguranca/totp.js";
import { abrirMenu, semRolagemLateral } from "./apoio.js";

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
