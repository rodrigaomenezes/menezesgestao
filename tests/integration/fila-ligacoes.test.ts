// Critérios de pronto da fase 3: dois vendedores (ou vinte) pedindo "próximo" ao mesmo tempo nunca recebem o
// mesmo lead; reserva expira; resultados reagendam, encerram, descartam ou convertem; ligação encerrada aparece
// no histórico sem digitação; gravação cifrada com link temporário e acesso registrado; importação alimenta fila.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { criarPessoas, email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";
import { importarCsv } from "../apoio/crm.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let resultados: { id: string; nome: string; acao: string }[];
let contadorTel = 0;

const resultado = (nome: string) => {
  const r = resultados.find((x) => x.nome === nome);
  if (!r) throw new Error(`resultado ${nome}`);
  return r.id;
};

/** Cria N contatos (sem dono, para a fila de todos) e devolve os ids. */
async function contatos(n: number, extra: Record<string, unknown> = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const tel = `(11) 9${String(3000_0000 + contadorTel++).padStart(8, "0")}`;
    const r = await dono.post("/api/contatos", { nome: `Lead ${contadorTel}`, telefone: tel, ...extra });
    expect(r.statusCode, r.body).toBe(201);
    ids.push(r.json().id);
  }
  // Sem dono: entram na fila de todos (o dono criou, mas a fila é da equipe).
  await comoSistema(t.banco, (tx) => tx.cliente.query("UPDATE contato SET responsavel_id = NULL WHERE id = ANY($1)", [ids]));
  return ids;
}

async function novaFila(nome: string, extra: Record<string, unknown> = {}, n = 0): Promise<string> {
  const f = await dono.post("/api/filas", { nome, ...extra });
  expect(f.statusCode, f.body).toBe(201);
  if (n) {
    const ids = await contatos(n);
    const r = await dono.post(`/api/filas/${f.json().id}/itens`, { contatoIds: ids });
    expect(r.json().adicionados).toBe(n);
  }
  return f.json().id;
}

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  resultados = (await dono.get("/api/telefonia/resultados")).json();
});
afterAll(() => t.fechar());

