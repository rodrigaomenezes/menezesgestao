import { describe, expect, it } from "vitest";
import { provedorAsaas } from "./asaas.js";
import { ErroCobranca } from "./tipos.js";

const cred = { chave: "aact_teste", ambiente: "teste" as const };
const pedido = {
  referencia: "ref-1",
  forma: "pix" as const,
  valorCentavos: 15050,
  vencimento: "2026-11-01",
  descricao: "Curso",
  pagador: { nome: "Ana", documento: "12345678909", telefone: "+5511988887777", email: null },
};

describe("Asaas", () => {
  it("cria cliente, cobrança Pix e busca o copia-e-cola, com a chave no cabeçalho", async () => {
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const respostas: unknown[] = [{ data: [] }, { id: "cus_1" }, { id: "pay_1", invoiceUrl: "https://asaas/i/pay_1" }, { payload: "000201PIX" }];
    const falso = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify(respostas.shift()), { status: 200 });
    }) as typeof fetch;
    const r = await provedorAsaas({ fetch: falso }).criar(cred, pedido);
    expect(r).toEqual({ idExterno: "pay_1", link: "https://asaas/i/pay_1", pixCopiaCola: "000201PIX" });
    expect(chamadas[0]!.url).toBe("https://api-sandbox.asaas.com/v3/customers?cpfCnpj=12345678909");
    expect((chamadas[0]!.init?.headers as Record<string, string>).access_token).toBe("aact_teste");
    expect(JSON.parse(chamadas[1]!.init?.body as string)).toMatchObject({ name: "Ana", cpfCnpj: "12345678909", mobilePhone: "11988887777" });
    expect(JSON.parse(chamadas[2]!.init?.body as string)).toEqual({ customer: "cus_1", billingType: "PIX", value: 150.5, dueDate: "2026-11-01", description: "Curso", externalReference: "ref-1" });
  });

  it("sem CPF/CNPJ ou com chave recusada, explica o que fazer", async () => {
    const p = provedorAsaas({ fetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch });
    await expect(p.criar(cred, { ...pedido, pagador: { ...pedido.pagador, documento: null } })).rejects.toThrow("O Asaas exige CPF ou CNPJ");
    await expect(p.testar(cred)).rejects.toBeInstanceOf(ErroCobranca);
    await expect(p.testar(cred)).rejects.toThrow("O Asaas recusou a chave de API");
  });

  it("interpreta o aviso: pagamento recebido = paga; evento desconhecido = sem mudança", () => {
    const p = provedorAsaas();
    expect(p.interpretar({ id: "evt_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_1" } })).toEqual({ idEvento: "evt_1", idExterno: "pay_1", status: "paga" });
    expect(p.interpretar({ id: "evt_2", event: "PAYMENT_UPDATED", payment: { id: "pay_1" } })).toEqual({ idEvento: "evt_2", idExterno: "pay_1", status: null });
    expect(p.interpretar({ nada: true })).toBeNull();
  });
});
