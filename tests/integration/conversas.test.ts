// Critérios de pronto da fase 2 (Conversas): a resposta do cliente cai sempre na mesma conversa (com e sem
// nono dígito, ids alternativos), webhook repetido não duplica, envio pela fila, automações, mídia/áudio,
// carteira por escopo e junção de duplicadas antigas.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";
import { conversaDo, criarCanalDemo, esperar, simular } from "../apoio/conversas.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let canalId: string;

const contar = async (sql: string, params: unknown[]) => Number((await t.banco.pool.query(sql, params)).rows[0].count);
const mensagensDa = (conversaId: string) => contar("SELECT count(*) FROM mensagem WHERE conversa_id = $1", [conversaId]);

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  canalId = await criarCanalDemo(dono);
});
afterAll(() => t.fechar());

describe("a resposta do cliente cai sempre na mesma conversa", () => {
  it("cliente novo cria contato e conversa; a resposta dele volta para a mesma conversa", async () => {
    await simular(dono, canalId, { telefone: "(11) 97000-1001", nome: "Cliente Novo", texto: "Oi, quero saber o preço" });
    const c = await conversaDo(dono, "+5511970001001");
    expect(c).toBeDefined();
    expect(c?.contatoId).toBeTruthy();
    expect(c?.naoLidas).toBe(1);

    // O vendedor responde: a mensagem sai pela fila e o provedor de demonstração confirma a entrega.
    const resposta = await dono.post(`/api/conversas/${c?.id}/mensagens`, { texto: "Olá! Já te passo os valores." });
    expect(resposta.statusCode, resposta.body).toBe(201);
    await esperar(async () => (await t.banco.pool.query("SELECT status FROM mensagem WHERE id = $1", [resposta.json().id])).rows[0]?.status === "entregue", "envio entregue");

    await simular(dono, canalId, { telefone: "+55 11 97000-1001", texto: "Obrigado!" });
    const depois = await conversaDo(dono, "+5511970001001");
    expect(depois?.id).toBe(c?.id);
    expect(await mensagensDa(c?.id as string)).toBe(3);
    expect(await contar("SELECT count(*) FROM contato WHERE empresa_id = $1 AND telefone = '+5511970001001'", [e.a.empresaId])).toBe(1);
  });

  it("com e sem o nono dígito é a mesma conversa", async () => {
    await simular(dono, canalId, { telefone: "(11) 8000-2002", texto: "mensagem do número antigo" }); // vira +55 11 98000-2002
    await simular(dono, canalId, { telefone: "(11) 98000-2002", texto: "mensagem com o nono dígito" });
    expect(await contar("SELECT count(*) FROM conversa WHERE canal_id = $1 AND telefone = '+5511980002002'", [canalId])).toBe(1);
    const c = await conversaDo(dono, "+5511980002002");
    expect(await mensagensDa(c?.id as string)).toBe(2);
  });

  it("o provedor muda o identificador do cliente (id alternativo): continua na mesma conversa", async () => {
    await simular(dono, canalId, { telefone: "(21) 97000-3003", texto: "primeira", idExterno: "552197000303@s.whatsapp.net" });
    await simular(dono, canalId, { telefone: "(21) 97000-3003", texto: "agora com outro id", idExterno: "998877@lid" });
    const { rows } = await t.banco.pool.query("SELECT id, ids_externos FROM conversa WHERE canal_id = $1 AND telefone = '+5521970003003'", [canalId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ids_externos).toEqual(expect.arrayContaining(["552197000303@s.whatsapp.net", "998877@lid"]));
    expect(await mensagensDa(rows[0].id)).toBe(2);
  });

  it("evento repetido (mesmo id de mensagem) não duplica", async () => {
    const idMensagem = `repetida-${randomUUID()}`;
    for (let i = 0; i < 3; i++) await simular(dono, canalId, { telefone: "(31) 97000-4004", texto: "chegou três vezes", idMensagem });
    const c = await conversaDo(dono, "+5531970004004");
    expect(await mensagensDa(c?.id as string)).toBe(1);
  });

  it("dois eventos do mesmo cliente novo ao mesmo tempo criam uma conversa só", async () => {
    await Promise.all(Array.from({ length: 5 }, (_, i) => simular(dono, canalId, { telefone: "(41) 97000-5005", texto: `simultânea ${i}` })));
    expect(await contar("SELECT count(*) FROM conversa WHERE canal_id = $1 AND telefone = '+5541970005005'", [canalId])).toBe(1);
    expect(await contar("SELECT count(*) FROM contato WHERE empresa_id = $1 AND telefone = '+5541970005005'", [e.a.empresaId])).toBe(1);
    const c = await conversaDo(dono, "+5541970005005");
    expect(await mensagensDa(c?.id as string)).toBe(5);
  });
});

describe("API oficial: webhook assinado", () => {
  const appSecret = "segredo-do-app-de-teste-1234567890";
  let cloudId: string;
  const corpo = (idMensagem: string) =>
    JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: "1234567890" },
                contacts: [{ wa_id: "551197000600", profile: { name: "Cliente Meta" } }],
                messages: [{ from: "551197000600", id: idMensagem, timestamp: "1760000000", type: "text", text: { body: "Olá pela API oficial" } }],
              },
            },
          ],
        },
      ],
    });
  const assinar = (b: string) => `sha256=${createHmac("sha256", appSecret).update(b).digest("hex")}`;
  const postar = (b: string, assinatura?: string) =>
    t.app.inject({ method: "POST", url: `/api/webhooks/whatsapp/${cloudId}`, headers: { "content-type": "application/json", ...(assinatura ? { "x-hub-signature-256": assinatura } : {}) }, payload: b });

  beforeAll(async () => {
    const r = await dono.post("/api/canais", { nome: "API oficial", provedor: "cloud_api" });
    cloudId = r.json().id;
    const cred = await dono.pedir("PUT", `/api/canais/${cloudId}/credenciais`, { phoneNumberId: "1234567890", token: "token-de-teste-com-mais-de-vinte", appSecret });
    expect(cred.statusCode, cred.body).toBe(200);
    expect(cred.body).not.toContain(appSecret);
    expect(cred.json().webhookUrl).toContain(`/api/webhooks/whatsapp/${cloudId}`);
  });

  it("verificação do endereço devolve o desafio só com o token certo", async () => {
    const canal = (await dono.get("/api/canais")).json().find((c: { id: string }) => c.id === cloudId);
    const ok = await t.app.inject({ method: "GET", url: `/api/webhooks/whatsapp/${cloudId}?hub.mode=subscribe&hub.verify_token=${canal.webhookToken}&hub.challenge=desafio123` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("desafio123");
    const errado = await t.app.inject({ method: "GET", url: `/api/webhooks/whatsapp/${cloudId}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=x` });
    expect(errado.statusCode).toBe(403);
  });

  it("sem assinatura válida nada é gravado", async () => {
    const b = corpo(`wamid.${randomUUID()}`);
    expect((await postar(b)).statusCode).toBe(401);
    expect((await postar(b, "sha256=" + "0".repeat(64))).statusCode).toBe(401);
    expect(await contar("SELECT count(*) FROM mensagem WHERE canal_id = $1", [cloudId])).toBe(0);
  });

  it("webhook repetido não duplica a mensagem", async () => {
    const b = corpo("wamid.REPETIDO-1");
    for (let i = 0; i < 3; i++) expect((await postar(b, assinar(b))).statusCode).toBe(200);
    expect(await contar("SELECT count(*) FROM mensagem WHERE canal_id = $1 AND id_externo = 'wamid.REPETIDO-1'", [cloudId])).toBe(1);
    // wa_id sem o nono dígito vira o telefone canônico.
    expect(await contar("SELECT count(*) FROM conversa WHERE canal_id = $1 AND telefone = '+5511997000600'", [cloudId])).toBe(1);
  });

  it("status fora de ordem não volta atrás", async () => {
    const { rows } = await t.banco.pool.query("SELECT id FROM conversa WHERE canal_id = $1", [cloudId]);
    const [m] = (
      await comoSistema(t.banco, (tx) =>
        tx.cliente.query(
          `INSERT INTO mensagem (empresa_id, conversa_id, canal_id, direcao, tipo, texto, status, id_externo) VALUES ($1, $2, $3, 'saida', 'texto', 'oi', 'enviada', 'wamid.SAIDA-1') RETURNING id`,
          [e.a.empresaId, rows[0].id, cloudId],
        ),
      )
    ).rows;
    const status = (s: string) =>
      JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" }, statuses: [{ id: "wamid.SAIDA-1", status: s }] } }] }] });
    for (const s of ["read", "delivered", "sent"]) {
      const b = status(s);
      expect((await postar(b, assinar(b))).statusCode).toBe(200);
    }
    expect((await t.banco.pool.query("SELECT status FROM mensagem WHERE id = $1", [m.id])).rows[0].status).toBe("lida");
  });
});

