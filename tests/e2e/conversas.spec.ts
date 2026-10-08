// Conversas no navegador, nas cinco larguras, em modo demonstração: canal, cliente simulado, caixa de entrada,
// resposta entregue, nota interna e resposta rápida com variável.
import { expect, test, type Page } from "@playwright/test";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

const PROJETOS = ["celular-360", "celular-390", "tablet-768", "notebook-1024", "computador-1440"];

async function api(page: Page, metodo: "POST" | "PUT", url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.fetch(url, { method: metodo, headers: { "x-csrf-token": csrf }, data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}

test("canal de demonstração: cliente escreve, a conversa aparece e a resposta é entregue", async ({ page }, info) => {
  const { a } = dados();
  const n = PROJETOS.indexOf(info.project.name) + 1;
  const sufixo = String(Date.now()).slice(-4);
  const telefone = `(11) 9${n}555-${sufixo}`;
  const cliente = `Cliente ${info.project.name}`;
  await entrar(page, pessoa(a, "dono").email);

  // Administração: cria e conecta o canal; o simulador faz o papel do celular do cliente.
  await abrirMenu(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Canais e automações" }).click();
  await expect(page.getByRole("heading", { name: "Canais e automações", level: 1 })).toBeVisible();
  await page.getByLabel("Nome do canal").fill(`Demo ${info.project.name}`);
  await page.getByLabel("Tipo de conexão").selectOption("demonstracao");
  await page.getByRole("button", { name: "Criar canal" }).click();
  const canal = page.getByRole("listitem").filter({ hasText: `Demo ${info.project.name}` });
  await canal.getByRole("button", { name: "Conectar" }).click();
  await expect(canal.getByText("Conectado", { exact: true })).toBeVisible();
  await semRolagemLateral(page);

  await canal.getByRole("button", { name: "Simular cliente" }).click();
  await canal.getByLabel("Telefone do cliente").fill(telefone);
  await canal.getByLabel("Nome (opcional)").fill(cliente);
  await canal.getByLabel("Mensagem").fill("Oi, quero saber o preço do curso");
  await canal.getByRole("button", { name: "Simular mensagem do cliente" }).click();
  await expect(page.getByText("Mensagem simulada recebida")).toBeVisible();

  // Caixa de entrada.
  await abrirMenu(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Conversas", exact: true }).click();
  await page.getByLabel("Buscar por nome ou telefone").fill(cliente);
  await page.getByLabel("Buscar por nome ou telefone").press("Enter");
  await page.getByRole("link", { name: new RegExp(cliente) }).click();
  const chat = page.getByRole("region", { name: `Conversa com ${cliente}` });
  await expect(chat.getByText("Oi, quero saber o preço do curso")).toBeVisible();
  await semRolagemLateral(page);

  await chat.getByLabel("Mensagem").fill("Olá! O curso sai por R$ 300 por mês.");
  await chat.getByRole("button", { name: "Enviar", exact: true }).click();
  const balao = chat.getByRole("listitem").filter({ hasText: "O curso sai por R$ 300" });
  await expect(balao.getByLabel("Entregue")).toBeVisible({ timeout: 15_000 });

  // Nota interna: fica marcada e não vai para o cliente.
  await chat.getByRole("checkbox", { name: "Nota interna" }).check();
  await chat.getByRole("textbox", { name: "Nota interna" }).fill("Cliente sensível a preço");
  await chat.getByRole("button", { name: "Salvar nota" }).click();
  await expect(chat.getByRole("listitem").filter({ hasText: "Cliente sensível a preço" }).getByText(/Nota interna/)).toBeVisible();

  // O cliente responde: cai na mesma conversa, em tempo real.
  const canalId = (await (await page.request.get("/api/canais")).json()).find((c: { nome: string }) => c.nome === `Demo ${info.project.name}`).id;
  await api(page, "POST", `/api/canais/${canalId}/simular`, { telefone, texto: "Fechado, quero me matricular!" });
  await expect(chat.getByText("Fechado, quero me matricular!")).toBeVisible({ timeout: 15_000 });
  await semRolagemLateral(page);
});

test("resposta rápida: / + atalho preenche o texto com as variáveis", async ({ page }, info) => {
  const { a } = dados();
  const n = PROJETOS.indexOf(info.project.name) + 1;
  await entrar(page, pessoa(a, "dono").email);
  const atalho = `oi${n}${String(Date.now()).slice(-5)}`;
  await api(page, "POST", "/api/respostas-rapidas", { atalho, texto: "Olá, {nome}! Aqui é {vendedor}." });
  const canal = await api(page, "POST", "/api/canais", { nome: `Rápidas ${info.project.name}`, provedor: "demonstracao" });
  await api(page, "POST", `/api/canais/${canal.id}/conectar`, {});
  await api(page, "POST", `/api/canais/${canal.id}/simular`, { telefone: `(21) 9${n}444-${String(Date.now()).slice(-4)}`, nome: "Joana Prado", texto: "oi" });

  await page.goto("/conversas");
  await page.getByLabel("Buscar por nome ou telefone").fill("Joana Prado");
  await page.getByLabel("Buscar por nome ou telefone").press("Enter");
  await page.getByRole("link", { name: /Joana Prado/ }).first().click();
  const campo = page.getByLabel("Mensagem");
  await campo.fill(`/${atalho}`);
  await expect(page.getByRole("option", { name: new RegExp(atalho) })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(atalho) }).click();
  await expect(campo).toHaveValue(/^Olá, Joana! Aqui é Dona\./);
});

test("da ficha do contato, Conversar abre a conversa no canal conectado", async ({ page }, info) => {
  const { a } = dados();
  const n = PROJETOS.indexOf(info.project.name) + 1;
  await entrar(page, pessoa(a, "dono").email);
  const canal = await api(page, "POST", "/api/canais", { nome: `Ficha ${info.project.name}`, provedor: "demonstracao" });
  await api(page, "POST", `/api/canais/${canal.id}/conectar`, {});
  const contato = await api(page, "POST", "/api/contatos", { nome: `Contato Ficha ${info.project.name}`, telefone: `(31) 9${n}333-${String(Date.now()).slice(-4)}` });
  await page.goto(`/contatos/${contato.id}`);
  const conversar = page.getByRole("button", { name: "Conversar" });
  await expect(conversar).toBeVisible();
  // Com mais de um canal conectado, escolhe o canal antes (o botão só habilita depois).
  const escolha = page.getByLabel("Canal", { exact: true });
  if (await escolha.count()) await escolha.selectOption({ label: `Ficha ${info.project.name}` });
  await conversar.click();
  await expect(page.getByRole("region", { name: `Conversa com Contato Ficha ${info.project.name}` })).toBeVisible();
  await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]{36}$/);
});
