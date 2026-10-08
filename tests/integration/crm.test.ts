// Critérios de pronto da fase 1 (CRM): importação idempotente, carteira por escopo, deduplicação pelo telefone,
// kanban com regras de etapa e evento, e lixeira que preserva o histórico.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";
import { importarCsv } from "../apoio/crm.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let config: { funis: { id: string; etapas: { id: string; nome: string; tipo: string }[] }[]; motivosPerda: { id: string }[] };

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  config = (await dono.get("/api/crm/configuracao")).json();
});
afterAll(() => t.fechar());

const contarPorTelefone = async (telefone: string) =>
  Number((await t.banco.pool.query("SELECT count(*) FROM contato WHERE empresa_id = $1 AND telefone = $2", [e.a.empresaId, telefone])).rows[0].count);

describe("empresa nova", () => {
  it("já nasce com o funil padrão e motivos de perda", () => {
    expect(config.funis.length).toBeGreaterThanOrEqual(1);
    const tipos = config.funis[0].etapas.map((x) => x.tipo);
    expect(tipos).toContain("ganha");
    expect(tipos).toContain("perdida");
    expect(config.motivosPerda.length).toBeGreaterThan(0);
  });
});

describe("importação", () => {
  const csv = ["Nome;Telefone;Cidade", "Ana Import;(11) 98888-1001;Santos", "Bruno Import;11 8888-1002;Santos", "Sem Telefone;;Santos", "Carla Import;+55 11 98888-1003;Santos", ""].join("\r\n");

  it("importar a mesma planilha duas vezes não duplica ninguém", async () => {
    const primeira = await importarCsv(dono, csv);
    expect(primeira.status).toBe("CONCLUIDA_COM_ERROS");
    expect(primeira.novos).toBe(3);
    expect(primeira.ignorados).toBe(1);
    expect(primeira.erros[0].linha).toBe(4);

    const segunda = await importarCsv(dono, csv);
    expect(segunda.novos).toBe(0);
    expect(segunda.inalterados).toBe(3);
    expect(await contarPorTelefone("+5511988881001")).toBe(1);
    // Fixo de 8 dígitos começando com 8 vira celular com o nono dígito.
    expect(await contarPorTelefone("+5511988881002")).toBe(1);
  });

  it("atualiza quem já existe quando o nome muda, sem duplicar", async () => {
    const r = await importarCsv(dono, "Nome,Telefone\nAna Importada Nova,5511988881001\n");
    expect(r.atualizados).toBe(1);
    expect(r.novos).toBe(0);
    const { rows } = await t.banco.pool.query("SELECT nome FROM contato WHERE empresa_id = $1 AND telefone = '+5511988881001'", [e.a.empresaId]);
    expect(rows).toEqual([{ nome: "Ana Importada Nova" }]);
  });

  it("recusa formato que não é planilha", async () => {
    const res = await dono.enviarArquivo("/api/importacoes", "foto.png", "x", "image/png");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/xlsx|csv/);
  });
});