describe("carteira por escopo", () => {
  it("vendedor vê a fila sem dono e as próprias, nunca as de outro vendedor; ao responder, assume a conversa", async () => {
    const v1 = await logado(t.app, email(e.a, "vendedor"));
    const v2 = await logado(t.app, email(e.a, "vendedor2"));
    await simular(dono, canalId, { telefone: "(11) 97000-7007", texto: "alguém me atende?" });
    const c = await conversaDo(v1, "+5511970007007");
    expect(c?.atribuidaA).toBeNull();

    const r = await v1.post(`/api/conversas/${c?.id}/mensagens`, { texto: "Eu atendo você!" });
    expect(r.statusCode, r.body).toBe(201);
    expect((await conversaDo(v1, "+5511970007007"))?.atribuidaA).toBe(e.a.pessoas.vendedor.usuarioId);

    // Agora é do vendedor 1: o vendedor 2 não vê nem consegue responder ou transferir.
    expect(await conversaDo(v2, "+5511970007007")).toBeUndefined();
    expect((await v2.get(`/api/conversas/${c?.id}`)).statusCode).toBe(404);
    expect((await v2.post(`/api/conversas/${c?.id}/mensagens`, { texto: "roubando" })).statusCode).toBe(404);
    // Vendedor (escopo próprio) não passa conversa para outra pessoa.
    expect((await v1.post(`/api/conversas/${c?.id}/atribuir`, { usuarioId: e.a.pessoas.vendedor2.usuarioId })).statusCode).toBe(400);
    // O gestor da equipe transfere.
    const gestor = await logado(t.app, email(e.a, "gestor"));
    const transf = await gestor.post(`/api/conversas/${c?.id}/atribuir`, { usuarioId: e.a.pessoas.vendedor.usuarioId });
    expect(transf.statusCode, transf.body).toBe(200);
  });

  it("nota interna não é enviada ao cliente", async () => {
    const c = await conversaDo(dono, "+5511970007007");
    const r = await dono.post(`/api/conversas/${c?.id}/mensagens`, { texto: "Cliente pediu desconto, ver com a gestão", nota: true });
    expect(r.statusCode).toBe(201);
    const { rows } = await t.banco.pool.query("SELECT direcao, status FROM mensagem WHERE id = $1", [r.json().id]);
    expect(rows[0]).toEqual({ direcao: "nota", status: "enviada" });
    expect(await contar("SELECT count(*) FROM pgboss.job WHERE name = 'conversas.envio' AND data->>'mensagemId' = $1", [r.json().id])).toBe(0);
  });
});

