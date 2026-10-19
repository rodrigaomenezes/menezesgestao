// Ícones de traço (24 × 24), desenhados com SVG no próprio componente: sem biblioteca externa e sem innerHTML.
const TRACOS: Record<string, string[]> = {
  inicio: ["M3 11l9-7 9 7", "M5 10v10h14V10"],
  conversas: ["M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"],
  contatos: ["M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20a6.5 6.5 0 0 1 13 0", "M16 4.5a3.5 3.5 0 0 1 0 7", "M18 14.5a6.5 6.5 0 0 1 3.5 5.5"],
  funil: ["M3 5h18l-7 8v6l-4 2v-8z"],
  fila: ["M4 6h16", "M4 12h16", "M4 18h10"],
  ligacoes: ["M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"],
  tarefas: ["M9 11l3 3 8-8", "M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"],
  agenda: ["M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3 10h18", "M8 3v4", "M16 3v4"],
  horas: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  desempenho: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  mapa: ["M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z", "M9 3v15", "M15 6v15"],
  scripts: ["M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 12h6", "M9 16h6"],
  vendas: ["M12 2v20", "M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  comissoes: ["M19 5L5 19", "M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
  catalogo: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  qualidade: ["M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"],
  pesquisas: ["M4 19V5", "M4 19h16", "M8 15l3-4 3 2 4-6"],
  importar: ["M12 3v12", "M7 10l5 5 5-5", "M4 21h16"],
  configuracoes: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"],
  pessoas: ["M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2", "M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M21 21v-2a4 4 0 0 0-3-3.9"],
  empresa: ["M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16", "M16 9h2a2 2 0 0 1 2 2v10", "M8 7h4", "M8 11h4", "M8 15h4", "M2 21h20"],
  seguranca: ["M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"],
  avisos: ["M6 9a6 6 0 0 1 12 0c0 6 2 8 2 8H4s2-2 2-8", "M10 20a2 2 0 0 0 4 0"],
  mais: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  subir: ["M12 19V5", "M6 11l6-6 6 6"],
  descer: ["M12 5v14", "M6 13l6 6 6-6"],
  fechar: ["M6 6l12 12", "M18 6L6 18"],
  adicionar: ["M12 5v14", "M5 12h14"],
  arrastar: ["M9 6h.01", "M9 12h.01", "M9 18h.01", "M15 6h.01", "M15 12h.01", "M15 18h.01"],
};

export type NomeIcone = keyof typeof TRACOS;

export function Icone({ nome, tamanho = 20 }: { nome: NomeIcone; tamanho?: number }) {
  const grosso = nome === "mais" || nome === "arrastar";
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={grosso ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACOS[nome]!.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
