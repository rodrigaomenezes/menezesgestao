// Critérios de pronto da fase 5: a comissão do mês confere com o cálculo feito à mão; a venda vincula contato,
// oferta e vendedor. Também: vagas da entrega com trava, fechamento que congela vendas, qualidade e pesquisa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { Cliente, criarPessoas, email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let gestor: Cliente;
let vendedor: Cliente;
let vendedor2: Cliente;
let financeiro: Cliente;
let telefone = 0;
const id = (chave: string) => e.a.pessoas[chave].usuarioId;

async function novoContato(c: Cliente, nome: string): Promise<string> {
  const r = await c.post("/api/contatos", { nome, telefone: `(41) 9${String(6200_0000 + telefone++).padStart(8, "0")}` });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}

async function novaOferta(nome: string, precoCentavos?: number): Promise<string> {
  const r = await dono.post("/api/ofertas", { nome, precoCentavos });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  gestor = await logado(t.app, email(e.a, "gestor"));
  vendedor = await logado(t.app, email(e.a, "vendedor"));
  vendedor2 = await logado(t.app, email(e.a, "vendedor2"));
  financeiro = await logado(t.app, email(e.a, "financeiro"));
});
afterAll(() => t.fechar());

describe("vendas", () => {
  it("a venda vincula contato, oferta e vendedor e aparece no histórico do contato", async () => {
    const ofertaId = await novaOferta("Inglês intensivo", 300_000);
    const contatoId = await novoContato(vendedor, "Aluna da venda");
    const v = await vendedor.post("/api/vendas", { contatoId, ofertaId, valorCentavos: 300_000, formaPagamento: "pix" });
    expect(v.statusCode, v.body).toBe(201);
    expect(v.json()).toMatchObject({ contatoId, ofertaId, vendedorId: id("vendedor"), vendedorNome: "Vendedor A1", ofertaNome: "Inglês intensivo", status: "pendente" });
    const hist = (await vendedor.get(`/api/contatos/${contatoId}/historico`)).json().itens.map((h: { tipo: string }) => h.tipo);
    expect(hist).toContain("venda.registrada");

    // Vendedor não confirma pagamento; o financeiro confirma.
    expect((await vendedor.post("/api/vendas", { contatoId, ofertaId, valorCentavos: 1000, formaPagamento: "pix", status: "confirmada" })).statusCode).toBe(400);
    expect((await vendedor.patch(`/api/vendas/${v.json().id}`, { status: "confirmada" })).statusCode).toBe(403);
    const ok = await financeiro.patch(`/api/vendas/${v.json().id}`, { status: "confirmada" });
    expect(ok.json().status).toBe("confirmada");
    // Vendedor não vê venda de outro; nem lança venda em nome de outro.
    expect((await vendedor2.get("/api/vendas")).json().itens.map((x: { id: string }) => x.id)).not.toContain(v.json().id);
    expect((await vendedor2.post("/api/vendas", { contatoId, ofertaId, valorCentavos: 1000, formaPagamento: "pix" })).statusCode).toBe(400);
    expect((await financeiro.patch(`/api/vendas/${v.json().id}`, { status: "cancelada" })).statusCode).toBe(400);
  });

  it("entrega com capacidade: vendas simultâneas não passam do número de vagas", async () => {
    const ofertaId = await novaOferta("Turma de sábado");
    const ent = await dono.post("/api/entregas", { ofertaId, nome: "Sábado manhã", capacidade: 2, prestadorId: id("gestor"), horario: "Sábados, 9h" });
    expect(ent.statusCode, ent.body).toBe(201);
    const contatos = await Promise.all([1, 2, 3, 4, 5].map((i) => novoContato(dono, `Aluno vaga ${i}`)));
    const r = await Promise.all(
      contatos.map((contatoId) => dono.post("/api/vendas", { contatoId, ofertaId, entregaId: ent.json().id, valorCentavos: 50_000, formaPagamento: "cartao", parcelas: 3 })),
    );
    expect(r.map((x) => x.statusCode).sort(), r.map((x) => x.body).join("\n")).toEqual([201, 201, 409, 409, 409]);
    expect(r.filter((x) => x.statusCode === 409).every((x) => x.json().error.message.includes("vagas"))).toBe(true);
    expect((await dono.get(`/api/entregas/${ent.json().id}`)).json()).toMatchObject({ capacidade: 2, ocupadas: 2, prestadorNome: "Gestor A" });

    // Cancelar a venda libera a vaga.
    const vendida = r.find((x) => x.statusCode === 201)!.json();
    await financeiro.patch(`/api/vendas/${vendida.id}`, { status: "cancelada", motivoCancelamento: "Desistiu" });
    expect((await dono.get(`/api/entregas/${ent.json().id}`)).json().ocupadas).toBe(1);
    expect((await dono.patch(`/api/entregas/${ent.json().id}`, { capacidade: 1 })).statusCode).toBe(200);
    expect((await dono.post(`/api/entregas/${ent.json().id}/participantes`, { contatoId: contatos[4] })).statusCode).toBe(409);
  });
});