describe("reserva exclusiva (trava no banco)", () => {
  it("20 pedidos simultâneos de próximo lead nunca entregam o mesmo item a duas pessoas", async () => {
    const filaId = await novaFila("Concorrência", {}, 30);
    const pessoas = await Promise.all((await criarPessoas(t.banco, e.a, 20)).map((em) => logado(t.app, em)));
    const respostas = await Promise.all(pessoas.map((p) => p.post(`/api/filas/${filaId}/proximo`)));
    const itens = respostas.map((r) => {
      expect(r.statusCode, r.body).toBe(200);
      return r.json().item?.id as string;
    });
    expect(itens.every(Boolean)).toBe(true);
    expect(new Set(itens).size).toBe(20);
    const { rows } = await t.banco.pool.query("SELECT count(DISTINCT reservado_por) AS pessoas, count(*) AS reservados FROM fila_item WHERE fila_id = $1 AND status = 'reservado'", [filaId]);
    expect(Number(rows[0].reservados)).toBe(20);
    expect(Number(rows[0].pessoas)).toBe(20);
  });

  it("com menos itens que pessoas, cada item vai para uma só e o resto ouve que acabou", async () => {
    const filaId = await novaFila("Poucos", {}, 5);
    const pessoas = await Promise.all((await criarPessoas(t.banco, e.a, 20)).map((em) => logado(t.app, em)));
    const respostas = await Promise.all(pessoas.map((p) => p.post(`/api/filas/${filaId}/proximo`)));
    const itens = respostas.map((r) => r.json().item?.id).filter(Boolean);
    expect(itens).toHaveLength(5);
    expect(new Set(itens).size).toBe(5);
    expect(respostas.filter((r) => !r.json().item).every((r) => /Ninguém para ligar/.test(r.json().motivo))).toBe(true);
  });

  it("pedir de novo devolve a mesma reserva; reserva vencida passa para outra pessoa", async () => {
    const filaId = await novaFila("Expira", { reservaMinutos: 5 }, 1);
    const [a, b] = await Promise.all((await criarPessoas(t.banco, e.a, 2)).map((em) => logado(t.app, em)));
    const primeiro = (await a.post(`/api/filas/${filaId}/proximo`)).json().item;
    expect((await a.post(`/api/filas/${filaId}/proximo`)).json().item.id).toBe(primeiro.id);
    expect((await b.post(`/api/filas/${filaId}/proximo`)).json().item).toBeNull();

    await t.banco.pool.query("UPDATE fila_item SET reservado_ate = now() - interval '1 minute' WHERE id = $1", [primeiro.id]);
    expect((await b.post(`/api/filas/${filaId}/proximo`)).json().item.id).toBe(primeiro.id);
    // Quem perdeu a reserva não registra mais resultado nela.
    const tarde = await a.post(`/api/fila-itens/${primeiro.id}/resultado`, { resultadoId: resultado("Não atendeu") });
    expect(tarde.statusCode).toBe(409);
  });

  it("a fila respeita a ordem em que os contatos entraram (mesmo no mesmo lote)", async () => {
    const f = (await dono.post("/api/filas", { nome: "Ordem" })).json().id;
    const ids = await contatos(4);
    await dono.post(`/api/filas/${f}/itens`, { contatoIds: ids });
    const entregues: string[] = [];
    for (let i = 0; i < 4; i++) {
      const item = (await dono.post(`/api/filas/${f}/proximo`)).json().item;
      entregues.push(item.contatoId);
      await dono.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: resultado("Sem interesse") });
    }
    expect(entregues).toEqual(ids);
  });

  it("fila pausada não entrega ninguém e devolve as reservas", async () => {
    const filaId = await novaFila("Pausável", {}, 2);
    const item = (await dono.post(`/api/filas/${filaId}/proximo`)).json().item;
    expect(item).toBeTruthy();
    await dono.patch(`/api/filas/${filaId}`, { status: "pausada" });
    expect((await dono.post(`/api/filas/${filaId}/proximo`)).json()).toEqual({ item: null, motivo: "A fila está pausada." });
    const { rows } = await t.banco.pool.query("SELECT status FROM fila_item WHERE id = $1", [item.id]);
    expect(rows[0].status).toBe("pendente");
  });

  it("vendedor não recebe contato da carteira de outro vendedor", async () => {
    const filaId = await novaFila("Carteira");
    const [doVendedor2] = await contatos(1);
    await comoSistema(t.banco, (tx) => tx.cliente.query("UPDATE contato SET responsavel_id = $1 WHERE id = $2", [e.a.pessoas.vendedor2.usuarioId, doVendedor2]));
    await dono.post(`/api/filas/${filaId}/itens`, { contatoIds: [doVendedor2] });
    const v1 = await logado(t.app, email(e.a, "vendedor"));
    expect((await v1.post(`/api/filas/${filaId}/proximo`)).json().item).toBeNull();
    const v2 = await logado(t.app, email(e.a, "vendedor2"));
    expect((await v2.post(`/api/filas/${filaId}/proximo`)).json().item.contatoId).toBe(doVendedor2);
  });

  it("contato que pediu para não ser contatado sai da fila e não pode ser discado", async () => {
    const filaId = await novaFila("LGPD");
    const [c] = await contatos(1);
    await dono.post(`/api/filas/${filaId}/itens`, { contatoIds: [c] });
    await dono.patch(`/api/contatos/${c}`, { naoContatar: true });
    expect((await dono.post(`/api/filas/${filaId}/proximo`)).json().item).toBeNull();
    expect((await t.banco.pool.query("SELECT status FROM fila_item WHERE contato_id = $1", [c])).rows[0].status).toBe("descartado");
    const lig = await dono.post("/api/ligacoes", { provedor: "treino", contatoId: c });
    expect(lig.statusCode).toBe(400);
    expect(lig.json().error.message).toMatch(/não ser contatado/);
  });

  it("contato pendente em outra fila não entra de novo", async () => {
    const f1 = await novaFila("Primeira");
    const f2 = await novaFila("Segunda");
    const [c] = await contatos(1);
    expect((await dono.post(`/api/filas/${f1}/itens`, { contatoIds: [c] })).json().adicionados).toBe(1);
    expect((await dono.post(`/api/filas/${f2}/itens`, { contatoIds: [c] })).json()).toMatchObject({ adicionados: 0, emOutraFila: 1 });
  });
});

