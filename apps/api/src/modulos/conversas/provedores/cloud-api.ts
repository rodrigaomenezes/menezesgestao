// API oficial do WhatsApp (Cloud API da Meta). Envio pela Graph API; recebimento por webhook assinado
// (X-Hub-Signature-256 = HMAC-SHA256 do corpo com a chave secreta do app). Credenciais por canal, cifradas no banco.
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizarTelefone } from "@mg/shared";
import { ErroProvedor, type CanalProvedor, type ConteudoSaida, type EventoEntrada, type Midia, type ProvedorMensagens, type TipoConteudoEntrada } from "./tipos.js";

export const GRAPH_URL_PADRAO = "https://graph.facebook.com/v21.0";

interface OpcoesCloud {
  graphUrl?: string;
  fetch?: typeof fetch;
}

function credenciais(canal: CanalProvedor) {
  const c = canal.credenciais;
  if (!c?.phoneNumberId || !c.token) throw new ErroProvedor("Canal sem credenciais da API oficial. Cadastre o Phone number ID e o token.", false);
  return { phoneNumberId: c.phoneNumberId, token: c.token };
}

/** Confere a assinatura do webhook. Sem assinatura válida, nada é processado. */
export function assinaturaValida(corpo: Buffer, cabecalho: string | undefined, appSecret: string): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = createHmac("sha256", appSecret).update(corpo).digest();
  const recebido = Buffer.from(cabecalho.slice("sha256=".length), "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

const TIPOS_MIDIA: Record<string, TipoConteudoEntrada> = { image: "imagem", audio: "audio", video: "video", document: "documento", sticker: "imagem" };

interface MensagemWebhook {
  from: string;
  id: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  location?: { latitude?: number; longitude?: number; name?: string };
  [midia: string]: unknown;
}

/** Corpo do webhook → eventos normalizados (só do número deste canal). */
export function interpretarWebhook(corpo: unknown, phoneNumberId: string | null): EventoEntrada[] {
  const eventos: EventoEntrada[] = [];
  const entradas = (corpo as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] })?.entry ?? [];
  for (const entrada of entradas) {
    for (const mudanca of entrada.changes ?? []) {
      const v = mudanca.value ?? {};
      const meta = v.metadata as { phone_number_id?: string } | undefined;
      if (phoneNumberId && meta?.phone_number_id && meta.phone_number_id !== phoneNumberId) continue;
      const contatos = (v.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
      for (const m of (v.messages as MensagemWebhook[] | undefined) ?? []) {
        const perfil = contatos.find((c) => c.wa_id === m.from) ?? contatos[0];
        const midiaBruta = TIPOS_MIDIA[m.type] ? (m[m.type] as { id?: string; mime_type?: string; filename?: string; caption?: string } | undefined) : undefined;
        let texto: string | null = m.text?.body ?? midiaBruta?.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
        if (m.type === "location" && m.location) texto = `📍 ${m.location.name ?? "Localização"}: https://maps.google.com/?q=${m.location.latitude},${m.location.longitude}`;
        if (!texto && !midiaBruta?.id) texto = "[Mensagem de um tipo que ainda não é exibido aqui. Veja no celular.]";
        eventos.push({
          tipo: "mensagem",
          idExterno: m.id,
          remetente: m.from,
          idsAlternativos: perfil?.wa_id && perfil.wa_id !== m.from ? [perfil.wa_id] : [],
          telefone: normalizarTelefone(`+${m.from}`),
          nome: perfil?.profile?.name ?? null,
          conteudo: midiaBruta?.id ? (TIPOS_MIDIA[m.type] ?? "documento") : "texto",
          texto,
          midia: midiaBruta?.id ? { ref: { id: midiaBruta.id }, mime: midiaBruta.mime_type ?? "application/octet-stream", nome: midiaBruta.filename ?? null } : null,
          em: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        });
      }
      for (const s of (v.statuses as { id: string; status: string; errors?: { title?: string; message?: string }[] }[] | undefined) ?? []) {
        const mapa = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" } as const;
        const status = mapa[s.status as keyof typeof mapa];
        if (status) eventos.push({ tipo: "status", idExterno: s.id, status, erro: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null });
      }
    }
  }
  return eventos;
}

