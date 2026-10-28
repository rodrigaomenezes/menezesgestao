// Konecta entrega 3: vários telefones, e-mails e endereços por contato (RF-CRM-002). Telefone extra segue a regra do
// principal — E.164 e de um contato só na empresa — e passa a valer na busca, na entrada do WhatsApp e na importação.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_CANAIS_POR_CONTATO } from "@mg/shared";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";
import { criarCanalDemo, simular } from "../apoio/conversas.js";
import { importarCsv } from "../apoio/crm.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let vendedor: Cliente;
let ana = "";
let bruno = "";
const id = (chave: string) => e.a.pessoas[chave].usuarioId;
const sql = (texto: string, valores: unknown[] = []) => comoSistema(t.banco, (tx) => tx.cliente.query(texto, valores));
const novo = async (dados: Record<string, unknown>) => {
  const r = await dono.post("/api/contatos", dados);
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
};

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  vendedor = await logado(t.app, email(e.a, "vendedor"));
  ana = await novo({ nome: "Ana Canais", telefone: "(51) 99200-0001", email: "ana@exemplo.com.br", responsavelId: id("vendedor") });
  bruno = await novo({ nome: "Bruno Canais", telefone: "(51) 99200-0002", responsavelId: id("vendedor2") });
});
afterAll(() => t.fechar());

