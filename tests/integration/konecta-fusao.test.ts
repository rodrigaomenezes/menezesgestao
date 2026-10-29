// Konecta entrega 4: possíveis duplicados (mesmo e-mail ou nome) e fusão registrada (RF-CRM-004/008). A origem fica
// arquivada e marcada; tudo o que era dela passa ao destino; o que não ficou como principal vira extra; nada some.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { TRANSFERENCIAS, TRATADAS_A_PARTE } from "../../apps/api/src/modulos/crm/fusao.repositorio.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let gestor: Cliente;
let vendedor: Cliente;
const id = (chave: string) => e.a.pessoas[chave].usuarioId;
const sql = (texto: string, valores: unknown[] = []) => comoSistema(t.banco, (tx) => tx.cliente.query(texto, valores));
const novo = async (dados: Record<string, unknown>) => {
  const r = await dono.post("/api/contatos", dados);
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
};
type Par = { a: { id: string }; b: { id: string }; motivos: string[] };
const pares = async (c: Cliente) => (await c.get("/api/contatos/duplicados?limite=100")).json().itens as Par[];
const temPar = (lista: Par[], x: string, y: string) => lista.find((p) => [p.a.id, p.b.id].sort().join() === [x, y].sort().join());

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  gestor = await logado(t.app, email(e.a, "gestor"));
  vendedor = await logado(t.app, email(e.a, "vendedor"));
});
afterAll(() => t.fechar());

it("toda tabela com contato_id tem destino definido na fusão (tabela nova sem regra quebra este teste)", async () => {
  const { rows } = await sql("SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'contato_id'");
  const conhecidas = new Set<string>([...TRANSFERENCIAS.map((x) => x.tabela), ...TRATADAS_A_PARTE]);
  expect(rows.map((r) => r.table_name as string).filter((n) => !conhecidas.has(n))).toEqual([]);
});

describe("possíveis duplicados", () => {
  it("acha por e-mail (também o extra) e por nome; vendedor não vê a lista; 'não é duplicado' tira o par", async () => {
    const x = await novo({ nome: "Duplo Email Um", email: "duplo@exemplo.com.br" });
    const y = await novo({ nome: "Outro Nome Qualquer" });
    expect((await dono.post(`/api/contatos/${y}/canais`, { tipo: "email", valor: "DUPLO@exemplo.com.br" })).statusCode).toBe(201);
    const n1 = await novo({ nome: "Maria  da Silva Teste" });
    const n2 = await novo({ nome: "maria da silva teste" });
    const lista = await pares(dono);
    expect(temPar(lista, x, y)?.motivos).toEqual(["email"]);
    expect(temPar(lista, n1, n2)?.motivos).toEqual(["nome"]);
    expect((await vendedor.get("/api/contatos/duplicados")).statusCode).toBe(403);

    expect((await dono.post("/api/contatos/duplicados/ignorar", { contatoA: n2, contatoB: n1 })).statusCode).toBe(200);
    expect(temPar(await pares(dono), n1, n2)).toBeUndefined();
  });
});

