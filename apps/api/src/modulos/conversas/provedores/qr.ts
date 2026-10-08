// Conexão por QR code (WhatsApp Web, biblioteca Baileys — não oficial; ver ADR-016 e o aviso na tela do canal).
// Cada canal conectado mantém um socket aberto neste processo. O estado de autenticação (chaves do protocolo)
// fica na tabela canal_sessao, cifrado item a item com CRM_CHAVE — nunca em disco.
import {
  Browsers,
  BufferJSON,
  DisconnectReason,
  downloadMediaMessage,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { and, eq } from "drizzle-orm";
import { normalizarTelefone } from "@mg/shared";
import { comEmpresa, type Banco } from "../../../infra/banco.js";
import { canalSessao } from "../../../infra/esquema.js";
import { cifrar, decifrar } from "../../../infra/seguranca/cripto.js";
import {
  ErroProvedor,
  type AoMudarEstado,
  type AoReceber,
  type CanalProvedor,
  type ConteudoSaida,
  type EstadoConexao,
  type EventoEntrada,
  type ProvedorMensagens,
  type TipoConteudoEntrada,
} from "./tipos.js";

type ILogger = NonNullable<Parameters<typeof makeCacheableSignalKeyStore>[1]>;

/** A biblioteca é falante; aqui só erros, em JSON, sem conteúdo de mensagem. */
function registroSilencioso(canalId: string): ILogger {
  const nada = () => undefined;
  const log: ILogger = {
    level: "error",
    child: () => log,
    trace: nada,
    debug: nada,
    info: nada,
    warn: nada,
    error: (obj: unknown, msg?: string) =>
      console.error(JSON.stringify({ level: "error", event: "whatsapp_qr.erro", canalId, mensagem: msg ?? (obj instanceof Error ? obj.message : "erro") })),
  };
  return log;
}

const jidParaTelefone = (jid: string | null | undefined): string | null =>
  jid && /@s\.whatsapp\.net$/.test(jid) ? normalizarTelefone(`+${jid.split("@")[0].split(":")[0]}`) : null;

/** Mensagem do WhatsApp Web → evento normalizado. Ignora grupos, status, canais e as enviadas por nós. */
export function interpretarMensagemQr(m: WAMessage): EventoEntrada | null {
  const chave = m.key;
  const jid = chave.remoteJid;
  if (!jid || !chave.id || chave.fromMe) return null;
  if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) return null; // grupos, status@broadcast, newsletters
  const msg = m.message;
  if (!msg || msg.protocolMessage || msg.reactionMessage) return null;

  const alternativos = [chave.senderPn, chave.senderLid, (chave as { remoteJidAlt?: string }).remoteJidAlt].filter(
    (x): x is string => Boolean(x) && x !== jid,
  );
  const telefone = jidParaTelefone(jid) ?? alternativos.map(jidParaTelefone).find(Boolean) ?? null;

  let conteudo: TipoConteudoEntrada = "texto";
  let texto: string | null = msg.conversation ?? msg.extendedTextMessage?.text ?? null;
  let midia: { mime: string; nome: string | null } | null = null;
  const tipos: [keyof proto.IMessage, TipoConteudoEntrada][] = [
    ["imageMessage", "imagem"],
    ["stickerMessage", "imagem"],
    ["audioMessage", "audio"],
    ["videoMessage", "video"],
    ["documentMessage", "documento"],
    ["documentWithCaptionMessage", "documento"],
  ];
  for (const [campo, tipo] of tipos) {
    const bruto = msg[campo] as { mimetype?: string | null; caption?: string | null; fileName?: string | null; message?: proto.IMessage } | null | undefined;
    if (!bruto) continue;
    const real = campo === "documentWithCaptionMessage" ? (bruto.message?.documentMessage ?? null) : bruto;
    if (!real) continue;
    conteudo = tipo;
    texto = real.caption ?? texto;
    midia = { mime: real.mimetype ?? "application/octet-stream", nome: real.fileName ?? null };
    break;
  }
  if (msg.locationMessage) {
    const l = msg.locationMessage;
    texto = `📍 ${l.name ?? "Localização"}: https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}`;
  }
  if (!texto && !midia) texto = "[Mensagem de um tipo que ainda não é exibido aqui. Veja no celular.]";

  return {
    tipo: "mensagem",
    idExterno: chave.id,
    remetente: jid,
    idsAlternativos: alternativos,
    telefone,
    nome: m.pushName ?? null,
    conteudo,
    texto,
    // A mensagem inteira (com as chaves da mídia) é o que a biblioteca precisa para baixar depois.
    midia: midia ? { ref: { mensagem: JSON.stringify(m, BufferJSON.replacer) }, mime: midia.mime, nome: midia.nome } : null,
    em: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : new Date(),
  };
}