describe("mensagens automáticas", () => {
  it("boas-vindas na primeira mensagem, com variáveis; não repete na segunda", async () => {
    expect((await dono.pedir("PUT", "/api/automacoes/boas_vindas", { texto: "Olá, {nome}! Aqui é da {empresa}.", ativa: true })).statusCode).toBe(200);
    await simular(dono, canalId, { telefone: "(11) 97000-8008", nome: "Mariana Souza", texto: "oi" });
    await simular(dono, canalId, { telefone: "(11) 97000-8008", texto: "tudo bem?" });
    const c = await conversaDo(dono, "+5511970008008");
    const { rows } = await t.banco.pool.query("SELECT texto FROM mensagem WHERE conversa_id = $1 AND automacao = 'boas_vindas'", [c?.id]);
    expect(rows).toEqual([{ texto: `Olá, Mariana! Aqui é da ${e.a.d.nome}.` }]);
    await dono.pedir("PUT", "/api/automacoes/boas_vindas", { texto: "x", ativa: false });
  });

  it("fora do horário responde uma vez a cada 12 h", async () => {
    // Canal sem nenhum dia de atendimento: está sempre fora do horário.
    expect((await dono.patch(`/api/canais/${canalId}`, { horario: { dias: [], inicio: "08:00", fim: "18:00" } })).statusCode).toBe(200);
    await dono.pedir("PUT", "/api/automacoes/fora_horario", { texto: "Estamos fora do horário, respondemos amanhã.", ativa: true });
    await simular(dono, canalId, { telefone: "(11) 97000-9009", texto: "olá?" });
    await simular(dono, canalId, { telefone: "(11) 97000-9009", texto: "alguém?" });
    const c = await conversaDo(dono, "+5511970009009");
    expect(await contar("SELECT count(*) FROM mensagem WHERE conversa_id = $1 AND automacao = 'fora_horario'", [c?.id])).toBe(1);
    await dono.pedir("PUT", "/api/automacoes/fora_horario", { texto: "x", ativa: false });
    await dono.patch(`/api/canais/${canalId}`, { horario: { dias: [1, 2, 3, 4, 5, 6, 7], inicio: "00:00", fim: "23:59" } });
  });

  it("follow-up é agendado ao responder e só sai se o cliente não respondeu", async () => {
    await dono.pedir("PUT", "/api/automacoes/follow_up", { texto: "{nome}, conseguiu ver a proposta?", horas: 24, ativa: true });
    await simular(dono, canalId, { telefone: "(11) 97001-0010", nome: "Paulo", texto: "manda a proposta" });
    const c = await conversaDo(dono, "+5511970010010");
    const enviada = await dono.post(`/api/conversas/${c?.id}/mensagens`, { texto: "Segue a proposta!" });
    const { rows } = await t.banco.pool.query(
      "SELECT data, start_after FROM pgboss.job WHERE name = 'conversas.follow_up' AND data->>'mensagemId' = $1",
      [enviada.json().id],
    );
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].start_after).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

    // Executa o job agora (sem esperar 24 h) duas vezes: só um follow-up sai.
    const { criarServicoEnvio } = await import("../../apps/api/src/modulos/conversas/envio.servico.js");
    const envio = criarServicoEnvio({ config: t.config, banco: t.banco, jobs: t.jobs, avisos: undefined as never, tempoReal: t.tempoReal }, {} as never, {} as never);
    await envio.processarFollowUp(rows[0].data);
    await envio.processarFollowUp(rows[0].data);
    const fu = await t.banco.pool.query("SELECT texto FROM mensagem WHERE conversa_id = $1 AND automacao = 'follow_up'", [c?.id]);
    expect(fu.rows).toEqual([{ texto: "Paulo, conseguiu ver a proposta?" }]);

    // Se o cliente responde, o follow-up de uma mensagem anterior não sai.
    const outra = await dono.post(`/api/conversas/${c?.id}/mensagens`, { texto: "Mais alguma dúvida?" });
    await simular(dono, canalId, { telefone: "(11) 97001-0010", texto: "não, obrigado" });
    const job2 = (await t.banco.pool.query("SELECT data FROM pgboss.job WHERE name = 'conversas.follow_up' AND data->>'mensagemId' = $1", [outra.json().id])).rows[0];
    await envio.processarFollowUp(job2.data);
    expect(await contar("SELECT count(*) FROM mensagem WHERE conversa_id = $1 AND automacao = 'follow_up'", [c?.id])).toBe(1);
    await dono.pedir("PUT", "/api/automacoes/follow_up", { texto: "x", horas: 24, ativa: false });
  });
});

