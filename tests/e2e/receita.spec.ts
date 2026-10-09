// Receita e qualidade nas cinco larguras: venda pela ficha (vira comissão), entrega com vagas, avaliação de
// ligação pelo gestor, pesquisa respondida pelo link público e telas que cabem no celular.
import { expect, test, type Page } from "@playwright/test";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

const PROJETOS = ["celular-360", "celular-390", "tablet-768", "notebook-1024", "computador-1440"];

async function api<T = { id: string }>(page: Page, metodo: "GET" | "POST" | "PATCH", url: string, data?: unknown): Promise<{ status: number; json: T }> {
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.fetch(url, { method: metodo, headers: { "x-csrf-token": csrf }, data });
  return { status: r.status(), json: (await r.json()) as T };
}

const telefone = (k: number, final: string) => `(61) 9${k}${final}-${String(Date.now()).slice(-4)}`;

test("venda registrada pela ficha do contato entra no histórico e na comissão do mês", async ({ page }, info) => {
  const k = PROJETOS.indexOf(info.project.name) + 1;
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const oferta = `Curso ${info.project.name}`;
  expect((await api(page, "POST", "/api/ofertas", { nome: oferta, precoCentavos: 150_000 })).status).toBe(201);
  const regras = await api<{ itens: { ofertaId: string | null }[] }>(page, "GET", "/api/comissoes/regras");
  if (!regras.json.itens.some((r) => r.ofertaId === null)) await api(page, "POST", "/api/comissoes/regras", { nome: "Geral 10%", tipo: "percentual", percentual: 10 });
  const nome = `Cliente Venda ${info.project.name}`;
  const c = await api(page, "POST", "/api/contatos", { nome, telefone: telefone(k, "333") });

  await page.goto(`/contatos/${c.json.id}`);
  const vendas = page.getByRole("region", { name: "Vendas" });
  await vendas.getByRole("button", { name: "Registrar venda" }).click();
  const form = page.getByRole("form", { name: "Registrar venda" });
  await form.getByLabel("Oferta").selectOption({ label: oferta });
  await expect(form.getByLabel("Valor (R$)")).toHaveValue("1500,00");
  await form.getByLabel("Pagamento", { exact: true }).selectOption("cartao");
  await form.getByLabel("Parcelas").fill("3");
  await form.getByLabel("Pagamento já confirmado").check();
  await semRolagemLateral(page);
  await form.getByRole("button", { name: "Registrar venda" }).click();
  await expect(page.getByText("Venda registrada e confirmada.")).toBeVisible();
  await expect(vendas.getByText(/R\$\s1\.500,00 · Curso/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Histórico" }).getByText("Venda registrada")).toBeVisible();

  await page.goto("/comissoes");
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await expect(page.getByRole("list", { name: "Comissões do mês" }).getByText(/^Dona A · /).first()).toBeVisible();
  await semRolagemLateral(page);
});

test("catálogo: entrega com vagas e participante incluído pela busca", async ({ page }, info) => {
  const k = PROJETOS.indexOf(info.project.name) + 1;
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const nomeContato = `Participante ${info.project.name}`;
  await api(page, "POST", "/api/contatos", { nome: nomeContato, telefone: telefone(k, "444") });
  const oferta = `Inglês ${info.project.name}`;
  await api(page, "POST", "/api/ofertas", { nome: oferta });

  await page.goto("/catalogo");
  await page.getByRole("button", { name: "Cadastrar entrega" }).click();
  const form = page.getByRole("form", { name: "Cadastrar entrega" });
  await form.getByLabel("Oferta").selectOption({ label: oferta });
  await form.getByLabel("Nome").fill(`Turma ${info.project.name}`);
  await form.getByLabel("Vagas (opcional)").fill("8");
  await form.getByRole("button", { name: "Criar" }).click();
  await expect(page.getByText("Cadastro salvo.")).toBeVisible();
  await semRolagemLateral(page);
  await page.getByRole("link", { name: `Turma ${info.project.name}` }).click();
  await expect(page.getByRole("heading", { name: `Turma ${info.project.name}`, level: 1 })).toBeVisible();
  await page.getByLabel("Incluir contato").fill(nomeContato);
  await page.getByRole("button", { name: nomeContato }).click();
  await page.getByRole("button", { name: "Incluir", exact: true }).click();
  await expect(page.getByText("Incluído.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Participantes" }).getByRole("link", { name: nomeContato })).toBeVisible();
  await expect(page.getByText("1 de 8")).toBeVisible();
  await semRolagemLateral(page);
});

test("qualidade: o gestor avalia a ligação do vendedor e a nota aparece", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "vendedor").email);
  const l = await api(page, "POST", "/api/ligacoes", { provedor: "treino", numero: "(11) 96666-1234" });
  await api(page, "POST", `/api/ligacoes/${l.json.id}/estado`, { estado: "encerrada" });
  await page.context().clearCookies();

  await entrar(page, pessoa(a, "gestor").email);
  await page.goto("/ligacoes");
  const item = page.getByRole("listitem").filter({ hasText: "Vendedor A1" }).first();
  await item.getByRole("button", { name: "Avaliar" }).click();
  const modal = page.getByRole("dialog", { name: "Avaliar atendimento" });
  await modal.getByLabel("Tratou objeções").selectOption("6");
  await modal.getByLabel("Feedback para a pessoa").fill("Bom trabalho; atenção às objeções.");
  await semRolagemLateral(page);
  await modal.getByRole("button", { name: "Enviar avaliação" }).click();
  // Pesos 1, 2, 2, 2, 1 com notas 10, 10, 10, 6, 10 → (10 + 20 + 20 + 12 + 10) / 8 = 9
  await expect(page.getByText("Avaliação enviada: nota 9.")).toBeVisible();
  await page.goto("/qualidade");
  await expect(page.getByText("Nota 9 · Vendedor A1").first()).toBeVisible();
  await semRolagemLateral(page);
});

