// Painéis do todo ao micro (Desempenho): totais com variação, série por dia, ranking e "o que está por trás do
// número". Tudo sai dos eventos e respeita o escopo: quem vê só a si nunca desce até o número de outra pessoa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";
import { hojeNoFuso, somarDias } from "../../apps/api/src/modulos/operacao/comum.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let gestor: Cliente;
let vendedor: Cliente;
const id = (chave: string) => e.a.pessoas[chave].usuarioId;
const hoje = hojeNoFuso("America/Sao_Paulo");
const ontem = somarDias(hoje, -1);
/** Meio-dia do dia (local de São Paulo) em UTC: cai no dia certo em qualquer fuso de servidor. */
const meioDia = (dia: string) => `${dia}T15:00:00Z`;

async function evento(tipo: string, atorId: string, dia: string, dados: Record<string, unknown> = {}, responsavelId: string | null = null) {
  await comoSistema(t.banco, (tx) =>
    tx.cliente.query("INSERT INTO evento (empresa_id, tipo, ator_id, responsavel_id, entidade, dados, criado_em) VALUES ($1, $2, $3, $4, 'teste', $5, $6)", [
      e.a.empresaId,
      tipo,
      atorId,
      responsavelId,
      JSON.stringify(dados),
      meioDia(dia),
    ]),
  );
}

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  gestor = await logado(t.app, email(e.a, "gestor"));
  vendedor = await logado(t.app, email(e.a, "vendedor"));
  // Hoje: vendedor A1 fez 3 ligações (2 atendidas), A2 fez 1; ontem A1 fez 1.
  await evento("ligacao.encerrada", id("vendedor"), hoje, { atendida: true, duracaoSegundos: 240 });
  await evento("ligacao.encerrada", id("vendedor"), hoje, { atendida: true, duracaoSegundos: 60 });
  await evento("ligacao.encerrada", id("vendedor"), hoje, { atendida: false, duracaoSegundos: 0 });
  await evento("ligacao.encerrada", id("vendedor2"), hoje, { atendida: false, duracaoSegundos: 0 });
  await evento("ligacao.encerrada", id("vendedor"), ontem, { atendida: true, duracaoSegundos: 120 });
  // Venda conta para o responsável, com valor em reais.
  await evento("oportunidade.ganha", id("gestor"), hoje, { valorCentavos: 150_000, titulo: "Plano anual" }, id("vendedor"));
});
afterAll(() => t.fechar());

