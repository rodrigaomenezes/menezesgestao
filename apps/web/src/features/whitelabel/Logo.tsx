// Logo da empresa: versão para fundo claro e, se houver, para o tema escuro.
export function Logo({ claro, escuro, nome, classe }: { claro?: string | null; escuro?: string | null; nome: string; classe?: string }) {
  if (!claro && !escuro) return null;
  return (
    <picture>
      {escuro && <source srcSet={escuro} media="(prefers-color-scheme: dark)" />}
      <img src={claro ?? escuro ?? ""} alt={nome} className={classe ?? "logo"} />
    </picture>
  );
}
