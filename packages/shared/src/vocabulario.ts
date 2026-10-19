// Vocabulário da empresa: cada segmento chama as coisas de um jeito ("aluno", "paciente", "matrícula"…).
// Um só lugar resolve singular, plural e gênero, e monta as frases do servidor e das telas a partir de modelos
// com marcadores — assim "Nova matrícula" e "Paciente não encontrado" saem certos sem regra de cliente no código.

export const TERMOS = [
  { chave: "contato", padrao: "contato", genero: "o", rotulo: "Cliente", ajuda: "Quem compra ou é atendido" },
  { chave: "oportunidade", padrao: "oportunidade", genero: "a", rotulo: "Oportunidade", ajuda: "Cada negócio no funil" },
  { chave: "oferta", padrao: "oferta", genero: "a", rotulo: "Oferta", ajuda: "O que a empresa vende" },
  { chave: "entrega", padrao: "entrega", genero: "a", rotulo: "Entrega", ajuda: "Como o serviço acontece (turma, consulta…)" },
  { chave: "prestador", padrao: "prestador", genero: "o", rotulo: "Prestador", ajuda: "Quem executa o serviço" },
  { chave: "colaborador", padrao: "colaborador", genero: "o", rotulo: "Colaborador", ajuda: "Quem usa o sistema para vender ou atender" },
  { chave: "unidade", padrao: "unidade", genero: "a", rotulo: "Unidade", ajuda: "Filial ou local de atendimento" },
] as const;
export type ChaveTermo = (typeof TERMOS)[number]["chave"];
export type Genero = "o" | "a";
export const CHAVES_TERMOS = TERMOS.map((t) => t.chave) as [ChaveTermo, ...ChaveTermo[]];

/** Como a empresa guarda: { contato: "aluno", contato_plural?: "alunos", contato_genero?: "o" }. */
export type Vocabulario = Record<string, string>;

export interface Termo {
  singular: string;
  plural: string;
  genero: Genero;
}

/** Plural simples do português (aluno → alunos, sessão → sessões, imóvel → imóveis, professor → professores). */
export function plural(s: string): string {
  if (/ão$/i.test(s)) return s.replace(/ão$/i, "ões");
  if (/[aeiouáéíóú]$/i.test(s)) return `${s}s`;
  if (/[rsz]$/i.test(s)) return `${s}es`;
  if (/vel$/i.test(s)) return s.replace(/vel$/i, "veis");
  if (/[eé]l$/i.test(s)) return s.replace(/[eé]l$/i, "éis");
  if (/[oó]l$/i.test(s)) return s.replace(/[oó]l$/i, "óis");
  if (/[aiu]l$/i.test(s)) return s.replace(/l$/i, "is");
  if (/m$/i.test(s)) return s.replace(/m$/i, "ns");
  return `${s}s`;
}

export const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ePalavra = (s: string | undefined): s is string => typeof s === "string" && s.trim().length > 0;

/** O termo configurado pela empresa, ou o padrão do sistema. */
export function termo(v: Vocabulario | null | undefined, chave: ChaveTermo): Termo {
  const base = TERMOS.find((t) => t.chave === chave)!;
  const configurado = v?.[chave];
  const singular = ePalavra(configurado) ? configurado.trim().toLowerCase() : base.padrao;
  const p = v?.[`${chave}_plural`];
  const g = v?.[`${chave}_genero`];
  // Sem gênero configurado: o do padrão vale só se o termo é o padrão; senão, pelo final da palavra.
  const genero: Genero = g === "o" || g === "a" ? g : singular === base.padrao ? base.genero : /a$|ade$|[çs]ão$|gem$/.test(singular) ? "a" : "o";
  return { singular, plural: ePalavra(p) ? p.trim().toLowerCase() : plural(singular), genero };
}