describe("mídia e áudio", () => {
  it("imagem recebida é baixada pelo job e servida só a quem vê a conversa", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await simular(dono, canalId, { telefone: "(11) 97001-1011", texto: "olha a foto", midia: { nome: "foto.png", mime: "image/png", base64: png.toString("base64") } });
    const c = await conversaDo(dono, "+5511970011011");
    const m = await esperar(async () => (await t.banco.pool.query("SELECT id FROM mensagem WHERE conversa_id = $1 AND arquivo_id IS NOT NULL", [c?.id])).rows[0], "mídia baixada");
    const r = await dono.get(`/api/mensagens/${m.id}/midia`);
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(Buffer.from(r.rawPayload).equals(png)).toBe(true);
    const outraEmpresa = await logado(t.app, email(e.b, "dono"));
    expect((await outraEmpresa.get(`/api/mensagens/${m.id}/midia`)).statusCode).toBe(404);
  });

  it("áudio gravado no navegador (WebM) vira mensagem de voz Ogg e é enviado", async () => {
    const c = await conversaDo(dono, "+5511970011011");
    const webm = readFileSync(new URL("../../apps/api/src/modulos/conversas/__fixtures__/voz-ao-vivo.webm", import.meta.url));
    const r = await dono.enviarArquivo(`/api/conversas/${c?.id}/midia`, "gravacao.webm", webm, "audio/webm;codecs=opus");
    expect(r.statusCode, r.body).toBe(201);
    const { rows } = await t.banco.pool.query("SELECT tipo, midia_mime, midia_nome FROM mensagem WHERE id = $1", [r.json().id]);
    expect(rows[0]).toEqual({ tipo: "audio", midia_mime: "audio/ogg", midia_nome: "gravacao.ogg" });
    await esperar(async () => (await t.banco.pool.query("SELECT status FROM mensagem WHERE id = $1", [r.json().id])).rows[0]?.status === "entregue", "áudio entregue");
    const arquivo = await dono.get(`/api/mensagens/${r.json().id}/midia`);
    expect(Buffer.from(arquivo.rawPayload).subarray(0, 4).toString("latin1")).toBe("OggS");
  });
});

