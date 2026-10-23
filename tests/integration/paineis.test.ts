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
