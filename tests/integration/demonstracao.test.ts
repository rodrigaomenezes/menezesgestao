// Demonstração: sem a chave no servidor a tela não existe; com chave errada, recusa; com a chave, gera a empresa de
// exemplo (dados coerentes: telefones únicos, metas e ranking alimentados pelos eventos) e entra com um clique só em
// empresa de demonstração.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gerarEmpresaDemonstracao } from "../../apps/api/src/modulos/demonstracao/gerador.js";
import { Cliente, email, esperarAte, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

const CHAVE = "chave-de-demonstracao-teste";
let t: AmbienteTeste;
let e: EmpresasTeste;
const sql = (texto: string, valores: unknown[] = []) => t.banco.pool.query(texto, valores);

beforeAll(async () => {
  t = await montarTeste({ DEMONSTRACAO_CHAVE: CHAVE });
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

describe("gerador", () => {
  it("gera uma empresa cheia e coerente em poucos segundos", { timeout: 60_000 }, async () => {
    const inicio = Date.now();
    const { empresaId, resumo } = await gerarEmpresaDemonstracao(t as never, "clinica");
    const ms = Date.now() - inicio;
    expect(ms).toBeLessThan(30_000);
    expect(resumo).toMatchObject({ pessoas: 11, contatos: 300 });
    expect(resumo.ligacoes).toBeGreaterThan(1000);
    expect(resumo.mensagens).toBeGreaterThan(500);

    const [emp] = (await sql("SELECT demonstracao, vocabulario->>'contato' AS contato, onboarding->>'segmento' AS segmento FROM empresa WHERE id = $1", [empresaId])).rows;
    expect(emp).toEqual({ demonstracao: true, contato: "paciente", segmento: "clinica" });
    // Telefone é a chave: nenhum repetido; todos E.164.
    const fones = (await sql("SELECT count(*)::int AS n, count(DISTINCT telefone)::int AS d FROM contato WHERE empresa_id = $1", [empresaId])).rows[0];
    expect(fones.n).toBe(fones.d);
    // Ganhas = eventos de venda que alimentam o ranking.
    const ganhas = (await sql("SELECT count(*)::int AS n FROM oportunidade WHERE empresa_id = $1 AND status = 'ganha'", [empresaId])).rows[0].n;
    const eventos = (await sql("SELECT count(*)::int AS n FROM evento WHERE empresa_id = $1 AND tipo = 'oportunidade.ganha'", [empresaId])).rows[0].n;
    expect(ganhas).toBeGreaterThan(20);
    expect(eventos).toBe(ganhas);
    // Dono enxerga indicadores preenchidos (metas e desempenho leem os eventos).
    const [dono] = (await sql("SELECT u.email FROM vinculo v JOIN usuario u ON u.id = v.usuario_id JOIN perfil p ON p.id = v.perfil_id WHERE v.empresa_id = $1 AND p.base = 'dono'", [empresaId])).rows;
    expect(dono.email).toMatch(/\.example$/);
  });
});

describe("tela de demonstração", () => {
  it("sem chave no servidor, não existe; chave errada é recusada; com a chave, gera e entra só em empresa de exemplo", { timeout: 90_000 }, async () => {
    const semChave = await montarTeste();
    expect((await new Cliente(semChave.app).get("/api/demonstracao")).statusCode).toBe(404);
    await semChave.fechar();

    const c = new Cliente(t.app);
    expect((await c.get("/api/demonstracao")).statusCode).toBe(401);
    expect((await c.post("/api/demonstracao/acesso", { chave: "errada" })).statusCode).toBe(403);
    expect((await c.post("/api/demonstracao/acesso", { chave: CHAVE })).statusCode).toBe(200);
    const painel = (await c.get("/api/demonstracao")).json();
    expect(painel.segmentos.map((s: { id: string }) => s.id)).toEqual(["escola", "clinica", "consultoria", "imobiliaria", "varejo"]);

    const pedido = await c.post("/api/demonstracao/segmentos/escola");
    expect(pedido.statusCode, pedido.body).toBe(202);
    expect((await c.post("/api/demonstracao/segmentos/escola")).statusCode).toBe(409); // um de cada vez
    // O trabalhador da fila gera; a tela acompanha até ficar pronta.
    const doPedido = async () => (await c.get("/api/demonstracao")).json().empresas.find((x: { id: string }) => x.id === pedido.json().id);
    const pronta = await esperarAte(doPedido, (x) => x.status === "pronta", 60_000);
    // Job repetido (a fila pode entregar de novo) não gera outra empresa.
    const { criarServicoDemonstracao } = await import("../../apps/api/src/modulos/demonstracao/demonstracao.servico.js");
    await criarServicoDemonstracao(t as never, (s) => gerarEmpresaDemonstracao(t as never, s)).processar(pronta.id, "escola");
    expect((await doPedido()).empresaId).toBe(pronta.empresaId);
    expect(pronta).toMatchObject({ status: "pronta", empresaNome: "Escola Horizonte de Idiomas" });

    expect((await c.post(`/api/demonstracao/${pronta.id}/entrar`, { papel: "vendedor" })).statusCode).toBe(200);
    const eu = (await c.get("/api/auth/eu")).json();
    expect(eu.empresa.id).toBe(pronta.empresaId);
    expect(eu.perfil.nome).toMatch(/Vendedor/);
    expect(eu.termosPendentes).toEqual([]);
    expect((await c.get("/api/rotina")).statusCode).toBe(200);

    // Empresa real não aceita entrada sem senha, nem forjando o id.
    const real = await logado(t.app, email(e.a, "dono"));
    expect((await real.get("/api/auth/eu")).statusCode).toBe(200);
    expect((await c.post(`/api/demonstracao/${e.a.empresaId}/entrar`, { papel: "dono" })).statusCode).toBe(404);
    await sql("UPDATE empresa SET demonstracao = false WHERE id = $1", [pronta.empresaId]);
    expect((await c.post(`/api/demonstracao/${pronta.id}/entrar`, { papel: "dono" })).statusCode).toBe(404);
    await sql("UPDATE empresa SET demonstracao = true WHERE id = $1", [pronta.empresaId]);

    expect((await c.post(`/api/demonstracao/${pronta.id}/arquivar`)).statusCode).toBe(200);
    expect((await c.get("/api/demonstracao")).json().empresas.some((x: { id: string }) => x.id === pronta.id)).toBe(false);
  });
});
