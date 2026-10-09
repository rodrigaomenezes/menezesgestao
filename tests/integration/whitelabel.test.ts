// Critério de pronto da fase 6: duas empresas com marcas e vocabulários diferentes rodam no mesmo deploy; uma
// empresa nova se cadastra e configura marca e segmento sozinha; nenhum nome de cliente no código.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import type { Servicos } from "../../apps/api/src/app.js";
import { criarServicoAutomacoes } from "../../apps/api/src/modulos/automacoes/automacoes.servico.js";
import { criarServicoCobranca } from "../../apps/api/src/modulos/cobranca/cobranca.servico.js";
import { hojeNoFuso, somarDias } from "../../apps/api/src/modulos/operacao/comum.js";
import { Cliente, email, logado, montarTeste, semearDuasEmpresas, SENHA_TESTE, type AmbienteTeste, type EmpresasTeste } from "../apoio/app-teste.js";
import { criarCanalDemo } from "../apoio/conversas.js";

const BASE = "plataforma.example";
let t: AmbienteTeste;
let e: EmpresasTeste;
let servicos: Servicos;
let slugA = "";
let slugB = "";

/** Visitante (sem login) chegando por um endereço. */
const visitante = (host: string) => ({
  get: (url: string) => t.app.inject({ method: "GET", url, headers: { host } }),
});

beforeAll(async () => {
  t = await montarTeste({ DOMINIO_BASE: BASE });
  e = await semearDuasEmpresas(t.banco);
  servicos = { config: t.config, banco: t.banco, jobs: t.jobs, avisos: null as never, tempoReal: t.tempoReal };
  const slugs = await t.banco.pool.query<{ id: string; slug: string }>("SELECT id, slug FROM empresa WHERE id = ANY($1)", [[e.a.empresaId, e.b.empresaId]]);
  slugA = slugs.rows.find((r) => r.id === e.a.empresaId)!.slug;
  slugB = slugs.rows.find((r) => r.id === e.b.empresaId)!.slug;
});
afterAll(() => t.fechar());

