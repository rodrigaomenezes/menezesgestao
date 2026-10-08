// Interface de avisos (e-mail nesta fase; Web Push entra na fase 7).
// Nenhum módulo conhece o fornecedor: todos chamam avisos.enviarEmail().
import nodemailer from "nodemailer";
import { avisoSaida } from "../db/esquema.js";
import { comoSistema, type Banco } from "../db/banco.js";
import type { Config } from "../config.js";

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
}

export interface ProvedorAvisos {
  readonly id: "demonstracao" | "smtp";
  enviarEmail(mensagem: MensagemEmail): Promise<void>;
}

/** Demonstração: guarda o e-mail numa caixa de saída no banco, sem conta externa. */
export function provedorDemonstracao(banco: Banco): ProvedorAvisos {
  return {
    id: "demonstracao",
    async enviarEmail(m) {
      await comoSistema(banco, (tx) =>
        tx.db.insert(avisoSaida).values({ para: m.para, assunto: m.assunto, texto: m.texto }),
      );
    },
  };
}

export function provedorSmtp(smtpUrl: string, remetente: string): ProvedorAvisos {
  const transporte = nodemailer.createTransport(smtpUrl);
  return {
    id: "smtp",
    async enviarEmail(m) {
      await transporte.sendMail({ from: remetente, to: m.para, subject: m.assunto, text: m.texto });
    },
  };
}

export function criarProvedorAvisos(config: Config, banco: Banco): ProvedorAvisos {
  return config.smtpUrl ? provedorSmtp(config.smtpUrl, config.emailRemetente) : provedorDemonstracao(banco);
}