describe("resultados", () => {
  it("não atendeu reagenda; o item só volta na hora marcada", async () => {
    const filaId = await novaFila("Reagenda", {}, 1);
    const item = (await dono.post(`/api/filas/${filaId}/proximo`)).json().item;
    const r = await dono.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: resultado("Não atendeu") });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().item.status).toBe("pendente");
    expect(new Date(r.json().item.retornarEm).getTime()).toBeGreaterThan(Date.now() + 3.9 * 3600_000);
    expect((await dono.post(`/api/filas/${filaId}/proximo`)).json().item).toBeNull();
    await t.banco.pool.query("UPDATE fila_item SET retornar_em = now() - interval '1 minute' WHERE id = $1", [item.id]);
    expect((await dono.post(`/api/filas/${filaId}/proximo`)).json().item.id).toBe(item.id);
  });

  it("retornar em… exige a data; esgotar as tentativas tira da fila", async () => {
    const filaId = await novaFila("Tentativas", { maxTentativas: 2 }, 1);
    let item = (await dono.post(`/api/filas/${filaId}/proximo`)).json().item;
    expect((await dono.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: resultado("Retornar em…") })).statusCode).toBe(400);
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    expect((await dono.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: resultado("Retornar em…"), retornarEm: amanha })).json().item.retornarEm).toBe(amanha);
    await t.banco.pool.query("UPDATE fila_item SET retornar_em = NULL WHERE id = $1", [item.id]);
    item = (await dono.post(`/api/filas/${filaId}/proximo`)).json().item;
    const r = await dono.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: resultado("Não atendeu") });
    expect(r.json().item).toMatchObject({ status: "concluido", tentativas: 2 });
  });

  it("número errado descarta; convertido cria oportunidade no funil e dá dono ao contato", async () => {
    const filaId = await novaFila("Conversão", {}, 2);
    const a = (await dono.post(`/api/filas/${filaId}/proximo`)).json().item;
    expect((await dono.post(`/api/fila-itens/${a.id}/resultado`, { resultadoId: resultado("Número errado") })).json().item.status).toBe("descartado");
    const b = (await dono.post(`/api/filas/${filaId}/proximo`)).json().item;
    const r = await dono.post(`/api/fila-itens/${b.id}/resultado`, { resultadoId: resultado("Convertido"), observacao: "Quer começar mês que vem" });
    expect(r.json().item.status).toBe("concluido");
    const op = r.json().oportunidadeId;
    expect(op).toBeTruthy();
    const { rows } = await t.banco.pool.query("SELECT o.contato_id, c.responsavel_id FROM oportunidade o JOIN contato c ON c.id = o.contato_id WHERE o.id = $1", [op]);
    expect(rows[0]).toEqual({ contato_id: b.contatoId, responsavel_id: e.a.pessoas.dono.usuarioId });
    const historico = (await dono.get(`/api/contatos/${b.contatoId}/historico`)).json().itens.map((h: { tipo: string }) => h.tipo);
    expect(historico).toEqual(expect.arrayContaining(["fila.resultado_registrado", "oportunidade.criada"]));
  });
});