test("pesquisa: criada na tela, respondida pelo link público sem login, resultado na hora", async ({ page, browser }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const titulo = `Satisfação ${info.project.name}`;
  await page.goto("/pesquisas");
  await page.getByRole("button", { name: "Nova pesquisa" }).click();
  await page.getByLabel("Título").fill(titulo);
  await page.getByLabel("Pergunta", { exact: true }).fill("Você recomendaria?");
  await page.getByLabel("Opções (uma por linha)").fill("Sim\nNão");
  await page.getByLabel("Obrigatória").check();
  await page.getByRole("button", { name: "Criar pesquisa" }).click();
  await expect(page.getByText(/Pesquisa criada/)).toBeVisible();
  await page.getByRole("link", { name: titulo }).click();
  const link = (await page.locator("code").textContent()) ?? "";
  expect(link).toMatch(/\/p\/[\w-]{20,}$/);

  const publico = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const cliente = await publico.newPage();
  await cliente.goto(new URL(link).pathname);
  await expect(cliente.getByRole("heading", { name: titulo })).toBeVisible();
  await expect(cliente.getByText(a.nome)).toBeVisible();
  await cliente.getByLabel("Sim").check();
  await cliente.getByRole("button", { name: "Enviar respostas" }).click();
  await expect(cliente.getByText("Obrigado! Sua resposta foi registrada.")).toBeVisible();
  await semRolagemLateral(cliente);
  await publico.close();

  await page.reload();
  await expect(page.getByText(/^1 resposta\(s\) · criada/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Você recomendaria?" }).getByText("1 (100%)")).toBeVisible();
  await semRolagemLateral(page);
});

test("telas de vendas, comissões, catálogo, qualidade e pesquisas cabem na largura do aparelho", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  for (const item of ["Vendas", "Comissões", "Catálogo", "Qualidade", "Pesquisas"]) {
    await abrirMenu(page);
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: item, exact: true }).click();
    await expect(page.getByRole("heading", { name: item, level: 1 })).toBeVisible();
    await semRolagemLateral(page);
  }
});
