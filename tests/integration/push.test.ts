// Fase 7: avisos no celular. Push só para quem está fora (não leu e não tinha tela aberta), aviso de ligação
// só para celular, aparelho que sai deixa de receber; retorno agendado da fila vira aviso na hora.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comEmpresa } from "../../apps/api/src/infra/banco.js";
import { criarServicoFila } from "../../apps/api/src/modulos/fila/fila.servico.js";
import { notificar } from "../../apps/api/src/modulos/notificacoes/notificar.js";
import { criarServicoPush, linkSeguro, provedorPushDemonstracao } from "../../apps/api/src/modulos/push/push.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let push: ReturnType<typeof criarServicoPush>;
const CELULAR = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36";
const chaves = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  push = criarServicoPush(t.banco, t.config, provedorPushDemonstracao(t.banco));
});
afterAll(() => t.fechar());

async function avisar(usuarioId: string, titulo: string, soCelular = false): Promise<string> {
  await comEmpresa(t.banco, e.a.empresaId, (tx) => notificar(tx, { empresaId: e.a.empresaId, atorId: null, ip: null, dispositivo: null }, { usuarioId, titulo, link: "/agenda", soCelular }));
  // Passa da janela de 15 s em que o tempo real tem a preferência.
  const { rows } = await t.banco.pool.query<{ id: string }>(
    "UPDATE notificacao SET criado_em = now() - interval '20 seconds' WHERE usuario_id = $1 AND titulo = $2 RETURNING id",
    [usuarioId, titulo],
  );
  return rows[0].id;
}
const enviados = async (usuarioId: string, titulo: string) =>
  Number((await t.banco.pool.query<{ n: string }>("SELECT count(*) AS n FROM aviso_saida WHERE canal = 'push' AND para = $1 AND assunto = $2", [usuarioId, titulo])).rows[0].n);

describe("avisos no celular", () => {
  it("sem chaves VAPID o push fica em demonstração; a inscrição pede endereço https", async () => {
    expect((await dono.get("/api/push/config")).json()).toEqual({ ativo: false, chavePublica: null });
    expect((await dono.post("/api/push/inscricao", { endpoint: "http://inseguro.exemplo.com/x", chaves })).statusCode).toBe(400);
    expect((await dono.post("/api/push/inscricao", { endpoint: "https://push.exemplo.com/dono-computador", chaves })).statusCode).toBe(200);
    // As chaves do navegador ficam cifradas.
    const { rows } = await t.banco.pool.query("SELECT chaves, celular FROM push_inscricao WHERE endpoint = 'https://push.exemplo.com/dono-computador'");
    expect(rows[0].chaves).toMatch(/^v1:/);
    expect(rows[0].celular).toBe(false);
    expect(t.tempoReal.aoEntregarNotificacao).not.toBeNull();
  });

  it("vai para quem está fora; quem viu na tela aberta não recebe push; e não repete", async () => {
    const usuarioId = e.a.pessoas.dono.usuarioId;
    await avisar(usuarioId, "Aviso para quem está fora");
    const entregue = await avisar(usuarioId, "Aviso visto na tela");
    await push.marcarEntregue(entregue);
    await push.varrer();
    await push.varrer();
    expect(await enviados(usuarioId, "Aviso para quem está fora")).toBe(1);
    expect(await enviados(usuarioId, "Aviso visto na tela")).toBe(0);
  });

  it("aviso de ligação só vai para celular", async () => {
    const usuarioId = e.a.pessoas.gestor.usuarioId;
    await push.inscrever(usuarioId, { endpoint: "https://push.exemplo.com/gestor-computador", chaves }, "Mozilla/5.0 (Windows NT 10.0) Chrome/130");
    await avisar(usuarioId, "Ligar para cliente (sem celular)", true);
    await push.varrer();
    expect(await enviados(usuarioId, "Ligar para cliente (sem celular)")).toBe(0);
    await push.inscrever(usuarioId, { endpoint: "https://push.exemplo.com/gestor-celular", chaves }, CELULAR);
    await avisar(usuarioId, "Ligar para cliente (com celular)", true);
    await push.varrer();
    expect(await enviados(usuarioId, "Ligar para cliente (com celular)")).toBe(1);
  });

  it("aparelho que cancelou (ou que outra pessoa usou depois) deixa de receber", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    await vendedor.post("/api/push/inscricao", { endpoint: "https://push.exemplo.com/compartilhado", chaves });
    await vendedor.post("/api/push/cancelar", { endpoint: "https://push.exemplo.com/compartilhado" });
    await avisar(e.a.pessoas.vendedor.usuarioId, "Depois de sair");
    await push.varrer();
    expect(await enviados(e.a.pessoas.vendedor.usuarioId, "Depois de sair")).toBe(0);
    // O mesmo aparelho, agora com o gestor: a inscrição muda de dono.
    await (await logado(t.app, email(e.a, "gestor"))).post("/api/push/inscricao", { endpoint: "https://push.exemplo.com/compartilhado", chaves });
    const { rows } = await t.banco.pool.query("SELECT usuario_id, encerrada_em FROM push_inscricao WHERE endpoint = 'https://push.exemplo.com/compartilhado'");
    expect(rows).toEqual([{ usuario_id: e.a.pessoas.gestor.usuarioId, encerrada_em: null }]);
    // Ninguém tira a inscrição de outra pessoa.
    await (await logado(t.app, email(e.a, "vendedor"))).post("/api/push/cancelar", { endpoint: "https://push.exemplo.com/compartilhado" });
    expect((await t.banco.pool.query("SELECT encerrada_em FROM push_inscricao WHERE endpoint = 'https://push.exemplo.com/compartilhado'")).rows[0].encerrada_em).toBeNull();
  });

  it("o link do aviso nunca leva para fora do app", () => {
    expect(linkSeguro("/filas/1")).toBe("/filas/1");
    expect(linkSeguro("https://golpe.exemplo.com")).toBe("/");
    expect(linkSeguro("//golpe.exemplo.com")).toBe("/");
    expect(linkSeguro(null)).toBe("/");
  });
});

