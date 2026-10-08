// Criação de empresa: perfis-base da matriz padrão e uma unidade inicial. Roda no caminho do sistema
// (a empresa ainda não existe para o RLS); a partir daí, tudo dela passa por comEmpresa().
import { randomUUID } from "node:crypto";
import {
  INFO_PERFIS_BASE,
  PERFIS_BASE,
  PLANOS,
  permissoesDoPerfilBase,
  type Modulo,
  type PerfilBase,
  type Plano,
} from "../compartilhado/catalogo.js";
import type { Marca } from "../compartilhado/marca.js";
import { empresa, perfil, unidade } from "../db/esquema.js";
import type { Tx } from "../db/banco.js";
import { auditar, type Origem } from "./registro.js";

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
  unidadeId: string;
  perfis: Record<PerfilBase, string>;
}

export async function criarEmpresa(tx: Tx, origem: Omit<Origem, "empresaId">, dados: NovaEmpresa): Promise<EmpresaCriada> {
  if (tx.empresaId) throw new Error("criarEmpresa roda no caminho do sistema");
  const empresaId = randomUUID();
  const modulos = dados.plano === "sob_medida" ? (dados.modulos ?? []) : PLANOS[dados.plano].modulos;

  await tx.db.insert(empresa).values({
    id: empresaId,
    nome: dados.nome,
    plano: dados.plano,
    modulos,
    marca: dados.marca ?? {},
    vocabulario: dados.vocabulario ?? {},
    fuso: dados.fuso ?? "America/Sao_Paulo",
  });

  const perfis = {} as Record<PerfilBase, string>;
  for (const base of PERFIS_BASE) {
    perfis[base] = randomUUID();
    await tx.db.insert(perfil).values({
      id: perfis[base],
      empresaId,
      nome: INFO_PERFIS_BASE[base].nome,
      base,
      protegido: base === "dono",
      permissoes: permissoesDoPerfilBase(base),
      criadoPor: origem.atorId,
    });
  }

  const unidadeId = randomUUID();
  await tx.db.insert(unidade).values({
    id: unidadeId,
    empresaId,
    nome: dados.nomeUnidade ?? "Principal",
    criadoPor: origem.atorId,
  });

  await auditar(tx, { ...origem, empresaId }, {
    acao: "empresa.criada",
    entidade: "empresa",
    entidadeId: empresaId,
    depois: { nome: dados.nome, plano: dados.plano, modulos },
  });

  return { empresaId, unidadeId, perfis };
}