describe("resumo do desempenho", () => {
  it("totais do dia, variação contra o dia anterior, série e ranking (dono vê a empresa)", async () => {
    const r = await dono.get(`/api/desempenho/resumo?periodo=dia&data=${hoje}&indicador=ligacoes`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({ inicio: hoje, fim: hoje, anterior: { inicio: ontem, fim: ontem }, indicador: "ligacoes", usuarioId: null });
    expect(b.totais.ligacoes).toBe(4);
    expect(b.totais.ligacoes_atendidas).toBe(2);
    expect(b.totaisAnteriores.ligacoes).toBe(1);
    expect(b.totais.valor_vendido).toBe(1500);
    expect(b.serie).toEqual([{ dia: hoje, valor: 4 }]);
    expect(b.ranking.map((x: { nome: string; valor: number }) => [x.nome, x.valor])).toEqual([
      ["Vendedor A1", 3],
      ["Vendedor A2", 1],
    ]);
  });

  it("intervalo livre: um ponto por dia, com zero nos dias sem ação", async () => {
    const inicio = somarDias(hoje, -2);
    const r = await dono.get(`/api/desempenho/resumo?inicio=${inicio}&fim=${hoje}&indicador=ligacoes&usuarioId=${id("vendedor")}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.serie).toEqual([
      { dia: inicio, valor: 0 },
      { dia: ontem, valor: 1 },
      { dia: hoje, valor: 3 },
    ]);
    expect(b).toMatchObject({ usuarioId: id("vendedor"), usuarioNome: "Vendedor A1", anterior: { fim: somarDias(inicio, -1) } });
    // Com pessoa em foco, o ranking continua mostrando o time (contexto).
    expect(b.ranking).toHaveLength(2);
  });

  it("minutos somam a duração; intervalo maior que o limite é recusado com mensagem clara", async () => {
    const r = await dono.get(`/api/desempenho/resumo?periodo=dia&data=${hoje}&indicador=minutos_ligacao`);
    expect(r.json().serie).toEqual([{ dia: hoje, valor: 5 }]);
    const longo = await dono.get(`/api/desempenho/resumo?inicio=2026-01-01&fim=2026-06-30`);
    expect(longo.statusCode).toBe(400);
    expect(longo.body).toMatch(/até 92 dias/);
  });

  it("escopo: gestor vê a própria equipe; vendedor só a si e não abre o número de outra pessoa", async () => {
    const g = (await gestor.get(`/api/desempenho/resumo?periodo=dia&data=${hoje}`)).json();
    expect(g.totais.ligacoes).toBe(3);
    expect(g.ranking.map((x: { nome: string }) => x.nome)).toEqual(["Vendedor A1"]);
    const v = (await vendedor.get(`/api/desempenho/resumo?periodo=dia&data=${hoje}`)).json();
    expect(v.totais.ligacoes).toBe(3);
    expect((await vendedor.get(`/api/desempenho/resumo?usuarioId=${id("vendedor2")}`)).statusCode).toBe(403);
    expect((await gestor.get(`/api/desempenho/eventos?indicador=ligacoes&inicio=${hoje}&fim=${hoje}&usuarioId=${id("vendedor2")}`)).statusCode).toBe(403);
  });
});

describe("o que está por trás do número", () => {
  it("lista as ações do indicador, com detalhe legível, paginadas e mais recentes primeiro", async () => {
    const p1 = await dono.get(`/api/desempenho/eventos?indicador=ligacoes&inicio=${ontem}&fim=${hoje}&usuarioId=${id("vendedor")}&limite=3`);
    expect(p1.statusCode, p1.body).toBe(200);
    const b1 = p1.json();
    expect(b1.itens).toHaveLength(3);
    expect(b1.proximoCursor).toBeTruthy();
    expect(b1.itens[0]).toMatchObject({ usuarioNome: "Vendedor A1", valor: 1 });
    expect(b1.itens.map((x: { detalhe: string }) => x.detalhe).sort()).toEqual(["Atendida · 1 min", "Atendida · 4 min", "Não atendida"]);
    const p2 = (await dono.get(`/api/desempenho/eventos?indicador=ligacoes&inicio=${ontem}&fim=${hoje}&usuarioId=${id("vendedor")}&limite=3&cursor=${b1.proximoCursor}`)).json();
    expect(p2.itens).toHaveLength(1);
    expect(p2.itens[0].detalhe).toBe("Atendida · 2 min");
    expect(p2.proximoCursor).toBeNull();
  });

  it("venda aparece para o responsável, com o valor em reais e o título", async () => {
    const b = (await dono.get(`/api/desempenho/eventos?indicador=valor_vendido&inicio=${hoje}&fim=${hoje}`)).json();
    expect(b.itens).toHaveLength(1);
    expect(b.itens[0]).toMatchObject({ usuarioNome: "Vendedor A1", valor: 1500, detalhe: "Plano anual" });
  });

  it("outra empresa não enxerga nada", async () => {
    const outro = await logado(t.app, email(e.b, "dono"));
    const b = (await outro.get(`/api/desempenho/eventos?indicador=ligacoes&inicio=${ontem}&fim=${hoje}`)).json();
    expect(b.itens).toHaveLength(0);
  });
});

describe("painel do funil", () => {
  let funilId = "";
  let motivoId = "";
  let segunda = "";
  beforeAll(async () => {
    const config = (await dono.get("/api/crm/configuracao")).json();
    const funil = config.funis[0];
    funilId = funil.id;
    motivoId = config.motivosPerda[0].id;
    const ganha = funil.etapas.find((x: { tipo: string }) => x.tipo === "ganha").id;
    const perdida = funil.etapas.find((x: { tipo: string }) => x.tipo === "perdida").id;
    segunda = funil.etapas.filter((x: { tipo: string }) => x.tipo === "aberta")[1].id;
    let n = 0;
    const nova = async (responsavelId: string, valorCentavos: number) => {
      const c = (await dono.post("/api/contatos", { nome: `Funil ${n}`, telefone: `(41) 9${String(8100_0000 + n++).padStart(8, "0")}`, responsavelId })).json();
      const r = await dono.post("/api/oportunidades", { contatoId: c.id, funilId, titulo: `Op ${n}`, valorCentavos, responsavelId });
      expect(r.statusCode, r.body).toBe(201);
      return r.json().id as string;
    };
    const mover = async (id: string, etapaId: string, motivoPerdaId?: string) => {
      const r = await dono.post(`/api/oportunidades/${id}/etapa`, { etapaId, motivoPerdaId: motivoPerdaId ?? null });
      expect(r.statusCode, r.body).toBe(200);
    };
    await mover(await nova(id("vendedor"), 200_000), ganha);
    await mover(await nova(id("vendedor"), 50_000), perdida, motivoId);
    await mover(await nova(id("vendedor2"), 80_000), ganha);
    await mover(await nova(id("vendedor"), 30_000), segunda);
  });

  it("entraram, ganhas, perdidas, conversão, etapas agora, motivos e responsáveis", async () => {
    const r = await dono.get(`/api/funil/painel?funilId=${funilId}&inicio=${hoje}&fim=${hoje}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.totais).toMatchObject({ entraram: 4, ganhas: 2, perdidas: 1, valorGanhoCentavos: 280_000, conversao: 66.7 });
    expect(b.etapas.find((e: { etapaId: string }) => e.etapaId === segunda)).toMatchObject({ quantidade: 1, valorCentavos: 30_000 });
    expect(b.motivos).toEqual([expect.objectContaining({ motivoPerdaId: motivoId, quantidade: 1 })]);
    expect(b.responsaveis.map((x: { nome: string; valorCentavos: number }) => [x.nome, x.valorCentavos])).toEqual([
      ["Vendedor A1", 200_000],
      ["Vendedor A2", 80_000],
    ]);
    expect(b.serie).toEqual([{ dia: hoje, valor: 2 }]);
  });

  it("a lista leva ao micro: perdidas por aquele motivo no período", async () => {
    const r = (await dono.get(`/api/oportunidades?funilId=${funilId}&status=perdida&motivoPerdaId=${motivoId}&fechadaDe=${hoje}&fechadaAte=${hoje}`)).json();
    expect(r.itens).toHaveLength(1);
    const amanha = somarDias(hoje, 1);
    expect((await dono.get(`/api/oportunidades?funilId=${funilId}&status=ganha&fechadaDe=${amanha}&fechadaAte=${amanha}`)).json().itens).toHaveLength(0);
  });

  it("filtro de responsável e escopo: o vendedor só vê a própria carteira", async () => {
    const foco = (await dono.get(`/api/funil/painel?funilId=${funilId}&inicio=${hoje}&fim=${hoje}&responsavelId=${id("vendedor2")}`)).json();
    expect(foco.totais).toMatchObject({ ganhas: 1, valorGanhoCentavos: 80_000 });
    expect(foco.responsaveis).toHaveLength(2); // o ranking mostra o time
    const v = (await vendedor.get(`/api/funil/painel?funilId=${funilId}&inicio=${hoje}&fim=${hoje}`)).json();
    expect(v.totais).toMatchObject({ ganhas: 1, perdidas: 1, valorGanhoCentavos: 200_000 });
    expect(v.responsaveis.map((x: { nome: string }) => x.nome)).toEqual(["Vendedor A1"]);
  });
});

describe("painel de vendas", () => {
  let ofertaA = "";
  beforeAll(async () => {
    ofertaA = (await dono.post("/api/ofertas", { nome: "Plano Mensal" })).json().id;
    const ofertaB = (await dono.post("/api/ofertas", { nome: "Plano Anual" })).json().id;
    const contato = (await dono.post("/api/contatos", { nome: "Comprador", telefone: "(41) 98200-0001", responsavelId: id("vendedor") })).json().id;
    const vender = async (ofertaId: string, vendedorId: string, valorCentavos: number, status: "confirmada" | "pendente") => {
      const r = await dono.post("/api/vendas", { contatoId: contato, ofertaId, vendedorId, valorCentavos, formaPagamento: "pix", status });
      expect(r.statusCode, r.body).toBe(201);
      return r.json().id as string;
    };
    await vender(ofertaA, id("vendedor"), 10_000, "confirmada");
    await vender(ofertaA, id("vendedor"), 10_000, "confirmada");
    await vender(ofertaB, id("vendedor2"), 50_000, "confirmada");
    await vender(ofertaB, id("vendedor"), 50_000, "pendente");
    const cancelar = await vender(ofertaA, id("vendedor2"), 10_000, "confirmada");
    expect((await dono.patch(`/api/vendas/${cancelar}`, { status: "cancelada", motivoCancelamento: "Desistiu" })).statusCode).toBe(200);
  });

  it("conta só as confirmadas; aguardando e canceladas à parte; por oferta e por vendedor", async () => {
    const r = await dono.get(`/api/vendas/painel?inicio=${hoje}&fim=${hoje}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.totais).toEqual({ quantidade: 3, valorCentavos: 70_000, ticketMedioCentavos: 23_333, aguardando: 1, canceladas: 1 });
    expect(b.serie).toEqual([{ dia: hoje, valor: 700 }]);
    expect(b.ofertas.map((o: { nome: string; valorCentavos: number }) => [o.nome, o.valorCentavos])).toEqual([
      ["Plano Anual", 50_000],
      ["Plano Mensal", 20_000],
    ]);
    expect(b.vendedores.map((o: { nome: string; quantidade: number }) => [o.nome, o.quantidade])).toEqual([
      ["Vendedor A2", 1],
      ["Vendedor A1", 2],
    ]);
  });

  it("filtro de oferta leva ao micro (lista das vendas daquela oferta no período); vendedor vê só as dele", async () => {
    const foco = (await dono.get(`/api/vendas/painel?inicio=${hoje}&fim=${hoje}&ofertaId=${ofertaA}`)).json();
    expect(foco.totais.valorCentavos).toBe(20_000);
    expect(foco.ofertas).toHaveLength(2); // o ranking de ofertas ignora o próprio filtro
    const lista = (await dono.get(`/api/vendas?inicio=${hoje}&fim=${hoje}&ofertaId=${ofertaA}&status=confirmada`)).json();
    expect(lista.itens).toHaveLength(2);
    const v = (await vendedor.get(`/api/vendas/painel?inicio=${hoje}&fim=${hoje}`)).json();
    expect(v.totais).toMatchObject({ quantidade: 2, valorCentavos: 20_000, aguardando: 1 });
    expect((await dono.get(`/api/vendas/painel?inicio=2025-01-01&fim=2026-06-30`)).statusCode).toBe(400);
  });
});