describe("comissões", () => {
  it("a comissão do mês confere com a conta feita à mão, e o fechamento congela tudo", async () => {
    const curso = await novaOferta("Curso anual");
    const livro = await novaOferta("Livro");
    // Regras: geral 5%; curso por faixa (até 5.000: 3%; até 10.000: 6%; acima: 10%).
    expect((await gestor.post("/api/comissoes/regras", { nome: "Geral", tipo: "percentual", percentual: 5 })).statusCode).toBe(403);
    expect((await financeiro.post("/api/comissoes/regras", { nome: "Geral", tipo: "percentual", percentual: 5 })).statusCode).toBe(201);
    const faixas = [
      { ateCentavos: 500_000, percentual: 3 },
      { ateCentavos: 1_000_000, percentual: 6 },
      { ateCentavos: null, percentual: 10 },
    ];
    expect((await financeiro.post("/api/comissoes/regras", { nome: "Curso por faixa", ofertaId: curso, tipo: "faixa", faixas })).statusCode).toBe(201);
    expect((await financeiro.post("/api/comissoes/regras", { nome: "Duplicada", tipo: "percentual", percentual: 1 })).statusCode).toBe(409);

    const mes = "2026-03";
    const vender = async (vendedorId: string, ofertaId: string, valorCentavos: number, status = "confirmada") => {
      const contatoId = await novoContato(dono, `Cliente comissão ${telefone}`);
      const r = await dono.post("/api/vendas", { contatoId, ofertaId, vendedorId, valorCentavos, formaPagamento: "pix", dataVenda: `${mes}-15`, status });
      expect(r.statusCode, r.body).toBe(201);
      return r.json().id as string;
    };
    // Vendedor A1: cursos R$ 3.000 + R$ 4.000 (= R$ 7.000 → 6% = R$ 420,00) e livro R$ 99,90 (5% = R$ 4,995 → R$ 5,00).
    await vender(id("vendedor"), curso, 300_000);
    await vender(id("vendedor"), curso, 400_000);
    await vender(id("vendedor"), livro, 9_990);
    // Vendedor A2: curso R$ 12.000 → 10% = R$ 1.200,00. Uma venda cancelada e uma de outro mês não contam.
    await vender(id("vendedor2"), curso, 1_200_000);
    const cancelada = await vender(id("vendedor2"), curso, 999_999);
    await financeiro.patch(`/api/vendas/${cancelada}`, { status: "cancelada", motivoCancelamento: "Estorno" });
    const pendente = await vender(id("vendedor"), livro, 5_000, "pendente");

    const previa = (await financeiro.get(`/api/comissoes?mes=${mes}`)).json();
    const linha = (nome: string, regra: string) => previa.linhas.find((l: { vendedorNome: string; regraNome: string }) => l.vendedorNome === nome && l.regraNome === regra);
    expect(linha("Vendedor A1", "Curso por faixa")).toMatchObject({ vendas: 2, baseCentavos: 700_000, percentual: 6, valorCentavos: 42_000 });
    expect(linha("Vendedor A1", "Geral")).toMatchObject({ vendas: 1, baseCentavos: 9_990, percentual: 5, valorCentavos: 500 });
    expect(linha("Vendedor A2", "Curso por faixa")).toMatchObject({ vendas: 1, baseCentavos: 1_200_000, percentual: 10, valorCentavos: 120_000 });
    expect(previa.totalCentavos).toBe(42_000 + 500 + 120_000);
    expect(previa.fechamento).toBeNull();
    // Cada vendedor vê só as próprias linhas.
    expect((await vendedor.get(`/api/comissoes?mes=${mes}`)).json().linhas.every((l: { vendedorNome: string }) => l.vendedorNome === "Vendedor A1")).toBe(true);

    // Com venda aguardando pagamento, o mês não fecha.
    const cedo = await financeiro.post("/api/comissoes/fechamentos", { mes });
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json().error.details.pendentes).toBe(1);
    await financeiro.patch(`/api/vendas/${pendente}`, { status: "cancelada", motivoCancelamento: "Não pagou" });
    expect((await gestor.post("/api/comissoes/fechamentos", { mes })).statusCode).toBe(403);
    const f = await financeiro.post("/api/comissoes/fechamentos", { mes });
    expect(f.statusCode, f.body).toBe(201);
    expect(f.json().fechamento.totalCentavos).toBe(162_500);

    // Mudar a regra depois não muda o mês fechado (vale o retrato).
    const regras = (await financeiro.get("/api/comissoes/regras")).json().itens;
    await financeiro.patch(`/api/comissoes/regras/${regras.find((r: { nome: string }) => r.nome === "Geral").id}`, { arquivar: true });
    expect((await financeiro.get(`/api/comissoes?mes=${mes}`)).json().totalCentavos).toBe(162_500);

    // Venda do mês fechado não muda nem entra (serviço e banco).
    const vendaDoMes = (await financeiro.get(`/api/vendas?mes=${mes}&status=confirmada`)).json().itens[0];
    expect(vendaDoMes.fechada).toBe(true);
    const bloqueio = await financeiro.patch(`/api/vendas/${vendaDoMes.id}`, { valorCentavos: 1 });
    expect(bloqueio.json().error.code).toBe("PERIODO_FECHADO");
    const contatoId = await novoContato(dono, "Atrasado");
    expect((await dono.post("/api/vendas", { contatoId, ofertaId: livro, valorCentavos: 100, formaPagamento: "pix", dataVenda: `${mes}-20` })).json().error.code).toBe("PERIODO_FECHADO");
    await expect(comoSistema(t.banco, (tx) => tx.cliente.query("UPDATE venda SET valor_centavos = 1 WHERE id = $1", [vendaDoMes.id]))).rejects.toThrow(/PERIODO_FECHADO/);

    // Reabrir (com motivo) volta para a prévia, já com a regra nova.
    expect((await financeiro.post(`/api/comissoes/fechamentos/${f.json().fechamento.id}/reabrir`, { motivo: "Revisão" })).statusCode).toBe(200);
    const depois = (await financeiro.get(`/api/comissoes?mes=${mes}`)).json();
    expect(depois.fechamento).toBeNull();
    expect(depois.semRegra).toBe(1); // o livro ficou sem regra geral
  });
});

