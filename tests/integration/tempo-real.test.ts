// Tempo real: o evento chega por SSE só para quem é da empresa e tem permissão de ver.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  email,
  logado,
  montarTeste,
  semearDuasEmpresas,
  type AmbienteTeste,
  type Cliente,
  type EmpresasTeste,
} from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let base: string;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  const endereco = t.app.server.address();
  base = `http://127.0.0.1:${typeof endereco === "object" && endereco ? endereco.port : 0}`;
});
afterAll(() => t.fechar());

interface Escuta {
  recebidos: { tipo: string; entidadeId?: string }[];
  fechar(): void;
}

async function escutar(c: Cliente): Promise<Escuta> {
  const controle = new AbortController();
  const res = await fetch(`${base}/api/tempo-real`, {
    headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    signal: controle.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  const recebidos: Escuta["recebidos"] = [];
  const leitor = res.body!.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) return;
        resto += decodificador.decode(value, { stream: true });
        const blocos = resto.split("\n\n");
        resto = blocos.pop() ?? "";
        for (const bloco of blocos) {
          const linha = bloco.split("\n").find((l) => l.startsWith("data: "));
          if (linha) recebidos.push(JSON.parse(linha.slice(6)));
        }
      }
    } catch {
      // conexão encerrada pelo teste
    }
  })();
  await expect.poll(() => recebidos.some((r) => r.tipo === "conectado")).toBe(true);
  return { recebidos, fechar: () => controle.abort() };
}

describe("tempo real (SSE)", () => {
  it("entrega o evento à empresa certa, conforme a permissão", async () => {
    const donoA = await logado(t.app, email(e.a, "dono"));
    const escutaDonoA = await escutar(donoA);
    const escutaDonoB = await escutar(await logado(t.app, email(e.b, "dono")));
    const escutaVendedorA = await escutar(await logado(t.app, email(e.a, "vendedor")));
    expect(t.tempoReal.totalConexoes()).toBe(3);

    const unidade = (await donoA.post("/api/unidades", { nome: "Unidade em tempo real" })).json();

    await expect
      .poll(() => escutaDonoA.recebidos.find((r) => r.tipo === "unidade.criada")?.entidadeId)
      .toBe(unidade.id);
    // Um pouco mais de espera para ter certeza de que os outros não recebem.
    await new Promise((r) => setTimeout(r, 300));
    expect(escutaDonoB.recebidos.map((r) => r.tipo)).toEqual(["conectado"]);
    expect(escutaVendedorA.recebidos.map((r) => r.tipo)).toEqual(["conectado"]);

    for (const escuta of [escutaDonoA, escutaDonoB, escutaVendedorA]) escuta.fechar();
    await expect.poll(() => t.tempoReal.totalConexoes()).toBe(0);
  });

  it("eventos de pessoas respeitam o escopo da equipe", async () => {
    const donoA = await logado(t.app, email(e.a, "dono"));
    const escutaDono = await escutar(donoA);
    const escutaGestor = await escutar(await logado(t.app, email(e.a, "gestor")));

    // O gestor coordena a equipe A1: o evento do usuário de A1 chega para ele também.
    await donoA.patch(`/api/usuarios/${e.a.pessoas.vendedor.vinculoId}`, { unidadeId: e.a.unidades.Bairro });
    await expect.poll(() => escutaGestor.recebidos.some((r) => r.tipo === "usuario.atualizado")).toBe(true);

    // Mas o de quem está fora da equipe dele, não.
    await donoA.patch(`/api/usuarios/${e.a.pessoas.vendedor2.vinculoId}`, { unidadeId: e.a.unidades.Centro });
    await expect
      .poll(() => escutaDono.recebidos.filter((r) => r.tipo === "usuario.atualizado").length)
      .toBe(2);
    await new Promise((r) => setTimeout(r, 300));
    expect(escutaGestor.recebidos.filter((r) => r.tipo === "usuario.atualizado")).toHaveLength(1);

    escutaDono.fechar();
    escutaGestor.fechar();
  });
});