describe("telefones e e-mails extras", () => {
  it("inclui telefone (normalizado) e e-mail (minúsculo); a lista e o histórico mostram", async () => {
    const tel = await dono.post(`/api/contatos/${ana}/canais`, { tipo: "telefone", valor: "(51) 3333-0001", rotulo: "comercial" });
    expect(tel.statusCode, tel.body).toBe(201);
    expect(tel.json()).toMatchObject({ tipo: "telefone", valor: "+555133330001", rotulo: "comercial" });
    const mail = await dono.post(`/api/contatos/${ana}/canais`, { tipo: "email", valor: "Ana.Trabalho@Exemplo.com.br" });
    expect(mail.statusCode, mail.body).toBe(201);
    expect(mail.json()).toMatchObject({ valor: "ana.trabalho@exemplo.com.br", rotulo: "outro" });
    const lista = (await vendedor.get(`/api/contatos/${ana}/canais`)).json();
    expect(lista.map((c: { valor: string }) => c.valor)).toEqual(["+555133330001", "ana.trabalho@exemplo.com.br"]);
    const historico = (await dono.get(`/api/contatos/${ana}/historico`)).json().itens.map((h: { tipo: string }) => h.tipo);
    expect(historico.filter((t: string) => t === "contato.canal_adicionado")).toHaveLength(2);
  });

  it("inválido e repetido são erro no campo; número de outro contato aponta o dono", async () => {
    const invalido = await dono.post(`/api/contatos/${ana}/canais`, { tipo: "telefone", valor: "123" });
    expect(invalido.statusCode).toBe(400);
    expect(invalido.json().error.details.campos).toEqual([expect.objectContaining({ campo: "valor" })]);
    expect((await dono.post(`/api/contatos/${ana}/canais`, { tipo: "email", valor: "não é e-mail" })).statusCode).toBe(400);
    // O próprio principal e um extra que já tem: repetido neste contato.
    expect((await dono.post(`/api/contatos/${ana}/canais`, { tipo: "telefone", valor: "51992000001" })).statusCode).toBe(400);
    expect((await dono.post(`/api/contatos/${ana}/canais`, { tipo: "email", valor: "ANA@exemplo.com.br" })).statusCode).toBe(400);
    // O principal do Bruno: conflito, com o id do existente para quem o vê.
    const deOutro = await dono.post(`/api/contatos/${ana}/canais`, { tipo: "telefone", valor: "+55 51 99200-0002" });
    expect(deOutro.statusCode).toBe(409);
    expect(deOutro.json().error.details).toEqual({ contatoId: bruno });
  });

  it("o extra é chave como o principal: novo contato ou troca de principal com ele são recusados", async () => {
    const r = await dono.post("/api/contatos", { nome: "Repetido pelo extra", telefone: "(51) 3333-0001" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.details).toEqual({ contatoId: ana });
    expect((await dono.patch(`/api/contatos/${bruno}`, { telefone: "(51) 3333-0001" })).statusCode).toBe(409);
    // No próprio contato: orienta a usar "Tornar principal".
    const proprio = await dono.patch(`/api/contatos/${ana}`, { telefone: "(51) 3333-0001" });
    expect(proprio.statusCode).toBe(400);
    expect(proprio.json().error.message).toContain("Tornar principal");
  });

  it("a busca acha pelo telefone e pelo e-mail extras", async () => {
    const porTelefone = (await dono.get("/api/contatos?busca=33330001")).json().itens.map((c: { id: string }) => c.id);
    expect(porTelefone).toEqual([ana]);
    const porEmail = (await dono.get("/api/contatos?busca=ana.trabalho")).json().itens.map((c: { id: string }) => c.id);
    expect(porEmail).toEqual([ana]);
  });

  it("mensagem do WhatsApp vinda do extra cai no contato existente (não cria outro)", async () => {
    const canalId = await criarCanalDemo(dono);
    await simular(dono, canalId, { telefone: "(51) 3333-0001", nome: "Quem mandou", texto: "Oi, é a Ana do trabalho" });
    const { rows } = await sql("SELECT contato_id FROM conversa WHERE empresa_id = $1 AND telefone = '+555133330001'", [e.a.empresaId]);
    expect(rows).toEqual([{ contato_id: ana }]);
    const { rows: criados } = await sql("SELECT count(*)::int AS n FROM contato WHERE empresa_id = $1 AND nome = 'Quem mandou'", [e.a.empresaId]);
    expect(criados[0].n).toBe(0);
  });

  it("a importação reconhece o extra e não duplica", async () => {
    const r = await importarCsv(dono, "Nome;Telefone\nAna Canais;(51) 3333-0001\n");
    expect(r.novos).toBe(0);
    const { rows } = await sql("SELECT count(*)::int AS n FROM contato WHERE empresa_id = $1 AND telefone = '+555133330001'", [e.a.empresaId]);
    expect(rows[0].n).toBe(0);
  });

  it("tornar principal troca os dois; tirar o extra libera o número; rótulo muda", async () => {
    const [tel] = (await dono.get(`/api/contatos/${ana}/canais`)).json();
    expect((await dono.patch(`/api/contatos/${ana}/canais/${tel.id}`, { rotulo: "whatsapp" })).json().rotulo).toBe("whatsapp");
    expect((await dono.post(`/api/contatos/${ana}/canais/${tel.id}/principal`)).statusCode).toBe(200);
    expect((await dono.get(`/api/contatos/${ana}`)).json().telefone).toBe("+555133330001");
    const depois = (await dono.get(`/api/contatos/${ana}/canais`)).json();
    expect(depois[0]).toMatchObject({ id: tel.id, valor: "+5551992000001" });

    expect((await dono.post(`/api/contatos/${ana}/canais/${tel.id}/arquivar`)).statusCode).toBe(200);
    // Nada some: a linha fica arquivada; o número fica livre para outro contato.
    const { rows } = await sql("SELECT arquivado_em IS NOT NULL AS arquivado FROM contato_canal WHERE id = $1", [tel.id]);
    expect(rows[0].arquivado).toBe(true);
    expect((await dono.post(`/api/contatos/${bruno}/canais`, { tipo: "telefone", valor: "(51) 99200-0001" })).statusCode).toBe(201);
  });

  it(`no máximo ${MAX_CANAIS_POR_CONTATO} extras por contato`, async () => {
    const c = await novo({ nome: "Muitos e-mails" });
    for (let i = 0; i < MAX_CANAIS_POR_CONTATO; i++) {
      expect((await dono.post(`/api/contatos/${c}/canais`, { tipo: "email", valor: `x${i}@exemplo.com` })).statusCode).toBe(201);
    }
    const excedeu = await dono.post(`/api/contatos/${c}/canais`, { tipo: "email", valor: "mais@exemplo.com" });
    expect(excedeu.statusCode).toBe(400);
    expect(excedeu.json().error.message).toContain(String(MAX_CANAIS_POR_CONTATO));
  });

  it("carteira e empresa: quem não vê o contato não vê nem mexe nos extras", async () => {
    expect((await vendedor.get(`/api/contatos/${bruno}/canais`)).statusCode).toBe(404);
    expect((await vendedor.post(`/api/contatos/${bruno}/canais`, { tipo: "email", valor: "y@exemplo.com" })).statusCode).toBe(404);
    const donoB = await logado(t.app, email(e.b, "dono"));
    expect([403, 404]).toContain((await donoB.get(`/api/contatos/${ana}/canais`)).statusCode);
    expect([403, 404]).toContain((await donoB.get(`/api/contatos/${ana}/enderecos`)).statusCode);
  });
});

describe("endereços", () => {
  const base = { logradouro: "Rua das Flores", numero: "100", bairro: "Centro", cidade: "Porto Alegre", uf: "RS", cep: "90010-000" };

  it("o primeiro é o principal; marcar outro desmarca; tirar o principal passa a marca ao seguinte", async () => {
    const um = await dono.post(`/api/contatos/${ana}/enderecos`, base);
    expect(um.statusCode, um.body).toBe(201);
    expect(um.json()).toMatchObject({ principal: true, cep: "90010000", rotulo: "residencial" });
    const dois = await dono.post(`/api/contatos/${ana}/enderecos`, { ...base, logradouro: "Av. Ipiranga", rotulo: "comercial", principal: true });
    expect(dois.json().principal).toBe(true);
    let lista = (await dono.get(`/api/contatos/${ana}/enderecos`)).json();
    expect(lista.map((x: { logradouro: string; principal: boolean }) => [x.logradouro, x.principal])).toEqual([
      ["Av. Ipiranga", true],
      ["Rua das Flores", false],
    ]);
    expect((await dono.post(`/api/contatos/${ana}/enderecos/${dois.json().id}/arquivar`)).statusCode).toBe(200);
    lista = (await dono.get(`/api/contatos/${ana}/enderecos`)).json();
    expect(lista).toEqual([expect.objectContaining({ logradouro: "Rua das Flores", principal: true })]);
  });

  it("alterar mantém o principal; CEP e UF inválidos são erro no campo", async () => {
    const [atual] = (await dono.get(`/api/contatos/${ana}/enderecos`)).json();
    const r = await dono.put(`/api/contatos/${ana}/enderecos/${atual.id}`, { ...base, numero: "200", principal: false });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ numero: "200", principal: true });
    const cep = await dono.post(`/api/contatos/${ana}/enderecos`, { ...base, cep: "123" });
    expect(cep.statusCode).toBe(400);
    expect(JSON.stringify(cep.json().error.details)).toContain("cep");
    expect((await dono.post(`/api/contatos/${ana}/enderecos`, { ...base, uf: "XX" })).statusCode).toBe(400);
  });
});

