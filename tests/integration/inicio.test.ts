// Critério de pronto da fase 7.6: cada pessoa monta o próprio Início; a ordem fica salva no servidor, voltar ao
// padrão não apaga nada, bloco sem permissão não entra e ninguém lê o Início de outra pessoa ou empresa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

describe("Início por pessoa", () => {
  it("sem escolha, vem o padrão do perfil: gestão e atendimento começam diferentes", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const d = (await dono.get("/api/inicio")).json();
    const v = (await vendedor.get("/api/inicio")).json();
    expect(d.padrao).toBe(true);
    expect(d.blocos[0]).toBe("atalhos");
    expect(d.blocos).toContain("ranking");
    expect(v.padrao).toBe(true);
    expect(v.blocos).toContain("conversas");
    expect(v.blocos).not.toEqual(d.blocos);
  });

  it("salva a ordem escolhida, devolve só o que a pessoa pode ver e volta ao padrão sem apagar a linha", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const r = await vendedor.pedir("PUT", "/api/inicio", { blocos: ["metas", "atalhos", "avisos"] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ blocos: ["metas", "atalhos", "avisos"], padrao: false });
    expect((await vendedor.get("/api/inicio")).json()).toEqual({ blocos: ["metas", "atalhos", "avisos"], padrao: false });

    const volta = await vendedor.pedir("DELETE", "/api/inicio");
    expect(volta.statusCode).toBe(200);
    expect(volta.json().padrao).toBe(true);
    const { rows } = await t.banco.pool.query("SELECT blocos FROM inicio_pessoa WHERE usuario_id = $1", [e.a.pessoas.vendedor!.usuarioId]);
    expect(rows).toEqual([{ blocos: null }]);
  });

  it("recusa bloco desconhecido, repetido ou de módulo que o perfil não vê", async () => {
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    expect((await vendedor.pedir("PUT", "/api/inicio", { blocos: ["foguete"] })).statusCode).toBe(400);
    expect((await vendedor.pedir("PUT", "/api/inicio", { blocos: ["atalhos", "atalhos"] })).statusCode).toBe(400);
    // A empresa B está no plano Comercial: vendas e comissões ficam de fora.
    const vendedorB = await logado(t.app, email(e.b, "vendedor"));
    const r = await vendedorB.pedir("PUT", "/api/inicio", { blocos: ["atalhos", "comissao"] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toBe("Esse bloco não está disponível para o seu perfil.");
  });

  it("cada um vê só o próprio Início, e nada atravessa de uma empresa para outra", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const gestor = await logado(t.app, email(e.a, "gestor"));
    await dono.pedir("PUT", "/api/inicio", { blocos: ["avisos"] });
    expect((await gestor.get("/api/inicio")).json().blocos).not.toEqual(["avisos"]);

    const donoB = await logado(t.app, email(e.b, "dono"));
    expect((await donoB.get("/api/inicio")).json().padrao).toBe(true);
    const outraEmpresa = await t.banco.pool.query("SELECT DISTINCT empresa_id FROM inicio_pessoa WHERE usuario_id = $1", [e.a.pessoas.dono!.usuarioId]);
    expect(outraEmpresa.rows.map((x) => x.empresa_id)).toEqual([e.a.empresaId]);
  });
});
