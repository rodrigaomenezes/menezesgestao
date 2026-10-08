// Criação de empresa: slug único, perfis-base da matriz padrão e uma unidade inicial. Roda no caminho do
// sistema (a empresa ainda não existe para o RLS); a partir daí, tudo dela passa por comEmpresa().
import { randomUUID } from "node:crypto";
import { like } from "drizzle-orm";
import {
  INFO_PERFIS_BASE,
  PERFIS_BASE,
  PLANOS,
  gerarSlug,
  permissoesDoPerfilBase,
  type Marca,
  type Modulo,
  type PerfilBase,
  type Plano,
} from "@mg/shared";
import { empresa, unidade } from "../../infra/esquema.js";
import type { Tx } from "../../infra/banco.js";
import { auditar, type Origem } from "../auditoria/registro.js";
import { gravarPermissoes, inserirPerfil } from "../permissoes/permissoes.repositorio.js";

export interface NovaEmpresa {
  nome: string;
  plano: Plano;
  /** Obrigatório no plano sob medida; nos demais vem do plano. */
  modulos?: Modulo[];
  marca?: Partial<Marca>;
  vocabulario?: Record<string, string>;
  fuso?: string;
  nomeUnidade?: string;
}

export interface EmpresaCriada {
  empresaId: string;
  slug: string;
  unidadeId: string;
  perfis: Record<PerfilBase, string>;
}

/** Slug a partir do nome; se já existir, acrescenta -2, -3… */
export async function slugDisponivel(tx: Tx, nome: string): Promise<string> {
  const base = gerarSlug(nome);
  const usados = new Set(
    (await tx.db.select({ slug: empresa.slug }).from(empresa).where(like(empresa.slug, `${base}%`))).map((r) => r.slug),
  );
  if (!usados.has(base)) return base;
  for (let n = 2; ; n++) if (!usados.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function criarEmpresa(tx: Tx, origem: Omit<Origem, "empresaId">, dados: NovaEmpresa): Promise<EmpresaCriada> {
  if (tx.empresaId) throw new Error("criarEmpresa roda no caminho do sistema");
  const empresaId = randomUUID();
  const modulos = dados.plano === "sob_medida" ? (dados.modulos ?? []) : PLANOS[dados.plano].modulos;
  const slug = await slugDisponivel(tx, dados.nome);

  await tx.db.insert(empresa).values({
    id: empresaId,
    nome: dados.nome,
    slug,
    plano: dados.plano,
    modulos,
    marca: dados.marca ?? {},
    vocabulario: dados.vocabulario ?? {},
    fuso: dados.fuso ?? "America/Sao_Paulo",
  });

  const perfis = {} as Record<PerfilBase, string>;
  for (const base of PERFIS_BASE) {
    const p = await inserirPerfil(tx, {
      empresaId,
      nome: INFO_PERFIS_BASE[base].nome,
      base,
      protegido: base === "dono",
      criadoPor: origem.atorId,
    });
    perfis[base] = p.id;
    await gravarPermissoes(tx, empresaId, p.id, permissoesDoPerfilBase(base));
  }

  const unidadeId = randomUUID();
  await tx.db.insert(unidade).values({ id: unidadeId, empresaId, nome: dados.nomeUnidade ?? "Principal", criadoPor: origem.atorId });

  await auditar(tx, { ...origem, empresaId }, {
    acao: "empresa.criada",
    entidade: "empresa",
    entidadeId: empresaId,
    depois: { nome: dados.nome, slug, plano: dados.plano, modulos },
  });

  return { empresaId, slug, unidadeId, perfis };
}