const STATUS_QR: Record<number, "enviada" | "entregue" | "lida" | "falhou"> = { 0: "falhou", 2: "enviada", 3: "entregue", 4: "lida", 5: "lida" };

function conteudoBaileys(conteudo: ConteudoSaida) {
  if (conteudo.tipo === "texto") return { text: conteudo.texto };
  if (conteudo.tipo === "audio") {
    return { audio: conteudo.midia.conteudo, mimetype: conteudo.voz ? "audio/ogg; codecs=opus" : conteudo.midia.mime, ptt: conteudo.voz };
  }
  const { midia, legenda } = conteudo;
  if (conteudo.tipo === "imagem") return { image: midia.conteudo, caption: legenda ?? undefined, mimetype: midia.mime };
  if (conteudo.tipo === "video") return { video: midia.conteudo, caption: legenda ?? undefined, mimetype: midia.mime };
  return { document: midia.conteudo, mimetype: midia.mime, fileName: midia.nome, caption: legenda ?? undefined };
}

interface Conexao {
  sock: WASocket;
  estado: EstadoConexao;
  canal: { id: string; empresaId: string };
  encerrando: boolean;
  tentativas: number;
}

export interface OpcoesQr {
  banco: Banco;
  chave: Buffer;
  aoReceber: AoReceber;
  aoMudarEstado: AoMudarEstado;
}

