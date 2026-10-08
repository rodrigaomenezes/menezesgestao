import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assinaturaValida, interpretarWebhook, provedorCloudApi } from "./cloud-api.js";
import { interpretarMensagemQr } from "./qr.js";
import { ErroProvedor } from "./tipos.js";

const canalCloud = { id: "c1", empresaId: "e1", provedor: "cloud_api" as const, identificadorExterno: "111", credenciais: { phoneNumberId: "111", token: "tok", appSecret: "s" } };

describe("API oficial", () => {
  it("assinatura: aceita só o HMAC certo dos bytes exatos", () => {
    const corpo = Buffer.from('{"a":1}');
    const ok = `sha256=${createHmac("sha256", "segredo").update(corpo).digest("hex")}`;
    expect(assinaturaValida(corpo, ok, "segredo")).toBe(true);
    expect(assinaturaValida(Buffer.from('{"a": 1}'), ok, "segredo")).toBe(false);
    expect(assinaturaValida(corpo, ok, "outro")).toBe(false);
    expect(assinaturaValida(corpo, undefined, "segredo")).toBe(false);
    expect(assinaturaValida(corpo, "sha256=zz", "segredo")).toBe(false);
  });

  it("webhook → eventos: texto, mídia com legenda, status; ignora outro número", () => {
    const corpo = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "111" },
                contacts: [{ wa_id: "551188887777", profile: { name: "Ana" } }],
                messages: [
                  { from: "551188887777", id: "w1", timestamp: "1700000000", type: "text", text: { body: "oi" } },
                  { from: "551188887777", id: "w2", type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "foto" } },
                ],
                statuses: [{ id: "w0", status: "delivered" }, { id: "w9", status: "failed", errors: [{ title: "Recusada" }] }],
              },
            },
            { value: { metadata: { phone_number_id: "999" }, messages: [{ from: "1", id: "x", type: "text", text: { body: "outro número" } }] } },
          ],
        },
      ],
    };
    const ev = interpretarWebhook(corpo, "111");
    expect(ev).toHaveLength(4);
    expect(ev[0]).toMatchObject({ tipo: "mensagem", idExterno: "w1", telefone: "+5511988887777", nome: "Ana", texto: "oi", em: new Date(1_700_000_000_000) });
    expect(ev[1]).toMatchObject({ conteudo: "imagem", texto: "foto", midia: { ref: { id: "m1" }, mime: "image/jpeg" } });
    expect(ev[2]).toEqual({ tipo: "status", idExterno: "w0", status: "entregue", erro: null });
    expect(ev[3]).toMatchObject({ status: "falhou", erro: "Recusada" });
  });

  it("envia texto pela Graph API com o token do canal", async () => {
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const falso = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.OK" }] }), { status: 200 });
    }) as typeof fetch;
    const p = provedorCloudApi({ graphUrl: "https://graph.teste/v21.0", fetch: falso });
    const r = await p.enviar(canalCloud, { telefone: "+5511988887777", idExterno: null }, { tipo: "texto", texto: "olá" });
    expect(r.idExterno).toBe("wamid.OK");
    expect(chamadas[0].url).toBe("https://graph.teste/v21.0/111/messages");
    expect((chamadas[0].init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(chamadas[0].init?.body as string)).toMatchObject({ to: "5511988887777", type: "text", text: { body: "olá" } });
  });

  it("fora da janela de 24 h é erro definitivo, com mensagem clara", async () => {
    const falso = (async () => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 })) as unknown as typeof fetch;
    const p = provedorCloudApi({ fetch: falso });
    const erro = await p.enviar(canalCloud, { telefone: "+5511988887777", idExterno: null }, { tipo: "texto", texto: "x" }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroProvedor);
    expect((erro as ErroProvedor).temporario).toBe(false);
    expect((erro as ErroProvedor).message).toMatch(/24 horas/);
  });

  it("limite da Meta é temporário (o job tenta de novo)", async () => {
    const falso = (async () => new Response(JSON.stringify({ error: { code: 130429 } }), { status: 429 })) as unknown as typeof fetch;
    const erro = await provedorCloudApi({ fetch: falso }).enviar(canalCloud, { telefone: "+5511988887777", idExterno: null }, { tipo: "texto", texto: "x" }).catch((e: unknown) => e);
    expect((erro as ErroProvedor).temporario).toBe(true);
  });
});

describe("conexão por QR", () => {
  const base = { messageTimestamp: 1_700_000_000, pushName: "Bia" };
  it("texto de pessoa vira evento com telefone normalizado", () => {
    const ev = interpretarMensagemQr({ ...base, key: { remoteJid: "551188887777@s.whatsapp.net", id: "Q1", fromMe: false }, message: { conversation: "oi" } });
    expect(ev).toMatchObject({ tipo: "mensagem", idExterno: "Q1", remetente: "551188887777@s.whatsapp.net", telefone: "+5511988887777", nome: "Bia", texto: "oi" });
  });
  it("cliente identificado por LID usa o número alternativo para o telefone", () => {
    const ev = interpretarMensagemQr({ ...base, key: { remoteJid: "12345@lid", senderPn: "5511988887777@s.whatsapp.net", id: "Q2", fromMe: false }, message: { extendedTextMessage: { text: "olá" } } });
    expect(ev).toMatchObject({ remetente: "12345@lid", idsAlternativos: ["5511988887777@s.whatsapp.net"], telefone: "+5511988887777", texto: "olá" });
  });
  it("áudio guarda a referência para baixar depois", () => {
    const ev = interpretarMensagemQr({ ...base, key: { remoteJid: "551188887777@s.whatsapp.net", id: "Q3", fromMe: false }, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } });
    expect(ev).toMatchObject({ conteudo: "audio", midia: { mime: "audio/ogg; codecs=opus" } });
  });
  it("ignora grupos, status, mensagens nossas e reações", () => {
    const k = (remoteJid: string, fromMe = false) => ({ remoteJid, id: "X", fromMe });
    expect(interpretarMensagemQr({ ...base, key: k("123-456@g.us"), message: { conversation: "grupo" } })).toBeNull();
    expect(interpretarMensagemQr({ ...base, key: k("status@broadcast"), message: { conversation: "status" } })).toBeNull();
    expect(interpretarMensagemQr({ ...base, key: k("551188887777@s.whatsapp.net", true), message: { conversation: "nossa" } })).toBeNull();
    expect(interpretarMensagemQr({ ...base, key: k("551188887777@s.whatsapp.net"), message: { reactionMessage: { text: "👍" } } })).toBeNull();
  });
});
