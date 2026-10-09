// Operação nas cinco larguras: rotina no Início (ponto, check-list, metas), horas com validação e fechamento do
// mês, desempenho e mapa de atividades, scripts dentro da ligação e telas que cabem no celular.
import { expect, test, type Page } from "@playwright/test";
import { abrirMenu, dados, entrar, pessoa, semRolagemLateral } from "./apoio.js";

const PROJETOS = ["celular-360", "celular-390", "tablet-768", "notebook-1024", "computador-1440"];
const INDICADORES = ["ligacoes", "mensagens", "contatos_novos", "tarefas_concluidas", "resultados_fila"];
const NOMES = ["Ligações feitas", "Mensagens enviadas", "Contatos cadastrados", "Tarefas concluídas", "Resultados na fila"];

async function api<T = { id: string }>(page: Page, metodo: "GET" | "POST" | "PUT" | "PATCH", url: string, data?: unknown): Promise<{ status: number; json: T }> {
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.fetch(url, { method: metodo, headers: { "x-csrf-token": csrf }, data });
  return { status: r.status(), json: (await r.json()) as T };
}

async function idDe(page: Page, nome: string): Promise<string> {
  const mes = new Date().toISOString().slice(0, 7);
  const r = await api<{ itens: { usuarioId: string; nome: string }[] }>(page, "GET", `/api/horas/resumo?mes=${mes}&limite=100`);
  const p = r.json.itens.find((i) => i.nome === nome);
  if (!p) throw new Error(`pessoa ${nome}`);
  return p.usuarioId;
}

test("rotina no Início: ponto, check-list do dia e metas", async ({ page }, info) => {
  const k = PROJETOS.indexOf(info.project.name);
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const item = `Conferir pendências ${info.project.name}`;
  expect((await api(page, "POST", "/api/checklist", { texto: item })).status).toBe(201);
  const donaId = await idDe(page, "Dona A");
  expect((await api(page, "POST", "/api/metas", { alvo: "pessoa", usuarioId: donaId, indicador: INDICADORES[k], periodo: "dia", valor: 5 })).status).toBe(201);

  await page.goto("/");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page.getByText(/^Trabalhando desde/)).toBeVisible();
  await page.getByRole("button", { name: "Registrar saída" }).click();
  await expect(page.getByText("Ponto fechado")).toBeVisible();

  await page.getByLabel(item).check();
  await page.reload();
  await expect(page.getByLabel(item)).toBeChecked();
  await expect(page.getByRole("region", { name: "Minhas metas" }).getByText(`${NOMES[k]} — Dona A`)).toBeVisible();
  await semRolagemLateral(page);
});

test("horas: o gestor valida, o administrador fecha o mês e nada muda depois", async ({ page }, info) => {
  const k = PROJETOS.indexOf(info.project.name) + 1;
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const vendedorId = await idDe(page, "Vendedor A1");
  // Um mês diferente por largura (k meses atrás).
  const base = new Date();
  const alvo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - k, 10));
  const dia = alvo.toISOString().slice(0, 10);
  const r = await api<{ id: string }>(page, "POST", "/api/horas", { usuarioId: vendedorId, entrada: `${dia}T11:00:00Z`, saida: `${dia}T20:00:00Z`, observacao: `Plantão ${info.project.name}` });
  expect(r.status).toBe(201);

  await page.goto("/horas");
  for (let i = 0; i < k; i++) await page.getByRole("button", { name: "Mês anterior" }).click();
  await page.getByRole("tab", { name: "Equipe" }).click();
  const pendente = page.getByRole("region", { name: "Aguardando validação" }).getByRole("listitem").filter({ hasText: `Plantão ${info.project.name}` });
  await expect(pendente).toBeVisible();
  await semRolagemLateral(page);
  await pendente.getByRole("button", { name: "Validar" }).click();
  await expect(page.getByText("Horas validadas.")).toBeVisible();

  await page.getByRole("tab", { name: "Fechamento" }).click();
  await page.getByRole("button", { name: /^Fechar / }).click();
  await expect(page.getByText(/fechado\. Os registros do mês não podem mais ser alterados\./)).toBeVisible();
  await semRolagemLateral(page);

  // Mês fechado: nem o administrador altera o registro.
  const tentativa = await api<{ error: { code: string; message: string } }>(page, "PATCH", `/api/horas/${r.json.id}`, { observacao: "mudei" });
  expect(tentativa.status).toBe(409);
  expect(tentativa.json.error.code).toBe("PERIODO_FECHADO");
});