describe("retorno agendado da fila", () => {
  it("na hora marcada, quem ligou recebe o aviso (só celular); remarcado, o aviso antigo não sai", async () => {
    const resultados = (await dono.get("/api/telefonia/resultados")).json() as { id: string; nome: string }[];
    const contato = (await dono.post("/api/contatos", { nome: "Bruno Retorno", telefone: "(11) 96300-0001" })).json();
    const fila = (await dono.post("/api/filas", { nome: "Fila de retornos" })).json();
    await dono.post(`/api/filas/${fila.id}/itens`, { contatoIds: [contato.id] });
    const item = (await dono.post(`/api/filas/${fila.id}/proximo`)).json().item;
    const r = await dono.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: resultados.find((x) => x.nome === "Não atendeu")?.id });
    expect(r.statusCode, r.body).toBe(200);
    const { rows: jobs } = await t.banco.pool.query("SELECT data FROM pgboss.job WHERE name = 'fila.retorno' AND data->>'itemId' = $1", [item.id]);
    expect(jobs).toHaveLength(1);
    const dados = jobs[0].data as { empresaId: string; itemId: string; usuarioId: string; retornarEm: string };
    const filas = criarServicoFila({ config: t.config, banco: t.banco, jobs: t.jobs, avisos: null as never, tempoReal: t.tempoReal });

    await filas.lembrarRetorno({ ...dados, retornarEm: new Date(0).toISOString() }); // remarcado depois: ignora
    await filas.lembrarRetorno(dados);
    const { rows } = await t.banco.pool.query("SELECT titulo, so_celular, link FROM notificacao WHERE usuario_id = $1 AND titulo LIKE 'Hora de ligar de novo%'", [dados.usuarioId]);
    expect(rows).toEqual([{ titulo: "Hora de ligar de novo: Bruno Retorno", so_celular: true, link: `/filas/${fila.id}` }]);
  });
});
