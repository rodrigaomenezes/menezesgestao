// Leitura offline e avisos no celular, do lado do navegador.
import type { PushConfigDto } from "@mg/shared";
import { get, post } from "./api";

/** Nome do cache dos dados da API (o mesmo do vite.config.ts). */
const CACHE_DADOS = "mg-dados";

/** Apaga os dados guardados para leitura offline (login, logout, troca de pessoa). */
export async function limparDadosOffline(): Promise<void> {
  try {
    if ("caches" in window) await caches.delete(CACHE_DADOS);
  } catch {
    // Sem cache disponível (navegação privada): nada a apagar.
  }
}

export function pushSuportado(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registro(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSuportado()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function inscricaoAtual(): Promise<PushSubscription | null> {
  return (await (await registro())?.pushManager.getSubscription()) ?? null;
}

function chaveParaBytes(base64: string): Uint8Array<ArrayBuffer> {
  const preenchido = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const texto = atob(preenchido);
  const bytes = new Uint8Array(new ArrayBuffer(texto.length));
  for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i);
  return bytes;
}

/** Pede permissão, inscreve o aparelho e manda a inscrição ao servidor. */
export async function ligarAvisos(): Promise<"ligado" | "negado" | "indisponivel"> {
  const config = await get<PushConfigDto>("/push/config");
  const reg = await registro();
  if (!config.ativo || !config.chavePublica || !reg) return "indisponivel";
  if ((await Notification.requestPermission()) !== "granted") return "negado";
  const inscricao =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(config.chavePublica) }));
  const json = inscricao.toJSON();
  await post("/push/inscricao", { endpoint: inscricao.endpoint, chaves: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } });
  return "ligado";
}

/** Para os avisos neste aparelho (também ao sair: aparelho compartilhado não recebe avisos de quem saiu). */
export async function desligarAvisos(): Promise<void> {
  const inscricao = await inscricaoAtual().catch(() => null);
  if (!inscricao) return;
  await post("/push/cancelar", { endpoint: inscricao.endpoint }).catch(() => undefined);
  await inscricao.unsubscribe().catch(() => undefined);
}