describe("LGPD", () => {
  it("o pacote do titular traz os extras; anonimizar apaga os extras e libera o número", async () => {
    const c = await novo({ nome: "Titular Extras", telefone: "(51) 99200-0009" });
    expect((await dono.post(`/api/contatos/${c}/canais`, { tipo: "telefone", valor: "(51) 3333-0009" })).statusCode).toBe(201);
    expect((await dono.post(`/api/contatos/${c}/enderecos`, { logradouro: "Rua A", cidade: "Canoas", uf: "RS" })).statusCode).toBe(201);
    const pacote = (await dono.get(`/api/contatos/${c}/dados-pessoais`)).json().contato;
    expect(pacote.outrosTelefones).toEqual([{ valor: "+555133330009", rotulo: "outro" }]);
    expect(pacote.enderecos).toEqual([expect.objectContaining({ logradouro: "Rua A", cidade: "Canoas", principal: true })]);

    expect((await dono.post(`/api/contatos/${c}/anonimizar`, { confirmacao: "ANONIMIZAR" })).statusCode).toBe(200);
    const { rows } = await sql(
      `SELECT (SELECT string_agg(valor, ',') FROM contato_canal WHERE contato_id = $1) AS canais,
              (SELECT string_agg(logradouro || cidade, ',') FROM contato_endereco WHERE contato_id = $1) AS enderecos`,
      [c],
    );
    expect(rows[0].canais).not.toContain("3333");
    expect(rows[0].enderecos).not.toMatch(/Rua A|Canoas/);
    expect((await dono.post("/api/contatos", { nome: "Novo dono do número", telefone: "(51) 3333-0009" })).statusCode).toBe(201);
  });
});
