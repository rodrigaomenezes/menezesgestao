// Endereço de uma página de lista: acrescenta o cursor e, ao recarregar, pede de uma vez tudo o que já estava na
// tela (até o máximo da API), para a lista não encolher nem a tela pular quando chega um evento em tempo real.
export const MAXIMO_POR_PAGINA = 100;
const PADRAO_DA_API = 50;

export function enderecoDaPagina(caminho: string, opcoes: { cursor?: string | null; quantos?: number } = {}): string {
  const [base, busca = ""] = caminho.split("?", 2);
  const params = new URLSearchParams(busca);
  if (opcoes.cursor) params.set("cursor", opcoes.cursor);
  if (opcoes.quantos) {
    const pedido = Number(params.get("limite") ?? PADRAO_DA_API);
    params.set("limite", String(Math.min(MAXIMO_POR_PAGINA, Math.max(pedido, opcoes.quantos))));
  }
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}