describe("ligações", () => {
  it("ciclo completo no modo treino; encerrada aparece no histórico com a duração, sem digitação", async () => {
    const [c] = await contatos(1);
    const criada = await dono.post("/api/ligacoes", { provedor: "treino", contatoId: c });
    expect(criada.statusCode, criada.body).toBe(201);
    const id = criada.json().id;
    expect(criada.json()).toMatchObject({ estado: "criada", numero: expect.stringMatching(/^\+55/) });
    for (const estado of ["discando", "tocando", "em_ligacao", "em_espera", "em_ligacao"]) {
      expect((await dono.post(`/api/ligacoes/${id}/estado`, { estado })).statusCode).toBe(200);
    }
    await t.banco.pool.query("UPDATE ligacao SET atendida_em = now() - interval '75 seconds' WHERE id = $1", [id]);
    const fim = await dono.post(`/api/ligacoes/${id}/estado`, { estado: "encerrada", detalhe: "desligou" });
    expect(fim.json()).toMatchObject({ estado: "encerrada", motivoFim: "desligou" });
    expect(fim.json().duracaoSegundos).toBeGreaterThanOrEqual(75);
    // Evento repetido não muda nada; transição inválida é recusada.
    expect((await dono.post(`/api/ligacoes/${id}/estado`, { estado: "encerrada" })).statusCode).toBe(200);
    expect((await dono.post(`/api/ligacoes/${id}/estado`, { estado: "tocando" })).statusCode).toBe(400);

    const historico = (await dono.get(`/api/contatos/${c}/historico`)).json().itens;
    const ev = historico.find((h: { tipo: string }) => h.tipo === "ligacao.encerrada");
    expect(ev.dados).toMatchObject({ atendida: true, provedor: "treino" });
    expect(ev.dados.duracaoSegundos).toBeGreaterThanOrEqual(75);
    const { rows } = await t.banco.pool.query("SELECT estado FROM ligacao_evento WHERE ligacao_id = $1 ORDER BY criado_em", [id]);
    expect(rows.map((r) => r.estado)).toEqual(["criada", "discando", "tocando", "em_ligacao", "em_espera", "em_ligacao", "encerrada"]);
  });

  it("só quem fez a ligação muda o estado dela", async () => {
    const [c] = await contatos(1);
    const id = (await dono.post("/api/ligacoes", { provedor: "treino", contatoId: c })).json().id;
    const gestor = await logado(t.app, email(e.a, "gestor"));
    expect((await gestor.post(`/api/ligacoes/${id}/estado`, { estado: "discando" })).statusCode).toBe(404);
  });

  it("ligação de item da fila exige a reserva; resultado da fila vai para a ligação", async () => {
    const filaId = await novaFila("Ligação da fila", {}, 1);
    const item = (await dono.post(`/api/filas/${filaId}/proximo`)).json().item;
    const v1 = await logado(t.app, email(e.a, "vendedor"));
    expect((await v1.post("/api/ligacoes", { provedor: "celular", filaItemId: item.id })).statusCode).toBe(409);
    const lig = (await dono.post("/api/ligacoes", { provedor: "celular", filaItemId: item.id })).json();
    await dono.post(`/api/ligacoes/${lig.id}/estado`, { estado: "discando" });
    await dono.post(`/api/ligacoes/${lig.id}/estado`, { estado: "encerrada", detalhe: "não atendeu" });
    await dono.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: resultado("Caixa postal"), ligacaoId: lig.id, observacao: "caixa cheia" });
    expect((await dono.get(`/api/ligacoes/${lig.id}`)).json()).toMatchObject({ resultadoNome: "Caixa postal", observacao: "caixa cheia" });
  });

  it("SIP só aparece com servidor e ramal; a senha do ramal só vai para a própria pessoa", async () => {
    expect((await dono.get("/api/telefonia/meu")).json()).toMatchObject({ provedores: ["celular", "treino"], sip: null });
    expect((await dono.post("/api/ligacoes", { provedor: "sip", numero: "11 98888-1234" })).statusCode).toBe(400);
    await dono.pedir("PUT", "/api/telefonia/config", { sipServidor: "wss://sip.exemplo.com:8089/ws", sipDominio: "sip.exemplo.com", gravacaoAtiva: false, avisoGravacao: "Ligação gravada.", retencaoDias: 30 });
    const r = await dono.pedir("PUT", `/api/telefonia/ramais/${e.a.pessoas.dono.usuarioId}`, { login: "1001", senha: "senha-do-ramal-secreta" });
    expect(r.statusCode, r.body).toBe(200);
    expect((await dono.get("/api/telefonia/ramais")).body).not.toContain("senha-do-ramal-secreta");
    const { rows } = await t.banco.pool.query("SELECT senha FROM ramal WHERE usuario_id = $1", [e.a.pessoas.dono.usuarioId]);
    expect(rows[0].senha).not.toContain("senha-do-ramal");
    const meu = (await dono.get("/api/telefonia/meu")).json();
    expect(meu.provedores[0]).toBe("sip");
    expect(meu.sip).toEqual({ servidor: "wss://sip.exemplo.com:8089/ws", dominio: "sip.exemplo.com", login: "1001", senha: "senha-do-ramal-secreta" });
    expect((await logado(t.app, email(e.a, "vendedor")).then((v) => v.get("/api/telefonia/meu"))).json().sip).toBeNull();
  });
});

