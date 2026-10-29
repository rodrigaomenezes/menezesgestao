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
  // Com canal conectado, "Conversar" abre a conversa no sistema; sem canal, o link do WhatsApp.
  await expect(page.getByRole("button", { name: "Conversar" }).or(page.getByRole("link", { name: "WhatsApp" }))).toBeVisible();
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

test("filtros das listas ficam no endereço: busca, ficha e voltar mantêm o recorte", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const nome = `Busca Endereço ${info.project.name}`;
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.post("/api/contatos", { headers: { "x-csrf-token": csrf }, data: { nome, telefone: telefoneUnico(info.project.name, 7) } });
  expect(r.status()).toBe(201);
  await page.goto("/contatos");
  await page.getByLabel("Buscar por nome, telefone ou e-mail").fill(nome);
  await page.getByLabel("Buscar por nome, telefone ou e-mail").press("Enter");
  await expect(page).toHaveURL(/busca=/);
  await page.getByRole("link", { name: nome }).click();
  await page.goBack();
  await expect(page.getByLabel("Buscar por nome, telefone ou e-mail")).toHaveValue(nome);
  await expect(page.getByRole("link", { name: nome })).toBeVisible();
  // Sem resultado: a lista vazia oferece limpar os filtros.
  await page.goto("/contatos?busca=ninguem-com-esse-nome-xyz");
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page).not.toHaveURL(/busca=/);
  await page.goto("/tarefas?situacao=concluidas");
  await expect(page.getByRole("tab", { name: "Concluídas" })).toHaveAttribute("aria-selected", "true");
  await semRolagemLateral(page);
});

test("telefone repetido não cria outro cadastro: aviso com “Abrir o existente” (D-18)", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const telefone = telefoneUnico(info.project.name, 8);
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const r = await page.request.post("/api/contatos", { headers: { "x-csrf-token": csrf }, data: { nome: `Original ${info.project.name}`, telefone } });
  expect(r.status()).toBe(201);
  const existente = (await r.json()).id as string;

  await irPara(page, "Alunos", "Alunos");
  await page.getByRole("button", { name: "Novo aluno" }).click();
  await page.getByLabel("Nome", { exact: true }).fill(`Repetido ${info.project.name}`);
  // Mesmo número em outro formato: continua sendo o mesmo telefone.
  await page.getByLabel("Telefone (WhatsApp)").fill(`+55 ${telefone}`);
  await page.getByRole("button", { name: "Cadastrar aluno" }).click();
  const aviso = page.locator(".mensagem-aviso");
  await expect(aviso).toContainText("Já existe");
  await semRolagemLateral(page);
  await aviso.getByRole("link", { name: "Abrir o existente" }).click();
  await expect(page).toHaveURL(new RegExp(`/contatos/${existente}`));
});

test("erro do servidor aparece no próprio campo e o foco vai para ele (RC-01)", async ({ page }) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  await irPara(page, "Alunos", "Alunos");
  await page.getByRole("button", { name: "Novo aluno" }).click();
  // Só espaços passa pelo "obrigatório" do navegador, mas o servidor recusa o nome vazio.
  await page.getByLabel("Nome", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Cadastrar aluno" }).click();
  const nome = page.getByLabel("Nome", { exact: true });
  await expect(nome).toHaveAttribute("aria-invalid", "true");
  await expect(nome).toBeFocused();
  await expect(page.locator(".erro-campo").first()).toBeVisible();
});

test("CPF mascarado na ficha, “Mostrar” para quem pode, e exportação com finalidade baixa a planilha", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  // CPFs válidos diferentes por largura (o documento também não pode repetir).
  const cpfs = ["52998224725", "11144477735", "39053344705", "15350946056", "71428793860"];
  const cpf = cpfs[["celular-360", "celular-390", "tablet-768", "notebook-1024", "computador-1440"].indexOf(info.project.name)]!;
  const nome = `Documento ${info.project.name}`;
  const r = await page.request.post("/api/contatos", { headers: { "x-csrf-token": csrf }, data: { nome, telefone: telefoneUnico(info.project.name, 9), documento: cpf } });
  expect(r.status(), await r.text()).toBe(201);

  await page.goto(`/contatos/${(await r.json()).id}`);
  await expect(page.getByText(`•••.•••.${cpf.slice(6, 9)}-${cpf.slice(9)}`)).toBeVisible();
  await page.getByRole("button", { name: "Mostrar" }).click();
  await expect(page.getByText(`${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`)).toBeVisible();
  await expect(page.getByText("visualização registrada na auditoria")).toBeVisible();
  await semRolagemLateral(page);

  await page.goto(`/contatos?busca=${encodeURIComponent(nome)}`);
  await page.getByRole("button", { name: "Exportar" }).click();
  const modal = page.getByRole("dialog", { name: "Exportar alunos" });
  await expect(modal.getByRole("button", { name: "Baixar planilha" })).toBeDisabled();
  await modal.getByLabel("Para que é esta exportação?").selectOption({ label: "Relatório interno" });
  const download = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Baixar planilha" }).click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/^contatos-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect(page.getByText("Planilha gerada.")).toBeVisible();
});

