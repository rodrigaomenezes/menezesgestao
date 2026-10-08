// Provedor de demonstração: funciona sem número real. O "celular do cliente" é simulado pela rota
// POST /api/canais/:id/simular (só administrador). Envios são aceitos na hora e marcados como entregues.
import { randomUUID } from "node:crypto";
import { ErroProvedor, type ProvedorMensagens } from "./tipos.js";

export const NUMERO_DEMONSTRACAO = "+5511900000000";

export function provedorDemonstracaoMensagens(): ProvedorMensagens {
  return {
    id: "demonstracao",
    recursos: { qr: false, webhook: false, janela24h: false },
    async conectar() {
      return { status: "conectado", numero: NUMERO_DEMONSTRACAO, detalhe: "Modo demonstração: nenhuma mensagem sai de verdade." };
    },
    async desconectar() {},
    async estado() {
      return { status: "conectado", numero: NUMERO_DEMONSTRACAO };
    },
    async enviar(_canal, destino) {
      if (!destino.telefone && !destino.idExterno) throw new ErroProvedor("Conversa sem telefone: não há para quem enviar.", false);
      return { idExterno: `demo-${randomUUID()}` };
    },
    async baixarMidia(_canal, ref) {
      if (typeof ref.base64 !== "string") throw new ErroProvedor("Mídia de demonstração sem conteúdo.", false);
      return {
        nome: typeof ref.nome === "string" ? ref.nome : "arquivo",
        mime: typeof ref.mime === "string" ? ref.mime : "application/octet-stream",
        conteudo: Buffer.from(ref.base64, "base64"),
      };
    },
  };
}