describe("gravação", () => {
  it("cifrada no banco, ouvida por link temporário, cada acesso registrado; some depois da retenção", async () => {
    await dono.pedir("PUT", "/api/telefonia/config", { gravacaoAtiva: true, avisoGravacao: "Esta ligação será gravada.", retencaoDias: 30 });
    const [c] = await contatos(1);
    const id = (await dono.post("/api/ligacoes", { provedor: "treino", contatoId: c })).json().id;
    const audio = Buffer.concat([Buffer.from("WEBM-AUDIO-MARCADOR-"), randomBytes(2000)]);
    const envio = await dono.enviarArquivo(`/api/ligacoes/${id}/gravacao`, "gravacao.webm", audio, "audio/webm");
    expect(envio.statusCode, envio.body).toBe(201);
    expect(envio.json().temGravacao).toBe(true);
    const { rows } = await t.banco.pool.query("SELECT a.conteudo FROM ligacao l JOIN arquivo a ON a.id = l.gravacao_arquivo_id WHERE l.id = $1", [id]);
    expect(rows[0].conteudo.includes(Buffer.from("WEBM-AUDIO-MARCADOR"))).toBe(false);

    const link = (await dono.post(`/api/ligacoes/${id}/gravacao/acesso`)).json();
    const ouvir = await dono.get(link.url);
    expect(ouvir.statusCode).toBe(200);
    expect(Buffer.from(ouvir.rawPayload).equals(audio)).toBe(true);
    expect(Number((await t.banco.pool.query("SELECT count(*) FROM auditoria WHERE acao = 'gravacao.acessada' AND entidade_id = $1", [id])).rows[0].count)).toBe(1);

    // O link é pessoal e vence.
    const gestor = await logado(t.app, email(e.a, "gestor"));
    expect((await gestor.get(link.url)).statusCode).toBe(403);
    const [, , assinatura] = link.url.split("/").pop().split(".");
    expect((await dono.get(`/api/gravacoes/${id}.${Date.now() - 1000}.${assinatura}`)).statusCode).toBe(403);

    // Retenção: conteúdo apagado, ligação e registros ficam.
    await t.banco.pool.query("UPDATE ligacao SET gravacao_expira_em = now() - interval '1 day' WHERE id = $1", [id]);
    const { criarServicoTelefonia } = await import("../../apps/api/src/modulos/telefonia/telefonia.servico.js");
    const { provedorArquivosBanco } = await import("../../apps/api/src/modulos/arquivos/armazenamento.js");
    const servico = criarServicoTelefonia({ config: t.config, banco: t.banco, jobs: t.jobs, avisos: undefined as never, tempoReal: t.tempoReal }, provedorArquivosBanco(t.banco));
    expect(await servico.aplicarRetencao()).toBeGreaterThanOrEqual(1);
    const novoLink = (await dono.post(`/api/ligacoes/${id}/gravacao/acesso`)).json();
    expect((await dono.get(novoLink.url)).statusCode).toBe(410);
    expect((await dono.get(`/api/ligacoes/${id}`)).statusCode).toBe(200);
  });

  it("com a gravação desligada, o envio é recusado", async () => {
    await dono.pedir("PUT", "/api/telefonia/config", { gravacaoAtiva: false, avisoGravacao: "x", retencaoDias: 30 });
    const [c] = await contatos(1);
    const id = (await dono.post("/api/ligacoes", { provedor: "treino", contatoId: c })).json().id;
    expect((await dono.enviarArquivo(`/api/ligacoes/${id}/gravacao`, "g.webm", Buffer.from("x"), "audio/webm")).statusCode).toBe(400);
  });
});

describe("importação que alimenta fila", () => {
  it("cria a fila e separa novos, atualizados, já em outra fila e já ligados", async () => {
    // Um contato já existente, um já em outra fila e um que já recebeu ligação.
    const [existente, emOutra, ligado] = await contatos(3);
    const tels = (await t.banco.pool.query("SELECT id, telefone FROM contato WHERE id = ANY($1)", [[existente, emOutra, ligado]])).rows;
    const tel = (id: string) => tels.find((x) => x.id === id).telefone;
    const outra = await novaFila("Outra fila");
    await dono.post(`/api/filas/${outra}/itens`, { contatoIds: [emOutra] });
    const lig = (await dono.post("/api/ligacoes", { provedor: "treino", contatoId: ligado })).json();
    await dono.post(`/api/ligacoes/${lig.id}/estado`, { estado: "encerrada" });

    const csv = ["Nome;Telefone", "Novo da planilha;(21) 97777-1111", `Existente;${tel(existente)}`, `Em outra;${tel(emOutra)}`, `Ligado;${tel(ligado)}`, "Sem telefone;"].join("\n");
    const tipo = (await dono.get("/api/tipos-base")).json()[0].id;
    const r = await importarCsv(dono, csv, { novaFila: { nome: "Feira de outubro", tipoBaseId: tipo } });
    expect(r.status).toBe("CONCLUIDA_COM_ERROS");
    const rel = (await dono.get(`/api/importacoes/${r.id}`)).json().fila;
    expect(rel).toMatchObject({ nome: "Feira de outubro", novos: 1, atualizados: 1, emOutraFila: 1, jaLigados: 1 });
    const fila = (await dono.get(`/api/filas/${rel.id}`)).json();
    expect(fila).toMatchObject({ total: 3, tipoBaseNome: expect.any(String) });
    expect((await dono.get(`/api/filas/${rel.id}/lotes`)).json()[0]).toMatchObject({ novos: 1, emOutraFila: 1, ignorados: 1 });
  });

  it("vendedor não cria fila pela importação", async () => {
    const v1 = await logado(t.app, email(e.a, "vendedor"));
    const enviada = await v1.enviarArquivo("/api/importacoes", "x.csv", "Nome;Telefone\nX;(11) 96666-0000\n");
    const r = await v1.post(`/api/importacoes/${enviada.json().id}/confirmar`, { mapeamento: { nome: "Nome", telefone: "Telefone" }, novaFila: { nome: "Minha" } });
    expect(r.statusCode).toBe(400);
  });
});
