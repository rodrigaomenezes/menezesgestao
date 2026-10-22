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
  /** Domínio base dos subdomínios das empresas (ex.: seuproduto.com.br → empresa.seuproduto.com.br). */
  dominioBase: string | null;
  /** Cadastro aberto de empresas pelo site (CADASTRO_ABERTO=nao desliga). */
  cadastroAberto: boolean;
  /** Web Push (avisos no celular): par de chaves VAPID. Sem elas, o push fica no modo demonstração. */
  vapid: { publica: string; privada: string; contato: string } | null;
  /** IA do motor BRE (Claude). Sem ANTHROPIC_API_KEY, o motor usa a IA de demonstração (regras por palavras). */
  iaBre: { chave: string; modelo: string } | null;
  /** E-mails da equipe da plataforma (PLATAFORMA_ADMINS, separados por vírgula): veem o painel de todas as empresas. */
  plataformaAdmins: string[];
  /** Canais de suporte mostrados na central de ajuda (SUPORTE_WHATSAPP, SUPORTE_EMAIL). */
  suporte: { whatsapp: string | null; email: string | null };
  /** Encarregado de dados (DPO), publicado na política de privacidade (ENCARREGADO_DADOS: nome e contato). */
  encarregadoDados: string | null;
  /** Chave da tela /demonstracao (empresas de exemplo). Sem ela, a tela não existe (404). */
  demonstracaoChave: string | null;
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

  const demonstracaoChave = env.DEMONSTRACAO_CHAVE?.trim() || null;
  if (demonstracaoChave && demonstracaoChave.length < 16) {
    problemas.push("DEMONSTRACAO_CHAVE precisa de pelo menos 16 caracteres (gere com: openssl rand -hex 16)");
  }

  const vapidPublica = env.VAPID_PUBLICA?.trim();
  const vapidPrivada = env.VAPID_PRIVADA?.trim();
  if (Boolean(vapidPublica) !== Boolean(vapidPrivada)) problemas.push("Defina VAPID_PUBLICA e VAPID_PRIVADA juntas (gere com: npm run push:chaves)");

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
    dominioBase: env.DOMINIO_BASE?.trim().toLowerCase().replace(/^\.+|\.+$/g, "") || null,
    cadastroAberto: env.CADASTRO_ABERTO?.trim() !== "nao",
    iaBre: env.ANTHROPIC_API_KEY?.trim() ? { chave: env.ANTHROPIC_API_KEY.trim(), modelo: env.BRE_IA_MODELO?.trim() || "claude-opus-5-5" } : null,
    plataformaAdmins: (env.PLATAFORMA_ADMINS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    suporte: { whatsapp: env.SUPORTE_WHATSAPP?.replace(/\D/g, "") || null, email: env.SUPORTE_EMAIL?.trim() || null },
    encarregadoDados: env.ENCARREGADO_DADOS?.trim() || null,
    demonstracaoChave,
    vapid: vapidPublica && vapidPrivada ? { publica: vapidPublica, privada: vapidPrivada, contato: env.VAPID_CONTATO?.trim() || `mailto:${env.EMAIL_REMETENTE?.trim() || "nao-responda@localhost"}` } : null,
  };
}