export function provedorQr(o: OpcoesQr): ProvedorMensagens & { encerrarTodos(): Promise<void> } {
  const conexoes = new Map<string, Conexao>();

  async function estadoAutenticacao(canalId: string, empresaId: string) {
    const ler = (chave: string) =>
      comEmpresa(o.banco, empresaId, async (tx) => {
        const [linha] = await tx.db.select({ valor: canalSessao.valor }).from(canalSessao).where(and(eq(canalSessao.canalId, canalId), eq(canalSessao.chave, chave)));
        return linha ? (JSON.parse(decifrar(o.chave, linha.valor), BufferJSON.reviver) as unknown) : null;
      });
    const gravar = (itens: { chave: string; valor: unknown }[]) =>
      comEmpresa(o.banco, empresaId, async (tx) => {
        for (const { chave, valor } of itens) {
          if (valor === null || valor === undefined) {
            await tx.db.delete(canalSessao).where(and(eq(canalSessao.canalId, canalId), eq(canalSessao.chave, chave)));
            continue;
          }
          const cifrado = cifrar(o.chave, JSON.stringify(valor, BufferJSON.replacer));
          await tx.db
            .insert(canalSessao)
            .values({ canalId, empresaId, chave, valor: cifrado })
            .onConflictDoUpdate({ target: [canalSessao.canalId, canalSessao.chave], set: { valor: cifrado, atualizadoEm: new Date() } });
        }
      });

    const creds = ((await ler("creds")) as AuthenticationCreds | null) ?? initAuthCreds();
    return {
      creds,
      salvarCreds: () => gravar([{ chave: "creds", valor: creds }]),
      chaves: {
        get: async <T extends keyof SignalDataTypeMap>(tipo: T, ids: string[]) => {
          const dados: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            let valor = await ler(`${tipo}-${id}`);
            if (tipo === "app-state-sync-key" && valor) valor = proto.Message.AppStateSyncKeyData.fromObject(valor as object);
            if (valor) dados[id] = valor as SignalDataTypeMap[T];
          }
          return dados;
        },
        set: async (dados: Record<string, Record<string, unknown>>) => {
          const itens = Object.entries(dados).flatMap(([tipo, porId]) => Object.entries(porId ?? {}).map(([id, valor]) => ({ chave: `${tipo}-${id}`, valor })));
          await gravar(itens);
        },
      },
    };
  }

  async function limparSessao(canalId: string, empresaId: string) {
    await comEmpresa(o.banco, empresaId, (tx) => tx.db.delete(canalSessao).where(eq(canalSessao.canalId, canalId)));
  }

  async function mudar(c: Conexao, estado: EstadoConexao) {
    c.estado = estado;
    await o.aoMudarEstado(c.canal, estado).catch((err: Error) =>
      console.error(JSON.stringify({ level: "error", event: "whatsapp_qr.estado_nao_salvo", canalId: c.canal.id, erro: err.message })),
    );
  }

  async function abrir(canal: { id: string; empresaId: string }): Promise<Conexao> {
    const auth = await estadoAutenticacao(canal.id, canal.empresaId);
    const logger = registroSilencioso(canal.id);
    const sock = makeWASocket({
      auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.chaves, logger) },
      logger,
      browser: Browsers.ubuntu("Chrome"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
    });
    const anterior = conexoes.get(canal.id);
    const c: Conexao = { sock, estado: { status: "conectando" }, canal, encerrando: false, tentativas: anterior?.tentativas ?? 0 };
    conexoes.set(canal.id, c);

    sock.ev.on("creds.update", () => void auth.salvarCreds());
    sock.ev.on("connection.update", (u) => {
      if (u.qr) void mudar(c, { status: "aguardando_qr", qr: u.qr, detalhe: "Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho." });
      if (u.connection === "open") {
        c.tentativas = 0;
        const jid = sock.user?.id ?? null;
        void mudar(c, { status: "conectado", qr: null, numero: jidParaTelefone(jid?.replace(/:\d+@/, "@") ?? null), identificadorExterno: jid?.replace(/:\d+@/, "@") ?? null, detalhe: null });
      }
      if (u.connection === "close") {
        const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (c.encerrando) return;
        if (codigo === DisconnectReason.loggedOut || codigo === DisconnectReason.forbidden) {
          conexoes.delete(canal.id);
          void limparSessao(canal.id, canal.empresaId).then(() =>
            mudar(c, { status: "desconectado", qr: null, detalhe: "O aparelho foi desconectado pelo celular. Conecte de novo lendo o QR code." }),
          );
          return;
        }
        if (codigo === DisconnectReason.connectionReplaced) {
          conexoes.delete(canal.id);
          void mudar(c, { status: "erro", qr: null, detalhe: "Este número foi aberto em outro lugar. Conecte de novo." });
          return;
        }
        // Queda de conexão: tenta de novo com espera crescente (reconexão do socket, não rotina de negócio).
        c.tentativas += 1;
        if (c.tentativas > 8) {
          conexoes.delete(canal.id);
          void mudar(c, { status: "erro", qr: null, detalhe: "A conexão caiu várias vezes seguidas. Tente conectar de novo." });
          return;
        }
        const espera = Math.min(60_000, 1000 * 2 ** c.tentativas);
        void mudar(c, { status: "conectando", qr: null, detalhe: "Reconectando…" });
        setTimeout(() => {
          if (conexoes.get(canal.id) === c && !c.encerrando) void abrir(canal).catch(() => undefined);
        }, espera);
      }
    });
    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      const eventos = messages.map(interpretarMensagemQr).filter((e): e is EventoEntrada => e !== null);
      if (eventos.length) void o.aoReceber(canal, eventos).catch(() => undefined);
    });
    sock.ev.on("messages.update", (atualizacoes) => {
      const eventos: EventoEntrada[] = [];
      for (const a of atualizacoes) {
        const status = a.update.status;
        if (!a.key.fromMe || !a.key.id || status === undefined || status === null) continue;
        const s = STATUS_QR[status];
        if (s) eventos.push({ tipo: "status", idExterno: a.key.id, status: s });
      }
      if (eventos.length) void o.aoReceber(canal, eventos).catch(() => undefined);
    });
    return c;
  }

  /** Espera o primeiro estado útil (QR ou conectado) para responder à tela. */
  async function aguardarEstado(c: Conexao, ms: number): Promise<EstadoConexao> {
    const fim = Date.now() + ms;
    while (Date.now() < fim && c.estado.status === "conectando") await new Promise((r) => setTimeout(r, 200));
    return c.estado;
  }

  async function destinoJid(sock: WASocket, telefone: string | null, idExterno: string | null): Promise<string> {
    if (idExterno && /@(s\.whatsapp\.net|lid)$/.test(idExterno)) return idExterno;
    if (!telefone) throw new ErroProvedor("Conversa sem telefone: não há para quem enviar.", false);
    // O WhatsApp informa o JID certo (contas antigas do Brasil podem estar sem o nono dígito).
    const [r] = (await sock.onWhatsApp(telefone.replace(/\D/g, ""))) ?? [];
    if (!r?.exists) throw new ErroProvedor("Este número não tem WhatsApp.", false);
    return r.jid;
  }

  return {
    id: "qr",
    recursos: { qr: true, webhook: false, janela24h: false },

    async conectar(canal: CanalProvedor) {
      const existente = conexoes.get(canal.id);
      if (existente && existente.estado.status !== "erro") return existente.estado;
      const c = await abrir({ id: canal.id, empresaId: canal.empresaId });
      return aguardarEstado(c, 15_000);
    },

    async desconectar(canal) {
      const c = conexoes.get(canal.id);
      if (c) {
        c.encerrando = true;
        conexoes.delete(canal.id);
        await c.sock.logout().catch(() => undefined);
        c.sock.end(undefined);
      }
      await limparSessao(canal.id, canal.empresaId);
    },

    async estado(canal) {
      return conexoes.get(canal.id)?.estado ?? { status: "desconectado", detalhe: "Sem conexão ativa neste servidor." };
    },

    async enviar(canal, destino, conteudo: ConteudoSaida) {
      const c = conexoes.get(canal.id);
      if (!c || c.estado.status !== "conectado") throw new ErroProvedor("O WhatsApp deste canal não está conectado. Peça ao administrador para conectar.");
      const jid = await destinoJid(c.sock, destino.telefone, destino.idExterno);
      const corpo = conteudoBaileys(conteudo);
      let enviada: WAMessage | undefined;
      try {
        enviada = await c.sock.sendMessage(jid, corpo);
      } catch (e) {
        throw new ErroProvedor(`O WhatsApp não aceitou a mensagem${e instanceof Error ? `: ${e.message}` : "."}`);
      }
      if (!enviada?.key.id) throw new ErroProvedor("O WhatsApp não devolveu o id da mensagem enviada.");
      return { idExterno: enviada.key.id };
    },

    async baixarMidia(canal, ref) {
      if (typeof ref.mensagem !== "string") throw new ErroProvedor("Referência de mídia inválida.", false);
      const c = conexoes.get(canal.id);
      const m = JSON.parse(ref.mensagem, BufferJSON.reviver) as WAMessage;
      try {
        const conteudo = await downloadMediaMessage(m, "buffer", {}, c ? { reuploadRequest: c.sock.updateMediaMessage, logger: registroSilencioso(canal.id) } : undefined);
        return { nome: "arquivo", mime: "application/octet-stream", conteudo };
      } catch {
        throw new ErroProvedor("Não foi possível baixar a mídia do WhatsApp. Tentando de novo.");
      }
    },

    async encerrarTodos() {
      for (const c of conexoes.values()) {
        c.encerrando = true;
        c.sock.end(undefined);
      }
      conexoes.clear();
    },
  };
}
