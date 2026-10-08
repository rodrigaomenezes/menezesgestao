// Catálogo de módulos, ações, escopos e perfis-base. Compartilhado entre servidor e front.
// É o produto (o que existe), não regra de cliente: cada empresa liga módulos e ajusta perfis por configuração.

export const MODULOS = [
  { id: "usuarios", nome: "Usuários e permissões", nucleo: true },
  { id: "configuracoes", nome: "Configurações da empresa", nucleo: true },
  { id: "auditoria", nome: "Auditoria e relatórios", nucleo: true },
  { id: "crm", nome: "CRM e funil", nucleo: false },
  { id: "conversas", nome: "Conversas", nucleo: false },
  { id: "telefonia", nome: "Central de telefonia", nucleo: false },
  { id: "fila", nome: "Fila de ligações", nucleo: false },
  { id: "agenda", nome: "Agenda, escala e horas", nucleo: false },
  { id: "rotina", nome: "Rotina diária", nucleo: false },
  { id: "desempenho", nome: "Desempenho e metas", nucleo: false },
  { id: "mapa", nome: "Mapa de atividades", nucleo: false },
  { id: "scripts", nome: "Biblioteca de scripts", nucleo: false },
  { id: "qualidade", nome: "Monitoramento de qualidade", nucleo: false },
  { id: "vendas", nome: "Vendas e comissões", nucleo: false },
  { id: "servicos", nome: "Serviços e entregas", nucleo: false },
  { id: "pesquisa", nome: "Pesquisa de mercado", nucleo: false },
] as const;

export type Modulo = (typeof MODULOS)[number]["id"];
export const IDS_MODULOS = MODULOS.map((m) => m.id) as Modulo[];
export const MODULOS_NUCLEO = MODULOS.filter((m) => m.nucleo).map((m) => m.id) as Modulo[];

export const ACOES = ["ver", "criar", "editar", "arquivar", "exportar", "administrar"] as const;
export type Acao = (typeof ACOES)[number];
export const NOMES_ACOES: Record<Acao, string> = {
  ver: "Ver",
  criar: "Criar",
  editar: "Editar",
  arquivar: "Arquivar",
  exportar: "Exportar",
  administrar: "Administrar",
};

/** Do mais restrito ao mais amplo. */
export const ESCOPOS = ["proprio", "equipe", "unidade", "empresa"] as const;
export type Escopo = (typeof ESCOPOS)[number];
export const NOMES_ESCOPOS: Record<Escopo, string> = {
  proprio: "Só o próprio",
  equipe: "Da equipe",
  unidade: "Da unidade",
  empresa: "Toda a empresa",
};

/** permissoes[modulo][acao] = escopo. Ausente = sem acesso. */
export type Permissoes = Partial<Record<Modulo, Partial<Record<Acao, Escopo>>>>;

export const PERFIS_BASE = ["dono", "gestor", "vendedor", "operacao", "financeiro"] as const;
export type PerfilBase = (typeof PERFIS_BASE)[number];

export const INFO_PERFIS_BASE: Record<PerfilBase, { nome: string; escopo: Escopo }> = {
  dono: { nome: "Dono / Administrador", escopo: "empresa" },
  gestor: { nome: "Gestor", escopo: "equipe" },
  vendedor: { nome: "Vendedor / Atendente", escopo: "proprio" },
  operacao: { nome: "Operação / Prestador", escopo: "proprio" },
  financeiro: { nome: "Financeiro", escopo: "empresa" },
};

