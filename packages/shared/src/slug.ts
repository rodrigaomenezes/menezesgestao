// Identificador legível e único da empresa (ex.: "menezes-gestao"), usado em endereços e no domínio próprio.
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAXIMO = 40;

export function gerarSlug(texto: string): string {
  const base = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAXIMO)
    .replace(/-+$/g, "");
  return base || "empresa";
}
