// Erro de cada campo vindo do servidor (`details.campos` do 400): o caminho do campo vira a chave ("campos.cpf") e a
// mensagem perde o rótulo do começo ("Nome: preencha." → "Preencha."), porque aparece logo abaixo do próprio campo.
export type ErrosDeCampo = Record<string, string>;

export function errosDeCampo(detalhes: Record<string, unknown> | undefined): ErrosDeCampo {
  const lista = Array.isArray(detalhes?.campos) ? (detalhes.campos as { campo?: unknown; mensagem?: unknown }[]) : [];
  const erros: ErrosDeCampo = {};
  for (const item of lista) {
    if (typeof item?.campo !== "string" || typeof item.mensagem !== "string") continue;
    const chave = item.campo.replaceAll("/", ".");
    if (erros[chave]) continue; // o primeiro erro do campo é o que importa
    const semRotulo = item.mensagem.replace(/^[^:]{1,40}:\s+/, "");
    erros[chave] = semRotulo.charAt(0).toUpperCase() + semRotulo.slice(1);
  }
  return erros;
}

/**
 * O resumo no topo aparece quando não há erro de campo, quando há mais de 3, ou quando algum erro é de um campo que a
 * tela não mostra (`exibidos`): nunca some uma mensagem que a pessoa não veria em outro lugar.
 */
export function mostrarResumo(erros: ErrosDeCampo, exibidos: readonly string[]): boolean {
  const chaves = Object.keys(erros);
  return chaves.length === 0 || chaves.length > 3 || chaves.some((c) => !exibidos.includes(c));
}
