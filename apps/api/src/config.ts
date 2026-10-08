// Configuração lida do ambiente. Falha cedo: nenhum segredo tem valor padrão.
import { existsSync } from "node:fs";

/** No desenvolvimento, lê o .env da raiz (sem sobrescrever o que já está no ambiente). */
export function carregarArquivoEnv(caminho = ".env"): void {
  if (process.env.NODE_ENV !== "production" && existsSync(caminho)) process.loadEnvFile(caminho);
}

export interface Config {
  producao: boolean;
  teste: boolean;
  porta: number;
  databaseUrl: string;
  sessionSecret: string;
  crmChave: Buffer;
  appUrl: string;
  produtoNome: string;
  smtpUrl: string | null;
  emailRemetente: string;
  limiteReqMinuto: number;
  limiteLoginMinuto: number;
  /** Graph API da Meta (troque só em teste/homologação). */
  whatsappGraphUrl: string;
  /** Conexão por QR liga os sockets ao subir (desligue em réplicas extras: só uma instância pode segurar o número). */
  whatsappQrAtivo: boolean;
}

export class ErroConfig extends Error {}

export function carregarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const producao = env.NODE_ENV === "production";
  const problemas: string[] = [];

  const obrigatoria = (nome: string): string => {
    const valor = env[nome]?.trim();
    if (!valor) problemas.push(`${nome} não definida`);
    return valor ?? "";
  };

  const databaseUrl = obrigatoria("DATABASE_URL");
  const sessionSecret = obrigatoria("SESSION_SECRET");
  const crmChaveHex = obrigatoria("CRM_CHAVE");

  if (sessionSecret && sessionSecret.length < 32) {
    problemas.push("SESSION_SECRET precisa de pelo menos 32 caracteres (gere com: openssl rand -hex 32)");
  }
  if (crmChaveHex && !/^[0-9a-fA-F]{64}$/.test(crmChaveHex)) {
    problemas.push("CRM_CHAVE precisa ter 64 caracteres hexadecimais (gere com: openssl rand -hex 32)");
  }

  let appUrl = env.APP_URL?.trim() ?? "";
  if (!appUrl) {
    if (producao) problemas.push("APP_URL não definida (endereço público, ex.: https://app.seudominio.com)");
    appUrl = `http://localhost:${env.PORT || 3000}`;
  }
  appUrl = appUrl.replace(/\/+$/, "");

  if (problemas.length) {
    throw new ErroConfig(`Configuração incompleta:\n- ${problemas.join("\n- ")}`);
  }

  return {
    producao,
    teste: env.NODE_ENV === "test",
    porta: Number(env.PORT) || 3000,
    databaseUrl,
    sessionSecret,
    crmChave: Buffer.from(crmChaveHex, "hex"),
    appUrl,
    produtoNome: env.PRODUTO_NOME?.trim() || "Menezes Gestão",
    smtpUrl: env.SMTP_URL?.trim() || null,
    emailRemetente: env.EMAIL_REMETENTE?.trim() || "nao-responda@localhost",
    limiteReqMinuto: Number(env.LIMITE_REQ_MINUTO) || 300,
    limiteLoginMinuto: Number(env.LIMITE_LOGIN_MINUTO) || 10,
    whatsappGraphUrl: env.WHATSAPP_GRAPH_URL?.trim() || "https://graph.facebook.com/v21.0",
    whatsappQrAtivo: env.WHATSAPP_QR_ATIVO?.trim() !== "nao",
  };
}