describe("monitoramento de qualidade", () => {
  it("o gestor avalia a ligação do vendedor com nota ponderada; o vendedor recebe o feedback", async () => {
    const l = await vendedor.post("/api/ligacoes", { provedor: "treino", numero: "(11) 97777-2222" });
    const criterios = (await gestor.get("/api/qualidade/criterios")).json().itens;
    expect(criterios.length).toBe(5);
    // Pesos 1, 2, 2, 2, 1 com notas 10, 8, 6, 4, 10 → (10 + 16 + 12 + 8 + 10) / 8 = 7,00
    const notas = criterios.map((c: { id: string }, i: number) => ({ criterioId: c.id, nota: [10, 8, 6, 4, 10][i] }));
    expect((await vendedor.post("/api/avaliacoes", { ligacaoId: l.json().id, notas })).statusCode).toBe(403);
    const a = await gestor.post("/api/avaliacoes", { ligacaoId: l.json().id, notas, feedback: "Tratar melhor as objeções." });
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json()).toMatchObject({ avaliadoNome: "Vendedor A1", avaliadorNome: "Gestor A", notaFinal: 7 });
    // Quem fez a ligação não avalia a própria.
    const propria = await dono.post("/api/ligacoes", { provedor: "treino", numero: "(11) 97777-3333" });
    expect((await dono.post("/api/avaliacoes", { ligacaoId: propria.json().id, notas })).statusCode).toBe(400);

    const minhas = (await vendedor.get("/api/avaliacoes")).json().itens;
    expect(minhas.map((x: { id: string }) => x.id)).toContain(a.json().id);
    expect((await vendedor2.get("/api/avaliacoes")).json().itens.map((x: { id: string }) => x.id)).not.toContain(a.json().id);
    const { rowCount } = await t.banco.pool.query("SELECT 1 FROM notificacao WHERE usuario_id = $1 AND titulo LIKE 'Você recebeu uma avaliação%'", [id("vendedor")]);
    expect(rowCount).toBe(1);
    expect((await gestor.post(`/api/avaliacoes/${a.json().id}/lida`)).statusCode).toBe(404);
    expect((await vendedor.post(`/api/avaliacoes/${a.json().id}/lida`)).statusCode).toBe(200);
  });
});

