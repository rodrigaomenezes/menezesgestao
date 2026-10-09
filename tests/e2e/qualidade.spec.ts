// Checklist de qualidade (Fase 7): as telas principais funcionam no modo escuro (texto legível, sem rolar
// para o lado) e só com o teclado (entrar, pular para o conteúdo, foco sempre visível).
import { expect, test, type Page } from "@playwright/test";
import { dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

const TELAS = ["/", "/contatos", "/funil", "/conversas", "/filas", "/agenda", "/desempenho", "/vendas", "/empresa", "/seguranca", "/notificacoes"];

/** Contraste WCAG entre o texto e o fundo do corpo da página. */
async function contraste(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const estilo = getComputedStyle(document.body);
    const [a, b] = [lum(rgb(estilo.color)), lum(rgb(estilo.backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

test("modo escuro: telas principais legíveis e sem rolagem lateral", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await entrar(page, pessoa(dados().a, "dono").email);
  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(fundo, "o fundo devia ficar escuro").not.toMatch(/rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)/);
  for (const tela of TELAS) {
    await page.goto(tela);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await contraste(page), `contraste em ${tela}`).toBeGreaterThanOrEqual(4.5);
    await semRolagemLateral(page);
  }
});

test("só com o teclado: entra, pula para o conteúdo e o foco aparece", async ({ page }) => {
  const { a, senha } = dados();
  await page.goto("/");
  await page.getByLabel("E-mail").focus();
  await page.keyboard.type(pessoa(a, "vendedor").email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(senha);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Olá/ })).toBeVisible();

  await page.keyboard.press("Tab");
  const pular = page.getByRole("link", { name: "Pular para o conteúdo" });
  await expect(pular).toBeFocused();
  await expect(pular).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#conteudo")).toBeFocused();

  // Daqui, o próximo Tab cai num controle da tela, com contorno de foco visível.
  await page.keyboard.press("Tab");
  const foco = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return { dentro: Boolean(el.closest("#conteudo")), contorno: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 };
  });
  expect(foco).toEqual({ dentro: true, contorno: true });
});