// Palavras que concordam com o termo: a forma masculina leva à feminina.
const FEMININO: Record<string, string> = {
  o: "a", os: "as", um: "uma", uns: "umas", do: "da", dos: "das", no: "na", nos: "nas", ao: "à", aos: "às",
  pelo: "pela", pelos: "pelas", este: "esta", estes: "estas", deste: "desta", destes: "destas", neste: "nesta",
  esse: "essa", esses: "essas", desse: "dessa", nesse: "nessa", novo: "nova", novos: "novas", outro: "outra",
  outros: "outras", nenhum: "nenhuma", seu: "sua", seus: "suas", todo: "toda", todos: "todas", meu: "minha",
  meus: "minhas", mesmo: "mesma", mesmos: "mesmas", primeiro: "primeira", próprio: "própria", próprios: "próprias", algum: "alguma", alguns: "algumas",
};

const MASCULINO: Record<string, string> = Object.fromEntries(Object.entries(FEMININO).map(([m, f]) => [f, m]));

/** Leva a palavra ao gênero do termo; o modelo pode partir de qualquer um ("{Nova entrega}" → "Novo pedido"). */
function concordar(palavra: string, genero: Genero): string {
  const minuscula = palavra.toLowerCase();
  const forma = genero === "a" ? (FEMININO[minuscula] ?? (MASCULINO[minuscula] ? minuscula : undefined)) : (MASCULINO[minuscula] ?? (FEMININO[minuscula] ? minuscula : undefined));
  if (!forma) return palavra;
  return palavra.charAt(0) === palavra.charAt(0).toUpperCase() ? maiuscula(forma) : forma;
}

const CHAVE_DE: Record<string, { chave: ChaveTermo; plural: boolean }> = Object.fromEntries(
  TERMOS.flatMap((t) => [
    [t.chave, { chave: t.chave, plural: false }],
    [plural(t.chave), { chave: t.chave, plural: true }],
  ]),
);

/**
 * Monta uma frase com o vocabulário da empresa. Marcadores:
 * - `{contato}` / `{Contato}` / `{contatos}` / `{Contatos}`: o termo no singular ou plural, com a inicial como escrita;
 * - `{Novo contato}`, `{os contatos}`, `{do contato}`: palavras antes do termo concordam com o gênero dele;
 * - `{o|a:contato}`: escolhe a forma pelo gênero ("encontrad{o|a:contato}" → "encontrada" para "matrícula").
 * Chaves desconhecidas ficam como estão; `{{variavel}}` de mensagens nunca é tocado.
 */
export function texto(modelo: string, v: Vocabulario | null | undefined): string {
  if (!modelo.includes("{")) return modelo;
  return modelo.replace(/(?<!\{)\{([^{}]+)\}(?!\})/g, (inteiro, dentro: string) => {
    const escolha = /^([^|:]*)\|([^|:]*):(\w+)$/.exec(dentro);
    if (escolha) {
      const ref = CHAVE_DE[escolha[3]!.toLowerCase()];
      return ref ? (termo(v, ref.chave).genero === "a" ? escolha[2]! : escolha[1]!) : inteiro;
    }
    const partes = dentro.split(" ");
    const nome = partes[partes.length - 1]!;
    const ref = CHAVE_DE[nome.toLowerCase()];
    if (!ref) return inteiro;
    const t = termo(v, ref.chave);
    let palavra = ref.plural ? t.plural : t.singular;
    if (nome.charAt(0) === nome.charAt(0).toUpperCase()) palavra = maiuscula(palavra);
    const antes = partes.slice(0, -1).map((p) => concordar(p, t.genero));
    return [...antes, palavra].join(" ");
  });
}

/** Aplica o vocabulário em `message` e nos `message` dos detalhes de um erro (o servidor fala a língua da empresa). */
export function textoProfundo<T>(valor: T, v: Vocabulario | null | undefined): T {
  if (typeof valor === "string") return texto(valor, v) as T;
  if (Array.isArray(valor)) return valor.map((x) => textoProfundo(x, v)) as T;
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor as Record<string, unknown>).map(([k, x]) => [k, textoProfundo(x, v)])) as T;
  }
  return valor;
}
