// Asaas (API v3): cliente por CPF/CNPJ, cobrança Pix, boleto ou link (UNDEFINED = quem paga escolhe), cancelamento e
// avisos por webhook (o token configurado no painel volta no cabeçalho "asaas-access-token").
import { ErroCobranca, type CredenciaisCobranca, type ProvedorRecebimento } from "./tipos.js";

const BASE = { teste: "https://api-sandbox.asaas.com/v3", producao: "https://api.asaas.com/v3" };
const FORMA = { pix: "PIX", boleto: "BOLETO", link: "UNDEFINED" } as const;
const EVENTOS: Record<string, "paga" | "vencida" | "cancelada" | "estornada"> = {
  PAYMENT_RECEIVED: "paga",
  PAYMENT_CONFIRMED: "paga",
  PAYMENT_OVERDUE: "vencida",
  PAYMENT_DELETED: "cancelada",
  PAYMENT_REFUNDED: "estornada",
};

export function provedorAsaas(opcoes: { fetch?: typeof fetch; base?: string } = {}): ProvedorRecebimento {
  const buscar = opcoes.fetch ?? fetch;

  async function chamar(c: CredenciaisCobranca, caminho: string, init: { method?: string; corpo?: unknown } = {}): Promise<Record<string, unknown>> {
    if (!c.chave) throw new ErroCobranca("Cadastre a chave de API do Asaas na conta de cobrança.");
    let res: Response;
    try {
      res = await buscar(`${opcoes.base ?? BASE[c.ambiente]}${caminho}`, {
        method: init.method ?? "GET",
        headers: { access_token: c.chave, "content-type": "application/json", "user-agent": "menezesgestao" },
        body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ErroCobranca("Não foi possível falar com o Asaas agora. Tente de novo em instantes.");
    }
    const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown> & { errors?: { description?: string }[] };
    if (res.status === 401) throw new ErroCobranca("O Asaas recusou a chave de API. Confira a chave e o ambiente (teste ou produção).");
    if (!res.ok) throw new ErroCobranca(`O Asaas recusou o pedido: ${corpo.errors?.[0]?.description ?? `erro ${res.status}`}`);
    return corpo;
  }

  return {
    async testar(c) {
      await chamar(c, "/myAccount");
    },
    async criar(c, p) {
      if (!p.pagador.documento) throw new ErroCobranca("O Asaas exige CPF ou CNPJ de quem paga. Informe o documento para gerar a cobrança.");
      const achado = (await chamar(c, `/customers?cpfCnpj=${p.pagador.documento}`)) as { data?: { id: string }[] };
      const cliente =
        achado.data?.[0]?.id ??
        ((await chamar(c, "/customers", {
          method: "POST",
          corpo: { name: p.pagador.nome, cpfCnpj: p.pagador.documento, mobilePhone: p.pagador.telefone?.replace(/^\+55/, "") ?? undefined, email: p.pagador.email ?? undefined },
        })) as { id: string }).id;
      const pg = (await chamar(c, "/payments", {
        method: "POST",
        corpo: {
          customer: cliente,
          billingType: FORMA[p.forma],
          value: p.valorCentavos / 100,
          dueDate: p.vencimento,
          description: p.descricao.slice(0, 500),
          externalReference: p.referencia,
        },
      })) as { id: string; invoiceUrl?: string; bankSlipUrl?: string };
      let pix: string | null = null;
      if (p.forma === "pix") pix = ((await chamar(c, `/payments/${pg.id}/pixQrCode`)) as { payload?: string }).payload ?? null;
      return { idExterno: pg.id, link: (p.forma === "boleto" ? pg.bankSlipUrl : null) ?? pg.invoiceUrl ?? null, pixCopiaCola: pix };
    },
    async cancelar(c, idExterno) {
      await chamar(c, `/payments/${encodeURIComponent(idExterno)}`, { method: "DELETE" });
    },
    interpretar(corpo) {
      const a = corpo as { id?: unknown; event?: unknown; payment?: { id?: unknown } };
      if (typeof a?.id !== "string" || typeof a.event !== "string" || typeof a.payment?.id !== "string") return null;
      return { idEvento: a.id, idExterno: a.payment.id, status: EVENTOS[a.event] ?? null };
    },
  };
}