describe("pesquisa com link público", () => {
  it("quem tem o link responde sem login; a empresa vê os resultados agregados", async () => {
    const p = await dono.post("/api/pesquisas", {
      titulo: "Como você conheceu a escola?",
      perguntas: [
        { id: "canal", tipo: "escolha", texto: "Por onde nos conheceu?", opcoes: ["Instagram", "Indicação", "Google"], obrigatoria: true },
        { id: "nota", tipo: "nota", texto: "De 0 a 10, quanto recomendaria?" },
        { id: "sugestao", tipo: "texto", texto: "Alguma sugestão?" },
      ],
    });
    expect(p.statusCode, p.body).toBe(201);
    const token = p.json().token;
    const publico = new Cliente(t.app);
    const ver = await publico.get(`/api/publico/pesquisas/${token}`);
    expect(ver.statusCode).toBe(200);
    expect(ver.json()).not.toHaveProperty("id");
    expect(ver.json().empresa).toBe(e.a.d.nome);

    const responder = (respostas: Record<string, unknown>) => publico.post(`/api/publico/pesquisas/${token}/respostas`, { respostas });
    expect((await responder({ nota: 9 })).statusCode).toBe(400); // obrigatória
    expect((await responder({ canal: "TikTok" })).statusCode).toBe(400);
    expect((await responder({ canal: "Instagram", nota: 11 })).statusCode).toBe(400);
    for (const r of [
      { canal: "Instagram", nota: 9, sugestao: "Mais horários" },
      { canal: "Instagram", nota: 7 },
      { canal: "Indicação", nota: 10 },
    ]) {
      expect((await responder(r)).statusCode).toBe(201);
    }
    const bruto = await dono.get(`/api/pesquisas/${p.json().id}/resultados`);
    expect(bruto.statusCode, bruto.body).toBe(200);
    const res = bruto.json();
    expect(res.total).toBe(3);
    const canal = res.perguntas.find((q: { id: string }) => q.id === "canal");
    expect(canal.opcoes).toEqual([
      { opcao: "Instagram", total: 2 },
      { opcao: "Indicação", total: 1 },
      { opcao: "Google", total: 0 },
    ]);
    expect(res.perguntas.find((q: { id: string }) => q.id === "nota").media).toBe(8.7);
    expect(res.perguntas.find((q: { id: string }) => q.id === "sugestao").ultimas).toEqual(["Mais horários"]);

    await dono.patch(`/api/pesquisas/${p.json().id}`, { aberta: false });
    expect((await responder({ canal: "Google" })).statusCode).toBe(409);
    expect((await publico.get("/api/publico/pesquisas/tokeninexistente1234567")).statusCode).toBe(404);
    // Vendedor vê pesquisas, mas não cria.
    expect((await vendedor.post("/api/pesquisas", { titulo: "x", perguntas: [{ id: "a", tipo: "texto", texto: "?" }] })).statusCode).toBe(403);
  });
});

it("pessoas extras (sanidade do apoio)", async () => {
  expect((await criarPessoas(t.banco, e.a, 1)).length).toBe(1);
});