test("outros telefones e endereços na ficha: incluir, tornar principal e endereço principal (RF-CRM-002)", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const principal = telefoneUnico(info.project.name, 7);
  const extra = telefoneUnico(info.project.name, 8);
  const r = await page.request.post("/api/contatos", { headers: { "x-csrf-token": csrf }, data: { nome: `Extras ${info.project.name}`, telefone: principal } });
  expect(r.status(), await r.text()).toBe(201);
  await page.goto(`/contatos/${(await r.json()).id}`);

  const canais = page.getByRole("region", { name: "Outros telefones e e-mails" });
  await expect(canais.getByText("Só o telefone e o e-mail principais.")).toBeVisible();
  await canais.getByLabel("Número").fill(extra);
  await canais.getByRole("button", { name: "Incluir" }).click();
  await expect(canais.getByText("Telefone · Celular")).toBeVisible();
  await expect(canais.getByText("1 de 10")).toBeVisible();
  await canais.getByRole("button", { name: "Tornar principal" }).click();
  await expect(page.getByText("Agora este é o telefone principal.")).toBeVisible();
  // O principal de antes virou o extra.
  await expect(canais.getByText(principal, { exact: true })).toBeVisible();

  const enderecos = page.getByRole("region", { name: "Endereços" });
  await enderecos.getByRole("button", { name: "Incluir endereço" }).click();
  await enderecos.getByLabel("Rua ou avenida").fill("Rua das Acácias");
  await enderecos.getByLabel("Número").fill("42");
  await enderecos.getByLabel("Cidade").fill("Curitiba");
  await enderecos.getByLabel("Estado (UF)").selectOption("PR");
  await enderecos.getByLabel("CEP").fill("8001");
  await enderecos.getByRole("button", { name: "Salvar endereço" }).click();
  // CEP incompleto: erro no próprio campo.
  await expect(enderecos.getByLabel("CEP")).toHaveAttribute("aria-invalid", "true");
  await enderecos.getByLabel("CEP").fill("80010-000");
  await enderecos.getByRole("button", { name: "Salvar endereço" }).click();
  await expect(enderecos.getByText("Rua das Acácias, 42")).toBeVisible();
  await expect(enderecos.getByText("Residencial · principal")).toBeVisible();
  await semRolagemLateral(page);
});

test("duplicados e fusão em 3 passos: escolher quem fica, campo a campo, conferir e fundir (RF-CRM-004/008)", async ({ page }, info) => {
  const { a } = dados();
  await entrar(page, pessoa(a, "dono").email);
  const csrf = (await page.context().cookies()).find((c) => c.name === "mg_csrf")?.value ?? "";
  const emailComum = `fusao-${info.project.name}-${Date.now()}@exemplo.com.br`;
  const criar = async (nome: string, telefone: string) => {
    const r = await page.request.post("/api/contatos", { headers: { "x-csrf-token": csrf }, data: { nome, telefone, email: emailComum } });
    expect(r.status(), await r.text()).toBe(201);
    return (await r.json()).id as string;
  };
  const telFica = telefoneUnico(info.project.name, 5);
  const telSai = telefoneUnico(info.project.name, 6);
  const fica = await criar(`Fica ${info.project.name}`, telFica);
  const sai = await criar(`Sai ${info.project.name}`, telSai);

  await page.goto("/contatos");
  await page.getByRole("link", { name: "Possíveis duplicados" }).click();
  await expect(page.getByRole("heading", { name: "Possíveis duplicados", level: 1 })).toBeVisible();
  await semRolagemLateral(page);

  await page.goto(`/contatos/fundir?a=${fica}&b=${sai}`);
  await expect(page.getByRole("radio", { name: new RegExp(`Fica ${info.project.name}`) })).toBeChecked();
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  // Passo 2: os dois têm nome e telefone diferentes; o telefone que fica é o do cadastro que sai.
  await page.getByRole("group", { name: "Telefone principal" }).getByRole("radio", { name: telSai }).check();
  await semRolagemLateral(page);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("region", { name: "Passo 3: conferir e fundir" }).getByText(telSai)).toBeVisible();
  await page.getByRole("button", { name: "Fundir cadastros" }).click();

  await expect(page).toHaveURL(new RegExp(`/contatos/${fica}$`));
  await expect(page.getByText("Cadastros fundidos. O histórico dos dois está aqui.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Outros telefones e e-mails" }).getByText(telFica, { exact: true })).toBeVisible();
  await page.goto(`/contatos/${sai}`);
  await expect(page.getByRole("link", { name: "Abrir o cadastro que ficou" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restaurar" })).toHaveCount(0);
});