describe("duas marcas no mesmo deploy", () => {
  it("cada endereço mostra a marca da sua empresa; o vocabulário vale para quem entra nela", async () => {
    const donoA = await logado(t.app, email(e.a, "dono"));
    const donoB = await logado(t.app, email(e.b, "dono"));
    expect((await donoA.pedir("PUT", "/api/empresa/marca", { nomeProduto: "Escola Alfa", corPrimaria: "#0b5394", corDestaque: "#e69138" })).statusCode).toBe(200);
    expect((await donoB.pedir("PUT", "/api/empresa/marca", { nomeProduto: "Clínica Beta", corPrimaria: "#38761d", corDestaque: "#741b47" })).statusCode).toBe(200);
    await donoA.pedir("PUT", "/api/empresa/vocabulario", { contato: "aluno", oferta: "curso", entrega: "turma" });
    await donoB.pedir("PUT", "/api/empresa/vocabulario", { contato: "paciente", oferta: "procedimento", entrega: "consulta" });

    const a = (await visitante(`${slugA}.${BASE}`).get("/api/marca")).json();
    const b = (await visitante(`${slugB}.${BASE}`).get("/api/marca")).json();
    expect(a).toMatchObject({ nomeProduto: "Escola Alfa", corPrimaria: "#0b5394", empresa: e.a.d.nome });
    expect(b).toMatchObject({ nomeProduto: "Clínica Beta", corPrimaria: "#38761d", empresa: e.b.d.nome });
    const padrao = (await visitante("localhost").get("/api/marca")).json();
    expect(padrao.empresa).toBeNull();
    expect((await visitante(`naoexiste.${BASE}`).get("/api/marca")).json().empresa).toBeNull();

    // Manifesto do app instalado também segue o endereço.
    const manifesto = (await visitante(`${slugB}.${BASE}`).get("/manifest.webmanifest")).json();
    expect(manifesto).toMatchObject({ name: "Clínica Beta", theme_color: "#38761d" });
    expect(manifesto.icons[0].src).toBe(`/api/publico/icone/${slugB}`);
    const icone = await visitante("localhost").get(`/api/publico/icone/${slugB}`);
    expect(icone.headers["content-type"]).toContain("image/svg+xml");
    expect(icone.body).toContain("#38761d");

    const euA = (await donoA.get("/api/auth/eu")).json();
    const euB = (await donoB.get("/api/auth/eu")).json();
    expect(euA.empresa.vocabulario).toMatchObject({ contato: "aluno", entrega: "turma" });
    expect(euB.empresa.vocabulario).toMatchObject({ contato: "paciente", entrega: "consulta" });
  });

  it("domínio próprio leva à empresa certa e o login nele entra direto nela", async () => {
    const donoA = await logado(t.app, email(e.a, "dono"));
    const donoB = await logado(t.app, email(e.b, "dono"));
    const d = await donoB.pedir("PUT", "/api/empresa/dominio", { dominio: "App.Clinica-Beta.example" });
    expect(d.statusCode, d.body).toBe(200);
    expect(d.json()).toMatchObject({ dominio: "app.clinica-beta.example", subdominio: `${slugB}.${BASE}` });
    expect((await donoA.pedir("PUT", "/api/empresa/dominio", { dominio: "app.clinica-beta.example" })).statusCode).toBe(409);
    expect((await donoA.pedir("PUT", "/api/empresa/dominio", { dominio: `outra.${BASE}` })).statusCode).toBe(400);
    expect((await donoA.pedir("PUT", "/api/empresa/dominio", { dominio: "https://x" })).statusCode).toBe(400);
    expect((await visitante("app.clinica-beta.example").get("/api/marca")).json().empresa).toBe(e.b.d.nome);

    // A consultora está nas duas empresas: pelo endereço da B, entra na B.
    const c = new Cliente(t.app);
    const csrf = await t.app.inject({ method: "GET", url: "/api/health", headers: { host: `${slugB}.${BASE}` } });
    const token = csrf.cookies.find((k) => k.name === "mg_csrf")!.value;
    const r = await t.app.inject({
      method: "POST",
      url: "/api/auth/entrar",
      headers: { host: `${slugB}.${BASE}`, "x-csrf-token": token, cookie: `mg_csrf=${token}` },
      payload: { email: email(e.b, "consultor"), senha: SENHA_TESTE },
    });
    expect(r.statusCode, r.body).toBe(200);
    const sessao = r.cookies.find((k) => k.name === "mg_sessao")!.value;
    c.cookies.set("mg_sessao", sessao);
    c.cookies.set("mg_csrf", token);
    expect((await c.get("/api/auth/eu")).json().empresa.id).toBe(e.b.empresaId);
  });

  it("cor sem contraste é recusada; logo PNG vira público e SVG não é aceito", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const ruim = await dono.pedir("PUT", "/api/empresa/marca", { corPrimaria: "#797979", corDestaque: "#e69138" });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.body).toContain("difícil de ler");

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const enviar = (nome: string, tipo: string, conteudo: Buffer) => {
      const fronteira = "----mg" + Date.now();
      const corpo = Buffer.concat([
        Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="arquivo"; filename="${nome}"\r\nContent-Type: ${tipo}\r\n\r\n`),
        conteudo,
        Buffer.from(`\r\n--${fronteira}--\r\n`),
      ]);
      return t.app.inject({
        method: "POST",
        url: "/api/empresa/marca/logo/claro",
        headers: {
          "content-type": `multipart/form-data; boundary=${fronteira}`,
          "x-csrf-token": dono.cookies.get("mg_csrf")!,
          cookie: [...dono.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        payload: corpo,
      });
    };
    expect((await enviar("logo.svg", "image/svg+xml", Buffer.from("<svg/>"))).statusCode).toBe(400);
    const ok = await enviar("logo.png", "image/png", png);
    expect(ok.statusCode, ok.body).toBe(200);
    const url = ok.json().logoClaro as string;
    expect(url).toMatch(new RegExp(`^/api/publico/logo/${slugA}/claro`));
    const img = await visitante("localhost").get(url);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.rawPayload.equals(png)).toBe(true);
    // Trocar as cores não perde o logo.
    await dono.pedir("PUT", "/api/empresa/marca", { corPrimaria: "#0b5394", corDestaque: "#e69138" });
    expect((await dono.get("/api/empresa/marca")).json().logoClaro).toBe(url);
  });
});

describe("cadastro aberto e assistente de primeiro acesso", () => {
  it("a empresa se cadastra, aplica o segmento, ganha exemplos e conclui o assistente", async () => {
    const emailNovo = `fundadora.${Date.now()}@teste.example.com`;
    const visitanteNovo = new Cliente(t.app);
    const r = await visitanteNovo.post("/api/cadastro", { empresa: "Escola Nova", nome: "Fundadora", email: emailNovo, senha: "uma senha bem longa", aceite: true });
    expect(r.statusCode, r.body).toBe(201);
    expect((await new Cliente(t.app).post("/api/cadastro", { empresa: "Outra", nome: "X", email: emailNovo, senha: "uma senha bem longa", aceite: true })).statusCode).toBe(409);

    const dona = await new Cliente(t.app).entrar(emailNovo, "uma senha bem longa");
    const eu = (await dona.get("/api/auth/eu")).json();
    expect(eu.empresa.nome).toBe("Escola Nova");
    expect(eu.perfil.nome).toBe("Dono / Administrador");
    expect((await dona.get("/api/primeiros-passos")).json()).toMatchObject({ passo: 1, concluido: false, segmento: null });

    const seg = await dona.post("/api/primeiros-passos/segmento", { segmento: "escola" });
    expect(seg.json()).toMatchObject({ segmento: "escola", passo: 3 });
    expect((await dona.post("/api/primeiros-passos/segmento", { segmento: "clinica" })).statusCode).toBe(409);
    expect((await dona.get("/api/auth/eu")).json().empresa.vocabulario).toMatchObject({ contato: "aluno", oferta: "curso", entrega: "turma" });
    const config = (await dona.get("/api/crm/configuracao")).json();
    expect(config.funis.map((f: { nome: string }) => f.nome)).toEqual(["Matrículas"]);
    expect(config.funis[0].etapas.map((x: { nome: string }) => x.nome)).toContain("Aula experimental");

    expect((await dona.post("/api/primeiros-passos/exemplos")).json().temExemplos).toBe(true);
    expect((await dona.get("/api/contatos?limite=50")).json().itens.length).toBe(5);
    expect((await dona.post("/api/primeiros-passos/exemplos/limpar")).json().temExemplos).toBe(false);
    expect((await dona.get("/api/contatos?limite=50")).json().itens.length).toBe(0);
    expect((await dona.get("/api/contatos?limite=50&arquivados=sim")).json().itens.length).toBe(5); // na lixeira, não apagados

    expect((await dona.post("/api/primeiros-passos/avancar", { passo: 6 })).json()).toMatchObject({ concluido: true });

    const assinatura = (await dona.get("/api/assinatura")).json();
    expect(assinatura).toMatchObject({ plano: "completo", status: "teste", provedor: "demonstracao", testeAte: somarDias(hojeNoFuso("America/Sao_Paulo"), 14) });
  });

  it("com CADASTRO_ABERTO=nao, o cadastro fica fechado", async () => {
    const t2 = await montarTeste({ CADASTRO_ABERTO: "nao" });
    try {
      const r = await new Cliente(t2.app).post("/api/cadastro", { empresa: "X", nome: "Y", email: `fechado.${Date.now()}@teste.example.com`, senha: "uma senha bem longa", aceite: true });
      expect(r.statusCode).toBe(403);
      expect((await new Cliente(t2.app).get("/api/marca")).json().cadastroAberto).toBe(false);
    } finally {
      await t2.fechar();
    }
  });
});

describe("plano e cobrança (provedor de demonstração)", () => {
  it("trocar de plano esconde módulos sem apagar dados; o ciclo gera, vence e recebe faturas", async () => {
    const emailNovo = `plano.${Date.now()}@teste.example.com`;
    await new Cliente(t.app).post("/api/cadastro", { empresa: "Plano Teste", nome: "Dono", email: emailNovo, senha: "uma senha bem longa", aceite: true });
    const dono = await new Cliente(t.app).entrar(emailNovo, "uma senha bem longa");
    const oferta = await dono.post("/api/ofertas", { nome: "Curso" });
    expect(oferta.statusCode).toBe(201);

    const essencial = await dono.pedir("PUT", "/api/assinatura/plano", { plano: "essencial" });
    expect(essencial.json()).toMatchObject({ plano: "essencial", valorCentavos: 9_900 });
    const bloqueado = await dono.get("/api/ofertas");
    expect(bloqueado.statusCode).toBe(403);
    expect((await dono.get("/api/vendas")).json().error.code).toBe("MODULO_INATIVO");
    const empresaId = (await dono.get("/api/auth/eu")).json().empresa.id;
    const { rows } = await t.banco.pool.query("SELECT count(*)::int AS n FROM oferta WHERE empresa_id = $1", [empresaId]);
    expect(rows[0].n).toBe(1); // os dados continuam lá
    await dono.pedir("PUT", "/api/assinatura/plano", { plano: "completo" });
    expect((await dono.get("/api/ofertas")).json().itens.length).toBe(1);

    const cobranca = criarServicoCobranca(servicos);
    const { testeAte } = (await dono.get("/api/assinatura")).json();
    await cobranca.executarCiclo(somarDias(testeAte, -2));
    await cobranca.executarCiclo(somarDias(testeAte, -2)); // rodar de novo não duplica
    let a = (await dono.get("/api/assinatura")).json();
    expect(a.faturas).toHaveLength(1);
    expect(a.faturas[0]).toMatchObject({ vencimento: testeAte, valorCentavos: 39_900, status: "pendente" });
    await cobranca.executarCiclo(somarDias(testeAte, 1));
    a = (await dono.get("/api/assinatura")).json();
    expect(a.status).toBe("atrasada");
    expect(a.faturas.find((f: { vencimento: string }) => f.vencimento === testeAte).status).toBe("vencida");
    const pago = await dono.post(`/api/faturas/${a.faturas.find((f: { vencimento: string }) => f.vencimento === testeAte).id}/pagar-simulado`);
    expect(pago.json().status).toBe("ativa");
  });
});

describe("automações quando/se/então", () => {
  it("cria tarefa quando a oportunidade entra na etapa escolhida (uma vez só por evento)", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const config = (await dono.get("/api/crm/configuracao")).json();
    const funil = config.funis[0];
    const [primeira, segunda, terceira] = funil.etapas;
    const regra = await dono.post("/api/automacoes-regras", {
      nome: "Proposta pede ligação",
      gatilho: "oportunidade.etapa_alterada",
      condicoes: [{ campo: "etapaNovaId", operador: "igual", valor: segunda.id }],
      acao: "criar_tarefa",
      parametros: { titulo: "Ligar para {nome} sobre a proposta", horas: 2 },
    });
    expect(regra.statusCode, regra.body).toBe(201);

    const contato = (await dono.post("/api/contatos", { nome: "Rita Automação", telefone: "(11) 95432-1000" })).json();
    const op = (await dono.post("/api/oportunidades", { contatoId: contato.id, funilId: funil.id, titulo: "Curso", etapaId: primeira.id })).json();
    await dono.post(`/api/oportunidades/${op.id}/etapa`, { etapaId: segunda.id });
    await dono.post(`/api/oportunidades/${op.id}/etapa`, { etapaId: terceira.id });

    const automacoes = criarServicoAutomacoes(servicos, null);
    await automacoes.varrer();
    await automacoes.varrer();
    const tarefas = (await dono.get(`/api/tarefas?contatoId=${contato.id}`)).json().itens;
    expect(tarefas.map((x: { titulo: string }) => x.titulo)).toEqual(["Ligar para Rita sobre a proposta"]);
    const { rows } = await t.banco.pool.query("SELECT status, count(*)::int AS n FROM automacao_execucao WHERE regra_id = $1 GROUP BY status ORDER BY status", [regra.json().id]);
    expect(rows).toEqual([
      { status: "executada", n: 1 },
      { status: "ignorada", n: 1 },
    ]);
    const lista = (await dono.get("/api/automacoes-regras")).json().itens.find((r: { id: string }) => r.id === regra.json().id);
    expect(lista).toMatchObject({ execucoes: 1, ativa: true });

    // Desligada, não roda mais.
    await dono.patch(`/api/automacoes-regras/${regra.json().id}`, { ativa: false });
    await dono.post(`/api/oportunidades/${op.id}/etapa`, { etapaId: segunda.id });
    await automacoes.varrer();
    expect((await dono.get(`/api/tarefas?contatoId=${contato.id}`)).json().itens).toHaveLength(1);
  });

  it("mensagem automática respeita o \"não contatar\"; ligação não atendida avisa o responsável", async () => {
    const dono = await logado(t.app, email(e.a, "dono"));
    const vendedor = await logado(t.app, email(e.a, "vendedor"));
    const canalId = await criarCanalDemo(dono, `Canal automação ${Date.now()}`);
    await dono.post("/api/automacoes-regras", {
      nome: "Boas-vindas ao contato novo",
      gatilho: "contato.criado",
      acao: "enviar_mensagem",
      parametros: { texto: "Oi {nome}! Obrigado pelo contato.", canalId },
    });
    await dono.post("/api/automacoes-regras", {
      nome: "Ligação não atendida",
      gatilho: "ligacao.encerrada",
      condicoes: [{ campo: "atendida", operador: "igual", valor: "nao" }],
      acao: "avisar",
      parametros: { texto: "Tente de novo mais tarde." },
    });
    const sim = (await vendedor.post("/api/contatos", { nome: "Paula Pode", telefone: "(11) 95432-2000" })).json();
    const nao = (await vendedor.post("/api/contatos", { nome: "Nina Não", telefone: "(11) 95432-3000", naoContatar: true })).json();
    const l = (await vendedor.post("/api/ligacoes", { provedor: "treino", contatoId: sim.id })).json();
    await vendedor.post(`/api/ligacoes/${l.id}/estado`, { estado: "encerrada" });

    await criarServicoAutomacoes(servicos, null).varrer(); // sem serviço de envio: a mensagem fica "ignorada"
    const conversas = await t.banco.pool.query("SELECT contato_id FROM conversa WHERE canal_id = $1", [canalId]);
    expect(conversas.rowCount).toBe(0);
    // Com o envio do app (o mesmo que o job usa), a mensagem sai — menos para quem pediu para não ser contatado.
    await comoSistema(t.banco, (tx) => tx.cliente.query("DELETE FROM automacao_execucao WHERE evento_id IN (SELECT id FROM evento WHERE contato_id = ANY($1) AND tipo = 'contato.criado')", [[sim.id, nao.id]]));
    const { envio } = await import("../../apps/api/src/modulos/conversas/envio.servico.js").then(async (m) => ({
      envio: m.criarServicoEnvio(servicos, { demonstracao: (await import("../../apps/api/src/modulos/conversas/provedores/demonstracao.js")).provedorDemonstracaoMensagens() } as never, null as never),
    }));
    await criarServicoAutomacoes(servicos, envio).varrer();
    const depois = await t.banco.pool.query<{ contato_id: string; texto: string }>(
      "SELECT c.contato_id, m.texto FROM conversa c JOIN mensagem m ON m.conversa_id = c.id WHERE c.canal_id = $1",
      [canalId],
    );
    expect(depois.rows).toEqual([{ contato_id: sim.id, texto: "Oi Paula! Obrigado pelo contato." }]);
    const avisos = await t.banco.pool.query("SELECT texto FROM notificacao WHERE usuario_id = $1 AND titulo = 'Ligação não atendida'", [e.a.pessoas.vendedor.usuarioId]);
    expect(avisos.rows).toEqual([{ texto: "Tente de novo mais tarde." }]);
  });
});

it("nenhum nome de cliente aparece no código", () => {
  // Nomes da operação de origem não podem estar no produto (white-label).
  const proibidos = /lumen|vendas\.lumen/i;
  const achados: string[] = [];
  const varrer = (pasta: string) => {
    for (const nome of readdirSync(pasta)) {
      if (["node_modules", "dist", ".git", "test-results", "playwright-report"].includes(nome)) continue;
      const caminho = join(pasta, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho);
      else if (/\.(ts|tsx|css|html|json|sql)$/.test(nome) && proibidos.test(readFileSync(caminho, "utf8"))) achados.push(caminho);
    }
  };
  for (const pasta of ["apps", "packages", "database"]) varrer(pasta);
  expect(achados).toEqual([]);
});
