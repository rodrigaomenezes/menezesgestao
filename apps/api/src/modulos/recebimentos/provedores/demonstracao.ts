// Provedor de demonstração: funciona sem conta. Gera um Pix e um link de mentira; o pagamento é simulado na tela e
// chega pelo mesmo caminho do aviso de um provedor real.
import { randomUUID } from "node:crypto";
import type { ProvedorRecebimento } from "./tipos.js";

export const provedorRecebimentoDemonstracao: ProvedorRecebimento = {
  async testar() {},
  async criar(_c, p) {
    const idExterno = `demo_${randomUUID()}`;
    return {
      idExterno,
      link: p.forma === "pix" ? null : `https://pagamento.exemplo/${idExterno}`,
      pixCopiaCola: p.forma === "pix" ? `00020126DEMONSTRACAO${p.valorCentavos}5802BR${idExterno.slice(5, 13)}6304DEMO` : null,
    };
  },
  async cancelar() {},
  interpretar(corpo) {
    const c = corpo as { id?: unknown; idExterno?: unknown; status?: unknown };
    if (typeof c?.id !== "string" || typeof c.idExterno !== "string") return null;
    const status = c.status === "paga" || c.status === "vencida" || c.status === "cancelada" || c.status === "estornada" ? c.status : null;
    return { idEvento: c.id, idExterno: c.idExterno, status };
  },
};