describe("deduplicação pelo telefone", () => {
  it("com e sem o nono dígito é a mesma pessoa", async () => {
    const criado = await dono.post("/api/contatos", { nome: "Duda Dup", telefone: "(11) 97777-2001" });
    expect(criado.statusCode).toBe(201);
    expect(criado.json().telefone).toBe("+5511977772001");
    for (const outro of ["11 7777-2001", "+55 (11) 97777-2001", "011977772001"]) {
      const repetido = await dono.post("/api/contatos", { nome: "Duda de novo", telefone: outro });
      expect(repetido.statusCode, outro).toBe(409);
    }
    expect(await contarPorTelefone("+5511977772001")).toBe(1);
  });

  it("telefone inválido devolve mensagem clara", async () => {
    const res = await dono.post("/api/contatos", { nome: "Número Ruim", telefone: "123" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/telefone/i);
  });
});

describe("carteira por escopo", () => {
  let doVendedor1: string;

  beforeAll(async () => {
    const v1 = await logado(t.app, email(e.a, "vendedor"));
    const res = await v1.post("/api/contatos", { nome: "Cliente do Vendedor 1", telefone: "11 96666-3001" });
    expect(res.statusCode).toBe(201);
    doVendedor1 = res.json().id;
    expect(res.json().responsavelId).toBe(e.a.pessoas.vendedor.usuarioId);
  });

  it("vendedor não vê a carteira de outro vendedor", async () => {
    const v2 = await logado(t.app, email(e.a, "vendedor2"));
    expect((await v2.get(`/api/contatos/${doVendedor1}`)).statusCode).toBe(404);
    expect((await v2.patch(`/api/contatos/${doVendedor1}`, { nome: "Roubado" })).statusCode).toBe(404);
    const lista = await v2.get("/api/contatos?limite=100");
    expect(lista.body).not.toContain("Cliente do Vendedor 1");
    // Nem cadastrando o mesmo telefone ele descobre o contato do outro.
    const repetido = await v2.post("/api/contatos", { nome: "Outro", telefone: "11 96666-3001" });
    expect(repetido.statusCode).toBe(409);
    expect(repetido.body).not.toContain("Cliente do Vendedor 1");
  });

  it("vendedor não consegue passar contato para a carteira de outra pessoa fora do escopo", async () => {
    const v1 = await logado(t.app, email(e.a, "vendedor"));
    const res = await v1.post("/api/contatos/acoes", { ids: [doVendedor1], acao: "transferir", responsavelId: e.a.pessoas.vendedor2.usuarioId });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("gestor vê a carteira da equipe que coordena", async () => {
    const gestor = await logado(t.app, email(e.a, "gestor"));
    expect((await gestor.get(`/api/contatos/${doVendedor1}`)).statusCode).toBe(200);
  });

  it("financeiro só vê, não edita", async () => {
    const fin = await logado(t.app, email(e.a, "financeiro"));
    expect((await fin.get(`/api/contatos/${doVendedor1}`)).statusCode).toBe(200);
    expect((await fin.patch(`/api/contatos/${doVendedor1}`, { nome: "Mudado" })).statusCode).toBe(403);
    expect((await fin.post("/api/contatos/acoes", { ids: [doVendedor1], acao: "arquivar" })).statusCode).toBe(403);
  });
});

describe("kanban", () => {
  let oportunidadeId: string;
  const etapa = (tipo: string, n = 0) => config.funis[0].etapas.filter((x) => x.tipo === tipo)[n];

  beforeAll(async () => {
    const c = await dono.post("/api/contatos", { nome: "Kátia Kanban", telefone: "11 95555-4001" });
    const o = await dono.post("/api/oportunidades", { contatoId: c.json().id, funilId: config.funis[0].id, titulo: "Matrícula Kátia" });
    expect(o.statusCode).toBe(201);
    oportunidadeId = o.json().id;
    expect(o.json().etapaId).toBe(config.funis[0].etapas[0].id);
  });

  it("mover de etapa registra evento com a etapa anterior e a nova", async () => {
    const destino = etapa("aberta", 1);
    const res = await dono.post(`/api/oportunidades/${oportunidadeId}/etapa`, { etapaId: destino.id });
    expect(res.statusCode).toBe(200);
    const { rows } = await t.banco.pool.query(
      "SELECT dados FROM evento WHERE empresa_id = $1 AND tipo = 'oportunidade.etapa_alterada' AND entidade_id = $2",
      [e.a.empresaId, oportunidadeId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dados).toMatchObject({ etapaAnteriorId: config.funis[0].etapas[0].id, etapaNovaId: destino.id });
  });

  it("etapa com campo obrigatório bloqueia até preencher", async () => {
    const destino = etapa("aberta", 2);
    expect((await dono.patch(`/api/crm/etapas/${destino.id}`, { camposObrigatorios: ["valor"] })).statusCode).toBe(200);
    const bloqueado = await dono.post(`/api/oportunidades/${oportunidadeId}/etapa`, { etapaId: destino.id });
    expect(bloqueado.statusCode).toBe(400);
    expect(bloqueado.json().error.message).toMatch(/Valor/);
    await dono.patch(`/api/oportunidades/${oportunidadeId}`, { valorCentavos: 99000 });
    expect((await dono.post(`/api/oportunidades/${oportunidadeId}/etapa`, { etapaId: destino.id })).statusCode).toBe(200);
  });

  it("perder exige motivo; com motivo, publica oportunidade.perdida", async () => {
    const perdida = etapa("perdida");
    expect((await dono.post(`/api/oportunidades/${oportunidadeId}/etapa`, { etapaId: perdida.id })).statusCode).toBe(400);
    const res = await dono.post(`/api/oportunidades/${oportunidadeId}/etapa`, { etapaId: perdida.id, motivoPerdaId: config.motivosPerda[0].id });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("perdida");
    const { rows } = await t.banco.pool.query("SELECT count(*) FROM evento WHERE tipo = 'oportunidade.perdida' AND entidade_id = $1", [oportunidadeId]);
    expect(Number(rows[0].count)).toBe(1);
  });

  it("o quadro traz as colunas com totais", async () => {
    const res = await dono.get(`/api/funis/${config.funis[0].id}/kanban`);
    expect(res.statusCode).toBe(200);
    const quadro = res.json();
    expect(quadro.colunas.length).toBe(config.funis[0].etapas.length);
    const coluna = quadro.colunas.find((c: { etapaId: string }) => c.etapaId === etapa("perdida").id);
    expect(coluna.itens.map((i: { id: string }) => i.id)).toContain(oportunidadeId);
  });
});

describe("lixeira", () => {
  it("arquivar tira da lista; restaurar devolve com o histórico intacto", async () => {
    const c = await dono.post("/api/contatos", { nome: "Lara Lixeira", telefone: "11 94444-5001" });
    const id = c.json().id;
    await dono.post(`/api/contatos/${id}/notas`, { texto: "Primeira conversa" });
    const historicoAntes = (await dono.get(`/api/contatos/${id}/historico`)).json().itens.length;

    expect((await dono.post(`/api/contatos/${id}/arquivar`)).statusCode).toBe(200);
    expect((await dono.get("/api/contatos?busca=Lara")).json().itens).toHaveLength(0);
    expect((await dono.get("/api/contatos?busca=Lara&arquivados=sim")).json().itens).toHaveLength(1);
    // Telefone de contato na lixeira continua reservado: não nasce um duplicado.
    expect((await dono.post("/api/contatos", { nome: "Lara de novo", telefone: "11 94444-5001" })).statusCode).toBe(409);

    expect((await dono.post(`/api/contatos/${id}/restaurar`)).statusCode).toBe(200);
    const historico = (await dono.get(`/api/contatos/${id}/historico`)).json().itens;
    expect(historico.length).toBe(historicoAntes + 2);
    expect(historico.map((h: { tipo: string }) => h.tipo)).toEqual(expect.arrayContaining(["contato.criado", "nota.criada", "contato.arquivado", "contato.restaurado"]));
    const { rows } = await t.banco.pool.query("SELECT count(*) FROM contato WHERE id = $1", [id]);
    expect(Number(rows[0].count)).toBe(1);
  });
});
