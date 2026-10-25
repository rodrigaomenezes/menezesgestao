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

  it("conversão entre etapas de quem entrou: chegaram, pararam, ganharam; a lista mostra quem parou ali", async () => {
    const b = (await dono.get(`/api/funil/painel?funilId=${funilId}&inicio=${hoje}&fim=${hoje}`)).json();
    const etapas = b.conversao.etapas as { etapaId: string; chegaram: number; pararam: number }[];
    // 4 entraram na 1ª etapa: 1 perdeu ali, 1 parou na 2ª e 2 ganharam (passaram por todas).
    expect(etapas[0]).toMatchObject({ chegaram: 4, pararam: 1 });
    expect(etapas[1]).toMatchObject({ etapaId: segunda, chegaram: 3, pararam: 1 });
    for (const e of etapas.slice(2)) expect(e).toMatchObject({ chegaram: 2, pararam: 0 });
    expect(b.conversao.ganharam).toBe(2);
    const parou = async (etapaId: string) =>
      (await dono.get(`/api/oportunidades?funilId=${funilId}&criadaDe=${hoje}&criadaAte=${hoje}&parouEm=${etapaId}`)).json().itens.map((o: { status: string }) => o.status);
    expect(await parou(etapas[0].etapaId)).toEqual(["perdida"]);
    expect(await parou(segunda)).toEqual(["aberta"]);
    // O vendedor só vê a própria carteira também na conversão (A2 ganhou uma; A1 tem as outras três).
    const v = (await vendedor.get(`/api/funil/painel?funilId=${funilId}&inicio=${hoje}&fim=${hoje}`)).json();
    expect(v.conversao.etapas[0].chegaram).toBe(3);
    expect(v.conversao.ganharam).toBe(1);
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

describe("painel de ligações e painel de qualidade", () => {
  const ligacoes: Record<string, string> = {};
  let interessado = "";
  beforeAll(async () => {
    const resultado = async (nome: string) => {
      const r = await dono.post("/api/telefonia/resultados", { nome, acao: "nenhuma" });
      expect(r.statusCode, r.body).toBe(201);
      return r.json().id as string;
    };
    interessado = await resultado("Interessado painel");
    const caixa = await resultado("Caixa postal painel");
    const ligar = async (chave: string, quem: string, dia: string, segundos: number | null, resultadoId: string | null) => {
      const { rows } = await comoSistema(t.banco, (tx) =>
        tx.cliente.query<{ id: string }>(
          `INSERT INTO ligacao (empresa_id, usuario_id, provedor, numero, estado, iniciada_em, atendida_em, encerrada_em, duracao_segundos, resultado_id)
           VALUES ($1, $2, 'treino', '+5511966660000', 'encerrada', $3, $4, $3, $5, $6) RETURNING id`,
          [e.a.empresaId, quem, meioDia(dia), segundos === null ? null : meioDia(dia), segundos ?? 0, resultadoId],
        ),
      );
      ligacoes[chave] = rows[0].id;
    };
    // Hoje: A1 fez 3 (2 atendidas: 120 s com resultado e 60 s sem), A2 fez 1 não atendida sem resultado; ontem A1 fez 1.
    await ligar("a1-interessado", id("vendedor"), hoje, 120, interessado);
    await ligar("a1-sem", id("vendedor"), hoje, 60, null);
    await ligar("a1-caixa", id("vendedor"), hoje, null, caixa);
    await ligar("a2-nao", id("vendedor2"), hoje, null, null);
    await ligar("a1-ontem", id("vendedor"), ontem, 300, null);

    // Avaliações: A1 recebeu 8 e 6 hoje (uma não lida), A2 recebeu 10.
    const avaliar = async (ligacao: string, avaliado: string, nota: number, lida: boolean) =>
      comoSistema(t.banco, (tx) =>
        tx.cliente.query(
          `INSERT INTO avaliacao (empresa_id, avaliado_id, avaliador_id, ligacao_id, notas, nota_final, lida_em, criado_em) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            e.a.empresaId,
            avaliado,
            id("gestor"),
            ligacao,
            JSON.stringify([
              { criterioId: "00000000-0000-4000-8000-000000000001", nome: "Abertura", peso: 1, nota },
              { criterioId: "00000000-0000-4000-8000-000000000002", nome: "Objeções", peso: 1, nota: nota - 2 },
            ]),
            nota - 1,
            lida ? meioDia(hoje) : null,
            meioDia(hoje),
          ],
        ),
      );
    await avaliar(ligacoes["a1-interessado"], id("vendedor"), 8, true);
    await avaliar(ligacoes["a1-sem"], id("vendedor"), 6, false);
    await avaliar(ligacoes["a2-nao"], id("vendedor2"), 10, true);
  });

  it("ligações: feitas, atendidas, taxa, tempo falado, por dia, por resultado e por pessoa", async () => {
    const r = await dono.get(`/api/ligacoes/painel?inicio=${hoje}&fim=${hoje}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.totais).toEqual({ feitas: 4, atendidas: 2, taxaAtendimento: 50, segundosFalados: 180, duracaoMediaSegundos: 90 });
    expect(b.totaisAnteriores).toMatchObject({ feitas: 1, atendidas: 1, segundosFalados: 300 });
    expect(b.serie).toEqual([{ dia: hoje, feitas: 4, atendidas: 2 }]);
    expect(b.resultados.map((x: { nome: string; quantidade: number }) => [x.nome, x.quantidade])).toEqual([
      ["Sem resultado registrado", 2],
      ["Caixa postal painel", 1],
      ["Interessado painel", 1],
    ]);
    expect(b.pessoas.map((x: { nome: string; feitas: number }) => [x.nome, x.feitas])).toEqual([
      ["Vendedor A1", 3],
      ["Vendedor A2", 1],
    ]);
  });

  it("ligações: a lista desce ao micro (situação, resultado, sem resultado, pessoa) e respeita o escopo", async () => {
    const lista = async (q: string) => (await dono.get(`/api/ligacoes?inicio=${hoje}&fim=${hoje}&${q}`)).json().itens.map((l: { id: string }) => l.id).sort();
    expect(await lista("situacao=nao_atendida")).toEqual([ligacoes["a1-caixa"], ligacoes["a2-nao"]].sort());
    expect(await lista("situacao=atendida")).toEqual([ligacoes["a1-interessado"], ligacoes["a1-sem"]].sort());
    expect(await lista(`resultadoId=${interessado}`)).toEqual([ligacoes["a1-interessado"]]);
    expect(await lista("semResultado=sim")).toEqual([ligacoes["a1-sem"], ligacoes["a2-nao"]].sort());
    expect(await lista(`usuarioId=${id("vendedor2")}`)).toEqual([ligacoes["a2-nao"]]);
    const v = (await vendedor.get(`/api/ligacoes/painel?inicio=${hoje}&fim=${hoje}`)).json();
    expect(v.totais.feitas).toBe(3);
    expect(v.pessoas).toHaveLength(1);
    expect((await vendedor.get(`/api/ligacoes?inicio=${hoje}&fim=${hoje}&usuarioId=${id("vendedor2")}`)).json().itens).toEqual([]);
    expect((await dono.get(`/api/ligacoes?inicio=${hoje}`)).statusCode).toBe(400);
  });

  it("qualidade: avaliações, nota média, não lidas, por pessoa e por critério (mais baixa primeiro)", async () => {
    const r = await dono.get(`/api/avaliacoes/painel?inicio=${hoje}&fim=${hoje}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    // Notas finais 7, 5 e 9.
    expect(b.totais).toEqual({ avaliacoes: 3, notaMedia: 7, naoLidas: 1 });
    expect(b.pessoas.map((x: { nome: string; notaMedia: number; avaliacoes: number }) => [x.nome, x.notaMedia, x.avaliacoes])).toEqual([
      ["Vendedor A2", 9, 1],
      ["Vendedor A1", 6, 2],
    ]);
    expect(b.criterios.map((x: { nome: string; notaMedia: number }) => [x.nome, x.notaMedia])).toEqual([
      ["Objeções", 6],
      ["Abertura", 8],
    ]);
    const foco = (await dono.get(`/api/avaliacoes/painel?inicio=${hoje}&fim=${hoje}&avaliadoId=${id("vendedor")}`)).json();
    expect(foco.totais).toEqual({ avaliacoes: 2, notaMedia: 6, naoLidas: 1 });
    expect(foco.pessoas).toHaveLength(2); // o ranking ignora o filtro de pessoa
    const naoLidas = (await dono.get(`/api/avaliacoes?inicio=${hoje}&fim=${hoje}&naoLidas=sim`)).json().itens;
    expect(naoLidas.map((a: { notaFinal: number }) => a.notaFinal)).toEqual([5]);
    // Quem vê só o próprio vê só as próprias notas.
    const v = (await vendedor.get(`/api/avaliacoes/painel?inicio=${hoje}&fim=${hoje}`)).json();
    expect(v.totais.avaliacoes).toBe(2);
    expect(v.pessoas.map((x: { nome: string }) => x.nome)).toEqual(["Vendedor A1"]);
  });
});