describe("junção de conversas duplicadas antigas", () => {
  it("junta as do mesmo cliente (com e sem nono dígito), move as mensagens e não apaga nada", async () => {
    // Simula dados antigos: duas conversas para o mesmo número, uma em cada formato.
    const [a, b] = await comoSistema(t.banco, async (tx) => {
      const ids: string[] = [];
      for (const tel of ["+5511970012012", "+551170012012"]) {
        const { rows } = await tx.cliente.query(
          "INSERT INTO conversa (empresa_id, canal_id, telefone, ids_externos, criado_em) VALUES ($1, $2, $3, '{}', now() - ($4 || ' minutes')::interval) RETURNING id",
          [e.a.empresaId, canalId, tel, ids.length ? "1" : "10"],
        );
        ids.push(rows[0].id);
        await tx.cliente.query("INSERT INTO mensagem (empresa_id, conversa_id, canal_id, direcao, tipo, texto, status) VALUES ($1, $2, $3, 'entrada', 'texto', 'antiga', 'recebida')", [
          e.a.empresaId,
          rows[0].id,
          canalId,
        ]);
      }
      return ids;
    });
    const r = await dono.post("/api/conversas/juntar-duplicadas");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().juntadas).toBeGreaterThanOrEqual(1);
    expect(await mensagensDa(a)).toBe(2);
    const { rows } = await t.banco.pool.query("SELECT mesclada_em_id FROM conversa WHERE id = $1", [b]);
    expect(rows[0].mesclada_em_id).toBe(a);
    // Rodar de novo não faz nada.
    expect((await dono.post("/api/conversas/juntar-duplicadas")).json().juntadas).toBe(0);
  });
});