/** Erros da Graph API → mensagem para a pessoa + se vale tentar de novo. */
function erroGraph(status: number, corpo: unknown): ErroProvedor {
  const e = (corpo as { error?: { code?: number; message?: string } })?.error;
  const codigo = e?.code;
  if (codigo === 131047)
    return new ErroProvedor("Fora da janela de 24 horas: o cliente precisa escrever primeiro (mensagens modelo chegam numa próxima versão).", false);
  if (codigo === 190) return new ErroProvedor("O token da Meta expirou ou foi revogado. Cadastre um token novo no canal.", false);
  if (codigo === 131026) return new ErroProvedor("O número não pode receber mensagens no WhatsApp.", false);
  if (codigo === 100) return new ErroProvedor("A Meta recusou os dados enviados (confira o Phone number ID e o número).", false);
  if (status === 429 || codigo === 4 || codigo === 80007 || codigo === 130429) return new ErroProvedor("Limite de envios da Meta atingido. Tentando de novo em instantes.");
  if (status >= 500) return new ErroProvedor("A Meta está instável. Tentando de novo em instantes.");
  return new ErroProvedor(`A Meta recusou a mensagem${e?.message ? `: ${e.message}` : "."}`, false);
}

export function provedorCloudApi(opcoes: OpcoesCloud = {}): ProvedorMensagens {
  const base = (opcoes.graphUrl ?? GRAPH_URL_PADRAO).replace(/\/$/, "");
  const buscar = opcoes.fetch ?? fetch;

  async function chamar(token: string, caminho: string, init: RequestInit = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await buscar(`${base}${caminho}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new ErroProvedor("Sem resposta da Meta. Tentando de novo em instantes.");
    }
    const corpo = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) throw erroGraph(res.status, corpo);
    return corpo;
  }

  async function subirMidia(phoneNumberId: string, token: string, midia: Midia): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", midia.mime);
    form.append("file", new Blob([new Uint8Array(midia.conteudo)], { type: midia.mime }), midia.nome);
    const r = (await chamar(token, `/${phoneNumberId}/media`, { method: "POST", body: form })) as { id?: string };
    if (!r.id) throw new ErroProvedor("A Meta não devolveu o id da mídia enviada.");
    return r.id;
  }

  return {
    id: "cloud_api",
    recursos: { qr: false, webhook: true, janela24h: true },

    async conectar(canal) {
      const { phoneNumberId, token } = credenciais(canal);
      try {
        const r = (await chamar(token, `/${phoneNumberId}?fields=display_phone_number,verified_name`)) as { display_phone_number?: string; verified_name?: string };
        return {
          status: "conectado",
          numero: r.display_phone_number ? normalizarTelefone(`+${r.display_phone_number.replace(/\D/g, "")}`) : null,
          identificadorExterno: phoneNumberId,
          detalhe: r.verified_name ? `Número verificado: ${r.verified_name}` : null,
        };
      } catch (e) {
        return { status: "erro", detalhe: e instanceof Error ? e.message : "Não foi possível falar com a Meta." };
      }
    },
    async desconectar() {},
    async estado(canal) {
      return this.conectar(canal);
    },

    async enviar(canal, destino, conteudo: ConteudoSaida) {
      const { phoneNumberId, token } = credenciais(canal);
      const para = destino.telefone?.replace(/\D/g, "") ?? destino.idExterno;
      if (!para) throw new ErroProvedor("Conversa sem telefone: não há para quem enviar.", false);
      let corpo: Record<string, unknown>;
      if (conteudo.tipo === "texto") corpo = { type: "text", text: { body: conteudo.texto, preview_url: true } };
      else {
        const id = await subirMidia(phoneNumberId, token, conteudo.midia);
        const tipo = { imagem: "image", video: "video", documento: "document", audio: "audio" }[conteudo.tipo];
        const objeto: Record<string, unknown> = { id };
        if (conteudo.tipo !== "audio" && conteudo.legenda) objeto.caption = conteudo.legenda;
        if (conteudo.tipo === "documento") objeto.filename = conteudo.midia.nome;
        corpo = { type: tipo, [tipo]: objeto };
      }
      const r = (await chamar(token, `/${phoneNumberId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: para, ...corpo }),
      })) as { messages?: { id?: string }[] };
      const idExterno = r.messages?.[0]?.id;
      if (!idExterno) throw new ErroProvedor("A Meta aceitou o envio mas não devolveu o id da mensagem.");
      return { idExterno };
    },

    async baixarMidia(canal, ref) {
      const { token } = credenciais(canal);
      if (typeof ref.id !== "string") throw new ErroProvedor("Referência de mídia inválida.", false);
      const info = (await chamar(token, `/${ref.id}`)) as { url?: string; mime_type?: string };
      if (!info.url) throw new ErroProvedor("A Meta não informou onde baixar a mídia.");
      let res: Response;
      try {
        res = await buscar(info.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
      } catch {
        throw new ErroProvedor("Não foi possível baixar a mídia da Meta. Tentando de novo.");
      }
      if (!res.ok) throw new ErroProvedor("A Meta recusou o download da mídia.", res.status >= 500);
      return { nome: typeof ref.nome === "string" ? ref.nome : "arquivo", mime: info.mime_type ?? "application/octet-stream", conteudo: Buffer.from(await res.arrayBuffer()) };
    },
  };
}
