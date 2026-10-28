// Konecta entrega 2: CPF/CNPJ cifrado e mascarado (revelar só com permissão e auditoria) e exportação da lista com
// finalidade registrada (RF-MIG-002), sempre na carteira de quem pede e sem vazar entre empresas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let gestor: Cliente;
let vendedor: Cliente;
const id = (chave: string) => e.a.pessoas[chave].usuarioId;
const sql = (texto: string, valores: unknown[] = []) => comoSistema(t.banco, (tx) => tx.cliente.query(texto, valores));
const CPF = "529.982.247-25";
const CNPJ = "11.222.333/0001-81";
let comCpf = "";

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  gestor = await logado(t.app, email(e.a, "gestor"));
  vendedor = await logado(t.app, email(e.a, "vendedor"));
  const r = await dono.post("/api/contatos", { nome: "Com CPF", telefone: "(41) 99100-0001", documento: CPF, responsavelId: id("vendedor") });
  expect(r.statusCode, r.body).toBe(201);
  comCpf = r.json().id;
  const outro = await dono.post("/api/contatos", { tipo: "empresa", nome: "Empresa CNPJ", documento: CNPJ, responsavelId: id("vendedor2") });
  expect(outro.statusCode, outro.body).toBe(201);
});
afterAll(() => t.fechar());

describe("documento (CPF/CNPJ)", () => {
  it("guarda cifrado, mostra só mascarado e nunca devolve o número inteiro na ficha ou na lista", async () => {
    const ficha = (await dono.get(`/api/contatos/${comCpf}`)).json();
    expect(ficha).toMatchObject({ documentoTipo: "cpf", documentoMascarado: "•••.•••.247-25" });
    expect(JSON.stringify(ficha)).not.toContain("52998224725");
    const lista = await dono.get("/api/contatos?busca=Com%20CPF");
    expect(lista.body).not.toContain("52998224725");
    const { rows } = await sql("SELECT documento_cifrado, documento_hash, documento_final FROM contato WHERE id = $1", [comCpf]);
    expect(rows[0].documento_cifrado).not.toContain("52998224725");
    expect(rows[0].documento_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].documento_final).toBe("24725");
  });

  it("inválido é erro no campo; repetido em outro formato aponta o existente; a busca acha pelo número", async () => {
    const invalido = await dono.post("/api/contatos", { nome: "CPF errado", documento: "529.982.247-24" });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().error.details.campos).toEqual([expect.objectContaining({ campo: "documento" })]);
    const repetido = await dono.post("/api/contatos", { nome: "Repetido", documento: "52998224725" });
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().error.details).toEqual({ contatoId: comCpf });
    const busca = (await dono.get(`/api/contatos?busca=${encodeURIComponent("529.982.247-25")}`)).json().itens;
    expect(busca.map((c: { id: string }) => c.id)).toEqual([comCpf]);
  });

  it("revelar: só quem pode exportar, de quem vê, e cada vez fica na auditoria", async () => {
    const r = await dono.post(`/api/contatos/${comCpf}/documento/revelar`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ tipo: "cpf", documento: CPF });
    const { rows } = await sql("SELECT count(*)::int AS n FROM auditoria WHERE empresa_id = $1 AND acao = 'contato.documento_revelado' AND entidade_id = $2", [e.a.empresaId, comCpf]);
    expect(rows[0].n).toBe(1);
    // Vendedor vê o contato (é dele), mas não tem "exportar": não revela.
    expect((await vendedor.post(`/api/contatos/${comCpf}/documento/revelar`)).statusCode).toBe(403);
  });

  it("tirar o documento apaga as quatro colunas; a anonimização (LGPD) também", async () => {
    const r = await dono.patch(`/api/contatos/${comCpf}`, { documento: null });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ documentoTipo: null, documentoMascarado: null });
    expect((await dono.patch(`/api/contatos/${comCpf}`, { documento: CPF })).statusCode).toBe(200);
  });

  it("o pacote do titular (LGPD) traz o documento inteiro", async () => {
    const r = await dono.get(`/api/contatos/${comCpf}/dados-pessoais`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().contato.documento).toBe(CPF);
  });
});

describe("exportação com finalidade", () => {
  it("sem finalidade é recusada; com ela, CSV do filtro com documento mascarado e registro na auditoria", async () => {
    expect((await dono.get("/api/contatos/exportar")).statusCode).toBe(400);
    const r = await dono.get("/api/contatos/exportar?finalidade=relatorio_interno&tipo=empresa");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/csv/);
    expect(r.headers["content-disposition"]).toMatch(/attachment; filename="contatos-/);
    expect(r.body.startsWith("﻿Nome;Tipo;Telefone")).toBe(true);
    expect(r.body).toContain("Empresa CNPJ;Empresa;");
    expect(r.body).toContain("••.•••.•••/0001-81");
    expect(r.body).not.toContain("11222333000181");
    expect(r.body).not.toContain("Com CPF"); // filtro tipo=empresa
    const { rows } = await sql("SELECT depois FROM auditoria WHERE empresa_id = $1 AND acao = 'contatos.exportados' ORDER BY criado_em DESC LIMIT 1", [e.a.empresaId]);
    expect(rows[0].depois).toMatchObject({ finalidade: "relatorio_interno", quantidade: 1, filtros: expect.objectContaining({ tipo: "empresa" }) });
  });

  it("busca por CPF vai mascarada para a auditoria da exportação", async () => {
    const r = await dono.get(`/api/contatos/exportar?finalidade=pedido_do_titular&busca=${encodeURIComponent(CPF)}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body).toContain("Com CPF");
    const { rows } = await sql("SELECT depois::text AS d FROM auditoria WHERE empresa_id = $1 AND acao = 'contatos.exportados' ORDER BY criado_em DESC LIMIT 1", [e.a.empresaId]);
    expect(rows[0].d).toContain("•••.•••.247-25");
    expect(rows[0].d).not.toContain("529.982");
  });

  it("respeita a carteira: gestor exporta só a equipe; vendedor não exporta; outra empresa não vê nada de A", async () => {
    const doGestor = await gestor.get("/api/contatos/exportar?finalidade=relatorio_interno");
    expect(doGestor.statusCode, doGestor.body).toBe(200);
    expect(doGestor.body).toContain("Com CPF"); // do vendedor A1, da equipe dele
    expect(doGestor.body).not.toContain("Empresa CNPJ"); // do vendedor A2, de outra equipe
    expect((await vendedor.get("/api/contatos/exportar?finalidade=relatorio_interno")).statusCode).toBe(403);
    const outra = await logado(t.app, email(e.b, "dono"));
    const deB = await outra.get("/api/contatos/exportar?finalidade=auditoria");
    expect(deB.statusCode).toBe(200);
    expect(deB.body).not.toContain("Com CPF");
    expect(deB.body).not.toContain("Empresa CNPJ");
  });
});
