// Painel de Breaks (do todo ao micro) e filtro de dias da auditoria no fuso da empresa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { hojeNoFuso, somarDias } from "../../apps/api/src/modulos/operacao/comum.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let vendedor: Cliente;
const id = (chave: string) => e.a.pessoas[chave].usuarioId;
const hoje = hojeNoFuso("America/Sao_Paulo");
const ontem = somarDias(hoje, -1);
const meioDia = (dia: string) => `${dia}T15:00:00Z`;
let preco = "";
let decidir = "";
const sql = (texto: string, valores: unknown[]) => comoSistema(t.banco, (tx) => tx.cliente.query(texto, valores));

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  vendedor = await logado(t.app, email(e.a, "vendedor"));
  const motivos = (await dono.get("/api/bre/motivos")).json().itens as { id: string; categoria: string; nome: string }[];
  preco = motivos.find((m) => m.categoria === "C_FINANCIAL" && m.nome === "Preço")!.id;
  decidir = motivos.find((m) => m.categoria === "A_TIME" && m.nome === "Vai decidir depois")!.id;
  const contato = async (nome: string, responsavel: string) =>
    (await sql("INSERT INTO contato (empresa_id, nome, responsavel_id) VALUES ($1, $2, $3) RETURNING id", [e.a.empresaId, nome, responsavel])).rows[0].id as string;
  const c1 = await contato("Cliente Um", id("vendedor"));
  const c2 = await contato("Cliente Dois", id("vendedor2"));
  const c3 = await contato("Cliente Três", id("vendedor2"));
  const quebra = (contatoId: string, categoria: string, motivoId: string, autor: string, dia: string) =>
    sql(
      `INSERT INTO break_bre (empresa_id, contato_id, categoria, motivo_id, comentario, acao_padrao, autor_id, criado_em)
       VALUES ($1, $2, $3, $4, 'Comentário do teste', 'Reentrada', $5, $6)`,
      [e.a.empresaId, contatoId, categoria, motivoId, autor, meioDia(dia)],
    );
  // Hoje: Preço ×3 (2 do Cliente Um, por A1; 1 do Cliente Dois, por A2) e "Vai decidir depois" ×1 (por A2). Ontem: 1.
  await quebra(c1, "C_FINANCIAL", preco, id("vendedor"), hoje);
  await quebra(c1, "C_FINANCIAL", preco, id("vendedor"), hoje);
  await quebra(c2, "C_FINANCIAL", preco, id("vendedor2"), hoje);
  await quebra(c3, "A_TIME", decidir, id("vendedor2"), hoje);
  await quebra(c1, "A_TIME", decidir, id("vendedor"), ontem);
});
afterAll(() => t.fechar());

describe("painel de Breaks", () => {
  it("totais, categorias, motivos, quem registrou e série; o anterior compara", async () => {
    const r = await dono.get(`/api/bre/breaks/painel?inicio=${hoje}&fim=${hoje}`);
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.totais).toEqual({ breaks: 4, contatos: 3 });
    expect(b.totaisAnteriores).toEqual({ breaks: 1, contatos: 1 });
    expect(b.serie).toEqual([{ dia: hoje, valor: 4 }]);
    expect(b.categorias).toEqual([
      { categoria: "C_FINANCIAL", quantidade: 3 },
      { categoria: "A_TIME", quantidade: 1 },
    ]);
    expect(b.motivos.map((m: { nome: string; quantidade: number }) => [m.nome, m.quantidade])).toEqual([
      ["Preço", 3],
      ["Vai decidir depois", 1],
    ]);
    expect(b.autores.map((a: { nome: string; quantidade: number }) => [a.nome, a.quantidade])).toEqual([
      ["Vendedor A1", 2],
      ["Vendedor A2", 2],
    ]);
  });

  it("categoria filtra motivos e pessoas, mas o ranking de categorias mostra todas; a lista desce ao micro", async () => {
    const b = (await dono.get(`/api/bre/breaks/painel?inicio=${hoje}&fim=${hoje}&categoria=C_FINANCIAL`)).json();
    expect(b.totais).toEqual({ breaks: 3, contatos: 2 });
    expect(b.categorias).toHaveLength(2);
    expect(b.motivos.map((m: { nome: string }) => m.nome)).toEqual(["Preço"]);
    expect(b.autores.map((a: { nome: string; quantidade: number }) => [a.nome, a.quantidade])).toEqual([
      ["Vendedor A1", 2],
      ["Vendedor A2", 1],
    ]);
    const lista = (await dono.get(`/api/bre/breaks?inicio=${hoje}&fim=${hoje}&categoria=A_TIME`)).json().itens;
    expect(lista.map((x: { contatoNome: string; autorNome: string; motivo: string }) => [x.contatoNome, x.autorNome, x.motivo])).toEqual([["Cliente Três", "Vendedor A2", "Vai decidir depois"]]);
    expect((await dono.get(`/api/bre/breaks?inicio=${hoje}&fim=${hoje}&motivoId=${preco}`)).json().itens).toHaveLength(3);
    expect((await dono.get(`/api/bre/breaks?inicio=${hoje}&fim=${hoje}&autorId=${id("vendedor2")}`)).json().itens).toHaveLength(2);
    expect((await dono.get(`/api/bre/breaks?categoria=NAO_EXISTE`)).statusCode).toBe(400);
  });

  it("escopo: o vendedor só vê os Breaks da própria carteira; outra empresa não chega aos dados", async () => {
    const v = (await vendedor.get(`/api/bre/breaks/painel?inicio=${hoje}&fim=${hoje}`)).json();
    expect(v.totais).toEqual({ breaks: 2, contatos: 1 });
    expect((await vendedor.get(`/api/bre/breaks?inicio=${hoje}&fim=${hoje}`)).json().itens.map((x: { contatoNome: string }) => x.contatoNome)).toEqual(["Cliente Um", "Cliente Um"]);
    const outra = await logado(t.app, email(e.b, "dono"));
    const r = await outra.get(`/api/bre/breaks/painel?inicio=${hoje}&fim=${hoje}`);
    // A empresa B não tem o Motor BRE no plano: nem chega à consulta.
    expect(r.json().error.code).toBe("MODULO_INATIVO");
  });
});

describe("auditoria por dia, no fuso da empresa", () => {
  it("23h30 de um dia em São Paulo (já o dia seguinte em UTC) conta para o dia local", async () => {
    await sql("INSERT INTO auditoria (empresa_id, ator_id, acao, entidade, criado_em) VALUES ($1, $2, 'teste.fuso', 'teste', $3)", [e.a.empresaId, id("dono"), "2026-01-10T23:30:00-03:00"]);
    const dia = (de: string, ate: string) => dono.get(`/api/auditoria?acao=teste.fuso&deDia=${de}&ateDia=${ate}`);
    expect((await dia("2026-01-10", "2026-01-10")).json().itens).toHaveLength(1);
    expect((await dia("2026-01-11", "2026-01-11")).json().itens).toHaveLength(0);
    expect((await dia("2026-01-09", "2026-01-10")).json().itens).toHaveLength(1);
    expect((await dono.get(`/api/auditoria?deDia=10-01-2026`)).statusCode).toBe(400);
  });
});