test("desempenho com meta definida na tela e mapa com atividade lançada à mão", async ({ page }, info) => {
  const k = PROJETOS.indexOf(info.project.name);
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);

  await page.goto("/desempenho");
  await expect(page.getByRole("heading", { name: "Desempenho e metas", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Nova meta" }).click();
  const form = page.getByRole("form", { name: "Nova meta" });
  await form.getByLabel("Pessoa").selectOption({ label: "Vendedor A1" });
  await form.getByLabel("Indicador").selectOption(INDICADORES[k]);
  await form.getByLabel("Período").selectOption("semana");
  await form.getByLabel("Meta").fill("12");
  await form.getByRole("button", { name: "Definir meta" }).click();
  await expect(page.getByText("Meta definida.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Metas" }).getByText(`${NOMES[k]} — Vendedor A1`).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Por pessoa" }).getByText("Vendedor A1")).toBeVisible();
  await semRolagemLateral(page);

  await page.goto("/mapa");
  const lancar = page.getByRole("form", { name: "Lançar atividade" });
  await lancar.getByLabel("Atividade").selectOption("treinamento");
  await lancar.getByLabel("Das").fill("07:00");
  await lancar.getByLabel("Até").fill("07:30");
  await lancar.getByRole("button", { name: "Lançar" }).click();
  await expect(page.getByText("Atividade lançada.")).toBeVisible();
  const linha = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Dona A" }) });
  await expect(linha.getByRole("cell", { name: /^7h: .*Treinamento/ })).toBeVisible();
  await semRolagemLateral(page);
});

test("script aberto de dentro da ligação, com o nome do contato", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const titulo = `Abertura ${info.project.name}`;
  await page.goto("/scripts");
  await page.getByRole("button", { name: "Novo script" }).click();
  await page.getByLabel("Título", { exact: true }).fill(titulo);
  await page.getByLabel("Texto do roteiro").fill("Oi {nome}, aqui é {vendedor}. Tudo bem?");
  await page.getByLabel("Onde usar").selectOption("ligacao");
  await page.getByRole("button", { name: "Criar script" }).click();
  await expect(page.getByText("Script criado.")).toBeVisible();
  await semRolagemLateral(page);

  const k = PROJETOS.indexOf(info.project.name) + 1;
  const nome = `Rafa Script ${info.project.name}`;
  const c = await api(page, "POST", "/api/contatos", { nome, telefone: `(31) 9${k}555-${String(Date.now()).slice(-4)}` });
  await page.goto("/ligacoes");
  await page.getByLabel("Ligar por").selectOption("treino");
  await abrirMenu(page);
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Alunos", exact: true }).click();
  await page.getByLabel("Buscar por nome, telefone ou e-mail").fill(nome);
  await page.getByLabel("Buscar por nome, telefone ou e-mail").press("Enter");
  await page.getByRole("link", { name: nome }).click();
  await expect(page).toHaveURL(new RegExp(c.json.id));
  await page.getByRole("button", { name: /^Ligar / }).click();
  const painel = page.getByRole("dialog", { name: "Ligação em andamento" });
  await painel.getByRole("button", { name: "Scripts" }).click();
  const modal = page.getByRole("dialog", { name: "Scripts" });
  const roteiro = modal.getByRole("listitem").filter({ hasText: titulo });
  await expect(roteiro.getByText(`Oi ${nome}, aqui é Dona A. Tudo bem?`)).toBeVisible();
  await semRolagemLateral(page);
  await modal.getByRole("button", { name: "Fechar" }).click();
  await painel.getByRole("button", { name: "Desligar" }).click();
});

test("agenda e telas da operação cabem na largura do aparelho", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  for (const [item, titulo] of [
    ["Agenda", "Agenda"],
    ["Horas", "Horas"],
    ["Desempenho e metas", "Desempenho e metas"],
    ["Mapa de atividades", "Mapa de atividades"],
    ["Scripts", "Scripts"],
    ["Configurar rotina", "Configurar rotina"],
  ]) {
    await abrirMenu(page);
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: item, exact: true }).click();
    await expect(page.getByRole("heading", { name: titulo, level: 1 })).toBeVisible();
    await semRolagemLateral(page);
  }

  await page.goto("/agenda");
  await page.getByRole("button", { name: "Novo compromisso" }).click();
  const titulo = `Reunião de equipe ${info.project.name}`;
  await page.getByLabel("O quê").fill(titulo);
  await page.getByRole("button", { name: "Marcar", exact: true }).click();
  await expect(page.getByText("Compromisso marcado.")).toBeVisible();
  await expect(page.getByText(new RegExp(`09:00–10:00 ${titulo}`))).toBeVisible();
  await semRolagemLateral(page);
});