// Matriz padrão da especificação. A administra · E edita · V vê · P só o próprio · - sem acesso.
// Colunas: dono, gestor, vendedor, operacao, financeiro.
type Nivel = "A" | "E" | "V" | "P" | "-";
const MATRIZ: Record<Modulo, [Nivel, Nivel, Nivel, Nivel, Nivel]> = {
  usuarios: ["A", "V", "-", "-", "-"],
  configuracoes: ["A", "-", "-", "-", "-"],
  crm: ["A", "E", "P", "-", "V"],
  conversas: ["A", "E", "P", "-", "-"],
  telefonia: ["A", "E", "P", "-", "-"],
  fila: ["A", "E", "P", "-", "-"],
  agenda: ["A", "E", "P", "P", "V"],
  rotina: ["A", "E", "P", "P", "-"],
  desempenho: ["A", "E", "P", "P", "V"],
  mapa: ["A", "E", "P", "P", "-"],
  scripts: ["A", "E", "V", "V", "-"],
  qualidade: ["A", "E", "P", "-", "-"],
  vendas: ["A", "E", "P", "-", "E"],
  servicos: ["A", "E", "V", "P", "V"],
  pesquisa: ["A", "E", "V", "-", "-"],
  auditoria: ["A", "V", "-", "-", "V"],
};

const ACOES_POR_NIVEL: Record<Exclude<Nivel, "-">, readonly Acao[]> = {
  A: ACOES,
  E: ["ver", "criar", "editar", "arquivar", "exportar"],
  V: ["ver"],
  P: ["ver", "criar", "editar", "arquivar"],
};

function escopoDoNivel(nivel: Exclude<Nivel, "-">, perfil: PerfilBase): Escopo {
  const padrao = INFO_PERFIS_BASE[perfil].escopo;
  if (nivel === "A") return "empresa";
  if (nivel === "P") return "proprio";
  // Quem só vê conteúdo comum (scripts, catálogo) vê o da empresa toda.
  if (nivel === "V" && padrao === "proprio") return "empresa";
  return padrao;
}

export function permissoesDoPerfilBase(perfil: PerfilBase): Permissoes {
  const coluna = PERFIS_BASE.indexOf(perfil);
  const resultado: Permissoes = {};
  for (const modulo of IDS_MODULOS) {
    const nivel = MATRIZ[modulo][coluna];
    if (nivel === "-") continue;
    const escopo = escopoDoNivel(nivel, perfil);
    resultado[modulo] = Object.fromEntries(ACOES_POR_NIVEL[nivel].map((a) => [a, escopo]));
  }
  return resultado;
}

export const PLANOS = {
  essencial: { nome: "Essencial", modulos: ["crm", "rotina"] },
  comercial: { nome: "Comercial", modulos: ["crm", "rotina", "conversas", "fila", "desempenho"] },
  completo: {
    nome: "Completo",
    modulos: IDS_MODULOS.filter((m) => !MODULOS_NUCLEO.includes(m)),
  },
} satisfies Record<string, { nome: string; modulos: Modulo[] }>;
export type Plano = keyof typeof PLANOS | "sob_medida";

export function moduloAtivo(modulo: Modulo, ativos: readonly string[]): boolean {
  return MODULOS_NUCLEO.includes(modulo) || ativos.includes(modulo);
}

export function temPermissao(permissoes: Permissoes, modulo: Modulo, acao: Acao): Escopo | null {
  return permissoes[modulo]?.[acao] ?? null;
}

/** Normaliza o JSON vindo do banco ou de um formulário, descartando chaves desconhecidas. */
export function limparPermissoes(bruto: unknown): Permissoes {
  const resultado: Permissoes = {};
  if (!bruto || typeof bruto !== "object") return resultado;
  for (const [modulo, acoes] of Object.entries(bruto as Record<string, unknown>)) {
    if (!IDS_MODULOS.includes(modulo as Modulo) || !acoes || typeof acoes !== "object") continue;
    const limpo: Partial<Record<Acao, Escopo>> = {};
    for (const [acao, escopo] of Object.entries(acoes as Record<string, unknown>)) {
      if (ACOES.includes(acao as Acao) && ESCOPOS.includes(escopo as Escopo)) {
        limpo[acao as Acao] = escopo as Escopo;
      }
    }
    if (Object.keys(limpo).length) resultado[modulo as Modulo] = limpo;
  }
  return resultado;
}

export function perfilAdministra(permissoes: Permissoes): boolean {
  return Object.values(permissoes).some((acoes) => acoes?.administrar);
}
