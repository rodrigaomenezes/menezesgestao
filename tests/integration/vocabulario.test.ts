// Critério de pronto da fase 7.5: o vocabulário da empresa vale no sistema inteiro — mensagens de erro, avisos e
// automações falam a língua do segmento, com gênero certo; trocar de segmento só renomeia e cria campos típicos,
// sem apagar nada; o vocabulário de uma empresa nunca aparece na outra.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comEmpresa } from "../../apps/api/src/infra/banco.js";
import { notificar } from "../../apps/api/src/modulos/notificacoes/notificar.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
});
afterAll(() => t.fechar());

describe("vocabulário no servidor", () => {
  it("erros saem com o termo e o gênero de cada empresa, sem vazar de uma para a outra", async () => {
    const donoA = await logado(t.app, email(e.a, "dono"));
    const donoB = await logado(t.app, email(e.b, "dono"));
    expect((await donoA.pedir("PUT", "/api/empresa/vocabulario", { contato: "aluno", oportunidade: "matrícula", oportunidade_genero: "a" })).statusCode).toBe(200);
    expect((await donoB.pedir("PUT", "/api/empresa/vocabulario", { contato: "paciente", oportunidade: "atendimento", oportunidade_genero: "o" })).statusCode).toBe(200);

    const id = randomUUID();
    const contatoA = await donoA.get(`/api/contatos/${id}`);
    const contatoB = await donoB.get(`/api/contatos/${id}`);
    expect(contatoA.statusCode).toBe(404);
    expect(contatoA.json().error.message).toMatch(/^Aluno não encontrado\. Pode ter sido arquivado/);
    expect(contatoB.json().error.message).toMatch(/^Paciente não encontrado\./);
    expect((await donoA.get(`/api/oportunidades/${id}`)).json().error.message).toMatch(/^Matrícula não encontrada\. Pode ter sido arquivada/);
    expect((await donoB.get(`/api/oportunidades/${id}`)).json().error.message).toMatch(/^Atendimento não encontrado\./);
    // Sem marcadores sobrando na resposta.
    expect(contatoA.body).not.toMatch(/\{[A-Za-z]/);
  });

  it("valida singular, plural e gênero; aceita os termos novos (colaborador e unidade)", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    expect((await dono.pedir("PUT", "/api/empresa/vocabulario", { contato_genero: "x" })).statusCode).toBe(400);
    expect((await dono.pedir("PUT", "/api/empresa/vocabulario", { cliente: "aluno" })).statusCode).toBe(400);
    const r = await dono.pedir("PUT", "/api/empresa/vocabulario", { contato: "Aluno", colaborador: "consultora", colaborador_genero: "a", unidade: "escola" });
    expect(r.statusCode).toBe(200);
    expect(r.json().vocabulario).toEqual({ contato: "aluno", colaborador: "consultora", colaborador_genero: "a", unidade: "escola" });
    const eu = (await dono.get("/api/auth/eu")).json();
    expect(eu.empresa.vocabulario).toMatchObject({ colaborador: "consultora", unidade: "escola" });
  });

  it("avisos gravados com marcadores saem no vocabulário da empresa", async () => {
    const dono = e.b.pessoas.dono!;
    await comEmpresa(t.banco, e.b.empresaId, (tx) =>
      notificar(tx, { empresaId: e.b.empresaId, atorId: null, ip: null, dispositivo: "teste" }, { usuarioId: dono.usuarioId, titulo: "{Novo contato} na sua carteira", texto: "Fale com {o contato} hoje." }),
    );
    const { rows } = await t.banco.pool.query<{ titulo: string; texto: string }>("SELECT titulo, texto FROM notificacao WHERE usuario_id = $1 ORDER BY criado_em DESC LIMIT 1", [dono.usuarioId]);
    expect(rows[0]).toEqual({ titulo: "Novo paciente na sua carteira", texto: "Fale com o paciente hoje." });
  });
});

describe("trocar de segmento", () => {
  it("renomeia e cria os campos típicos que faltam, sem tocar em funis nem dados; repetir não duplica", async () => {
    const dono = await logado(t.app, email(e.b, "dono"));
    const antes = (await dono.get("/api/crm/configuracao")).json();

    const r = await dono.pedir("PUT", "/api/empresa/segmento", { segmento: "clinica" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ segmento: "clinica", vocabulario: { contato: "paciente", entrega: "consulta", prestador: "profissional", unidade: "clínica" } });

    const depois = (await dono.get("/api/crm/configuracao")).json();
    expect(depois.funis.map((f: { id: string }) => f.id)).toEqual(antes.funis.map((f: { id: string }) => f.id));
    const chaves = (c: { campos: { chave: string }[] }) => c.campos.map((x) => x.chave).sort();
    expect(chaves(depois)).toEqual(expect.arrayContaining(["convenio", "nascimento", "particular"]));

    expect((await dono.pedir("PUT", "/api/empresa/segmento", { segmento: "clinica" })).statusCode).toBe(200);
    expect(chaves((await dono.get("/api/crm/configuracao")).json())).toEqual(chaves(depois));

    // A outra empresa não ganhou campos nem termos da clínica.
    const donoA = await logado(t.app, email(e.a, "dono"));
    expect(chaves((await donoA.get("/api/crm/configuracao")).json())).not.toContain("convenio");
    expect((await donoA.get("/api/empresa/marca")).json().vocabulario.contato).toBe("aluno");
  });

  it("só quem edita configurações troca o segmento; segmento desconhecido é recusado", async () => {
    const vendedor = await logado(t.app, email(e.b, "vendedor"));
    expect((await vendedor.pedir("PUT", "/api/empresa/segmento", { segmento: "escola" })).statusCode).toBe(403);
    const dono = await logado(t.app, email(e.b, "dono"));
    expect((await dono.pedir("PUT", "/api/empresa/segmento", { segmento: "padaria" })).statusCode).toBe(400);
  });
});
