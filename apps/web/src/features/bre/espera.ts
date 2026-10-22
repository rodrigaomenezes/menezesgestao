// Pedidos à IA rodam pela fila de jobs: a tela pede, mostra "analisando" e confere o resultado com espera crescente
// (1 s, 2 s, 3 s…) por até 90 segundos. Nada fica rodando depois que o resultado chega.
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function esperarResultado<T extends { status: string }>(ler: () => Promise<T>, limiteMs = 90_000): Promise<T> {
  const fim = Date.now() + limiteMs;
  let espera = 1000;
  let atual = await ler();
  while (atual.status === "processando" && Date.now() < fim) {
    await pausa(espera);
    espera = Math.min(espera + 1000, 5000);
    atual = await ler();
  }
  return atual;
}
