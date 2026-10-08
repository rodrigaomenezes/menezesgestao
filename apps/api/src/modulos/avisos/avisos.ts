// Interface de avisos (e-mail nesta fase; Web Push entra na fase 7).
// Nenhum módulo conhece o fornecedor: todos chamam avisos.enviarEmail().
import nodemailer from "nodemailer";
import { avisoSaida } from "../../infra/esquema.js";
import { comoSistema, type Banco } from "../../infra/banco.js";
import type { Config } from "../../config.js";

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
}

/** Saúde do provedor, mostrada em /api/health e (fase 6) na tela do administrador. */
export type StatusProvedor = "ONLINE" | "OFFLINE" | "DEGRADED" | "CONFIGURATION_ERROR";

export interface ProvedorAvisos {
  readonly id: "demonstracao" | "smtp";
  enviarEmail(mensagem: MensagemEmail): Promise<void>;
  status(): StatusProvedor;
  /** Confere a configuração/conexão (no início e quando o administrador pedir). */
  verificar(): Promise<StatusProvedor>;
}

/** Demonstração: guarda o e-mail numa caixa de saída no banco, sem conta externa. */
export function provedorDemonstracao(banco: Banco): ProvedorAvisos {
  return {
    id: "demonstracao",
    async enviarEmail(m) {
      await comoSistema(banco, (tx) => tx.db.insert(avisoSaida).values({ para: m.para, assunto: m.assunto, texto: m.texto }));
    },
    status: () => "ONLINE",
    verificar: async () => "ONLINE",
  };
}

export function provedorSmtp(smtpUrl: string, remetente: string): ProvedorAvisos {
  const transporte = nodemailer.createTransport(smtpUrl);
  let atual: StatusProvedor = "ONLINE";
  return {
    id: "smtp",
    async enviarEmail(m) {
      try {
        await transporte.sendMail({ from: remetente, to: m.para, subject: m.assunto, text: m.texto });
        atual = "ONLINE";
      } catch (err) {
        atual = "DEGRADED";
        throw err;
      }
    },
    status: () => atual,
    async verificar() {
      try {
        await transporte.verify();
        atual = "ONLINE";
      } catch (err) {
        const codigo = (err as { code?: string }).code;
        atual = codigo === "EAUTH" || codigo === "EENVELOPE" ? "CONFIGURATION_ERROR" : "OFFLINE";
      }
      return atual;
    },
  };
}

export function criarProvedorAvisos(config: Config, banco: Banco): ProvedorAvisos {
  return config.smtpUrl ? provedorSmtp(config.smtpUrl, config.emailRemetente) : provedorDemonstracao(banco);
}
