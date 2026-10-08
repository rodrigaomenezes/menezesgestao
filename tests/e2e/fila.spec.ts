// Fila de ligações e telefone, nas cinco larguras: discador no modo treino, celular do vendedor com conversão
// para o funil, histórico automático e telas de configuração.
import { expect, test, type Page } from "@playwright/test";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

const PROJETOS = ["celular-360", "celular-390", "tablet-768", "notebook-1024", "computador-1440"];

async function api<T = { id: string }>(page: Page, metodo: "POST" | "PUT" | "PATCH", url: string, data: unknown): Promise<T> {
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.fetch(url, { method: metodo, headers: { "x-csrf-token": csrf }, data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json() as Promise<T>;
}

/** Fila nova com N contatos (sem dono), só desta largura. */
async function prepararFila(page: Page, nome: string, n: number, projeto: string): Promise<{ filaId: string; nomes: string[] }> {
  const k = PROJETOS.indexOf(projeto) + 1;
  const fila = await api(page, "POST", "/api/filas", { nome });
  const nomes: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const nomeContato = `Lead ${projeto} ${nome.slice(0, 6)} ${i}`;
    const c = await api(page, "POST", "/api/contatos", { nome: nomeContato, telefone: `(41) 9${k}${i}${String(Date.now()).slice(-2)}-${String(Date.now() + i).slice(-4)}` });
    ids.push(c.id);
    nomes.push(nomeContato);
  }
  await api(page, "POST", `/api/filas/${fila.id}/itens`, { contatoIds: ids });
  return { filaId: fila.id, nomes };
}

test("discador no modo treino: pega o próximo, liga, registra o resultado e já traz o seguinte", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const { filaId, nomes } = await prepararFila(page, `Treino ${Date.now()}`, 2, info.project.name);

  await page.goto(`/filas/${filaId}`);
  await page.getByLabel("Ligar por").selectOption("treino");
  await page.getByRole("button", { name: "Pegar o próximo" }).click();
  const discador = page.getByRole("region", { name: "Discador" });
  await expect(discador.getByRole("link", { name: nomes[0] })).toBeVisible();
  await semRolagemLateral(page);

  await page.getByRole("button", { name: "Ligar agora" }).click();
  const painel = page.getByRole("dialog", { name: "Ligação em andamento" });
  await expect(painel).toBeVisible();
  await painel.getByRole("button", { name: "Simular: atendeu" }).click();
  await expect(painel.getByText(/Em ligação/)).toBeVisible();
  await semRolagemLateral(page);
  await painel.getByRole("button", { name: "Desligar" }).click();
  await expect(painel.getByText("Registre o resultado na fila.")).toBeVisible();
  await painel.getByRole("button", { name: "Fechar" }).click();

  await page.getByRole("button", { name: "Atendeu — conversa feita" }).click();
  await expect(page.getByText("Resultado registrado.")).toBeVisible();
  // "Pegar o próximo sozinho" está marcado: o segundo contato aparece.
  await expect(discador.getByRole("link", { name: nomes[1] })).toBeVisible();

  // A ligação está no histórico do primeiro contato, sem ninguém digitar.
  const contatoId = (await (await page.request.get(`/api/filas/${filaId}/itens?status=concluido`)).json()).itens[0].contatoId;
  const historico = (await (await page.request.get(`/api/contatos/${contatoId}/historico`)).json()).itens.map((h: { tipo: string }) => h.tipo);
  expect(historico).toEqual(expect.arrayContaining(["ligacao.encerrada", "fila.resultado_registrado"]));
});

test("celular do vendedor: informa como foi ao voltar e converte para o funil", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const { filaId, nomes } = await prepararFila(page, `Celular ${Date.now()}`, 1, info.project.name);

  await page.goto(`/filas/${filaId}`);
  await page.getByLabel("Ligar por").selectOption("celular");
  await page.getByRole("button", { name: "Pegar o próximo" }).click();
  await expect(page.getByRole("region", { name: "Discador" }).getByRole("link", { name: nomes[0] })).toBeVisible();
  await page.getByRole("button", { name: "Ligar agora" }).click();
  const painel = page.getByRole("dialog", { name: "Ligação em andamento" });
  await expect(painel.getByText(/Ligando pelo celular/)).toBeVisible();
  await painel.getByLabel("Duração (minutos)").fill("3");
  await painel.getByRole("button", { name: "Atendeu", exact: true }).click();
  await expect(painel.getByText(/Encerrada/)).toBeVisible();
  await painel.getByRole("button", { name: "Fechar" }).click();

  await page.getByRole("button", { name: "Convertido" }).click();
  await expect(page.getByText("Convertido! Oportunidade criada no funil.")).toBeVisible();
  const lig = (await (await page.request.get("/api/ligacoes?limite=5")).json()).itens.find((l: { contatoNome: string }) => l.contatoNome === nomes[0]);
  expect(lig).toMatchObject({ provedor: "celular", estado: "encerrada", resultadoNome: "Convertido" });
  expect(lig.duracaoSegundos).toBeGreaterThanOrEqual(179);
});

test("telas de fila, ligações e configuração cabem na largura do aparelho", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  for (const [item, titulo] of [
    ["Fila de ligações", "Fila de ligações"],
    ["Ligações", "Ligações"],
    ["Configurar telefonia", "Configurar telefonia"],
  ]) {
    await abrirMenu(page);
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: item, exact: true }).click();
    await expect(page.getByRole("heading", { name: titulo, level: 1 })).toBeVisible();
    await semRolagemLateral(page);
  }
});

test("da ficha do contato, Ligar abre o painel e o resultado vai para o histórico", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const k = PROJETOS.indexOf(info.project.name) + 1;
  const contato = await api(page, "POST", "/api/contatos", { nome: `Ficha Ligação ${info.project.name}`, telefone: `(51) 9${k}777-${String(Date.now()).slice(-4)}` });
  // A forma de ligar é escolhida na tela de ligações e vale enquanto a tela estiver aberta.
  await page.goto("/ligacoes");
  await page.getByLabel("Ligar por").selectOption("treino");
  await abrirMenu(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Alunos", exact: true }).click();
  await page.getByLabel("Buscar por nome, telefone ou e-mail").fill(`Ficha Ligação ${info.project.name}`);
  await page.getByLabel("Buscar por nome, telefone ou e-mail").press("Enter");
  await page.getByRole("link", { name: `Ficha Ligação ${info.project.name}` }).click();
  await page.getByRole("button", { name: /^Ligar / }).click();
  const painel = page.getByRole("dialog", { name: "Ligação em andamento" });
  await painel.getByRole("button", { name: "Simular: não atendeu" }).click();
  await painel.getByLabel("Resultado").selectOption({ label: "Caixa postal" });
  await painel.getByLabel("Observação").fill("Tentar à tarde");
  await painel.getByRole("button", { name: "Salvar" }).click();
  await expect(painel).toBeHidden();
  await expect(page.getByRole("region", { name: "Histórico" }).getByText(/não atendida/)).toBeVisible();
  expect((await (await page.request.get(`/api/ligacoes?contatoId=${contato.id}`)).json()).itens[0]).toMatchObject({ resultadoNome: "Caixa postal", observacao: "Tentar à tarde" });
});