describe("fusão", () => {
  let destino = "";
  let origem = "";

  beforeAll(async () => {
    destino = await novo({ nome: "Carla Destino", telefone: "(61) 99300-0001", email: "carla@exemplo.com.br", responsavelId: id("vendedor") });
    origem = await novo({ nome: "Carla D.", telefone: "(61) 99300-0002", email: "carla.d@exemplo.com.br", documento: "529.982.247-25", responsavelId: id("vendedor") });
    expect((await dono.post(`/api/contatos/${origem}/notas`, { texto: "Nota da origem" })).statusCode).toBe(201);
    expect((await dono.post("/api/tarefas", { contatoId: origem, titulo: "Tarefa da origem" })).statusCode).toBe(201);
    expect((await dono.post(`/api/contatos/${origem}/enderecos`, { logradouro: "Rua B", cidade: "Brasília", uf: "DF" })).statusCode).toBe(201);
    expect((await dono.post(`/api/contatos/${origem}/canais`, { tipo: "telefone", valor: "(61) 3300-0003" })).statusCode).toBe(201);
  });

  it("vendedor (só a própria carteira) não funde; cadastro de outra empresa não é achado", async () => {
    expect((await vendedor.post(`/api/contatos/${destino}/fundir`, { origemId: origem })).statusCode).toBe(403);
    const donoB = await logado(t.app, email(e.b, "dono"));
    expect([403, 404]).toContain((await donoB.post(`/api/contatos/${destino}/fundir`, { origemId: origem })).statusCode);
    expect((await dono.post(`/api/contatos/${destino}/fundir`, { origemId: destino })).statusCode).toBe(400);
  });

  it("funde: escolhas valem, o resto vira extra, tudo passa para o destino e a fusão fica registrada", async () => {
    const r = await gestor.post(`/api/contatos/${destino}/fundir`, { origemId: origem, manter: { telefone: "origem" } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().movidos).toMatchObject({ notas: 1, tarefas: 1 });

    const ficha = (await dono.get(`/api/contatos/${destino}`)).json();
    // Nome e e-mail do destino (padrão); telefone da origem (escolhido); CPF só a origem tinha.
    expect(ficha).toMatchObject({ nome: "Carla Destino", telefone: "+5561993000002", email: "carla@exemplo.com.br", documentoMascarado: "•••.•••.247-25" });
    const extras = (await dono.get(`/api/contatos/${destino}/canais`)).json().map((c: { valor: string }) => c.valor);
    expect(extras).toEqual(expect.arrayContaining(["+5561993000001", "+556133000003", "carla.d@exemplo.com.br"]));
    expect((await dono.get(`/api/contatos/${destino}/enderecos`)).json()).toEqual([expect.objectContaining({ logradouro: "Rua B", principal: true })]);
    const { rows: notas } = await sql("SELECT contato_id FROM nota WHERE texto = 'Nota da origem'");
    expect(notas).toEqual([{ contato_id: destino }]);

    // A origem fica arquivada, marcada, sem telefone; o histórico do destino mostra o dela também.
    const antiga = (await dono.get(`/api/contatos/${origem}`)).json();
    expect(antiga).toMatchObject({ fundidoEmId: destino, telefone: null });
    expect(antiga.arquivadoEm).not.toBeNull();
    const historico = (await dono.get(`/api/contatos/${destino}/historico?limite=100`)).json().itens.map((h: { tipo: string }) => h.tipo);
    expect(historico).toContain("contato.fundido");
    expect(historico.filter((x: string) => x === "contato.criado")).toHaveLength(2);

    const { rows } = await sql("SELECT origem_resumo, escolhas, usuario_id FROM contato_fusao WHERE destino_id = $1", [destino]);
    expect(rows[0].usuario_id).toBe(id("gestor"));
    expect(rows[0].escolhas).toMatchObject({ telefone: "origem", nome: "destino" });
    expect(rows[0].origem_resumo).toMatchObject({ nome: "Carla D.", documento: "•••.•••.247-25" });
    expect(JSON.stringify(rows[0])).not.toContain("52998224725");
  });

  it("depois da fusão: o número antigo acha o destino, a origem não volta da lixeira nem funde de novo", async () => {
    const repetido = await dono.post("/api/contatos", { nome: "Repetido", telefone: "(61) 99300-0001" });
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().error.details).toEqual({ contatoId: destino });
    expect((await dono.post(`/api/contatos/${origem}/restaurar`)).statusCode).toBe(400);
    expect((await dono.post(`/api/contatos/${destino}/fundir`, { origemId: origem })).statusCode).toBe(400);
    const massa = (await dono.post("/api/contatos/acoes", { ids: [origem], acao: "restaurar" })).json();
    expect(massa).toEqual({ afetados: 0, ignorados: 1 });
  });
});
