// Cria uma empresa completa (unidades, equipes, pessoas com senha) a partir de uma descrição em dados.
// Usado pelo script de dados de exemplo e pelos testes.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Modulo, PerfilBase, Plano } from "../compartilhado/catalogo.js";
import type { Marca } from "../compartilhado/marca.js";
import { comoSistema, type Banco } from "../db/banco.js";
import { equipe, unidade, vinculo } from "../db/esquema.js";
import { criarEmpresa } from "./empresas.js";

export interface DescricaoEmpresa {
  nome: string;
  plano: Plano;
  modulos?: Modulo[];
  marca?: Partial<Marca>;
  vocabulario?: Record<string, string>;
  unidades: string[];
  equipes: { nome: string; unidade?: string; gestor?: string }[];
  pessoas: { chave: string; nome: string; email: string; perfil: PerfilBase; unidade?: string; equipe?: string }[];
}

export interface EmpresaSemeada {
  empresaId: string;
  perfis: Record<PerfilBase, string>;
  unidades: Record<string, string>;
  equipes: Record<string, string>;
  pessoas: Record<string, { usuarioId: string; vinculoId: string }>;
}

export async function semearEmpresa(banco: Banco, d: DescricaoEmpresa, senhaHash: string): Promise<EmpresaSemeada> {
  return comoSistema(banco, async (tx) => {
    const origem = { atorId: null, ip: null, dispositivo: "dados de exemplo" };
    const [primeira, ...outras] = d.unidades;
    const criada = await criarEmpresa(tx, origem, {
      nome: d.nome,
      plano: d.plano,
      modulos: d.modulos,
      marca: d.marca,
      vocabulario: d.vocabulario,
      nomeUnidade: primeira,
    });
    const { empresaId } = criada;

    const unidades: Record<string, string> = { [primeira ?? "Principal"]: criada.unidadeId };
    for (const nome of outras) {
      unidades[nome] = randomUUID();
      await tx.db.insert(unidade).values({ id: unidades[nome], empresaId, nome });
    }

    const pessoas: EmpresaSemeada["pessoas"] = {};
    for (const p of d.pessoas) {
      const { rows } = await tx.cliente.query<{ id: string }>(
        `INSERT INTO usuario (email, nome, senha_hash) VALUES ($1, $2, $3)
         ON CONFLICT ((lower(email))) DO UPDATE SET senha_hash = COALESCE(usuario.senha_hash, EXCLUDED.senha_hash)
         RETURNING id`,
        [p.email, p.nome, senhaHash],
      );
      const vinculoId = randomUUID();
      await tx.db.insert(vinculo).values({
        id: vinculoId,
        empresaId,
        usuarioId: rows[0].id,
        perfilId: criada.perfis[p.perfil],
        unidadeId: p.unidade ? unidades[p.unidade] : null,
        status: "ativo",
      });
      pessoas[p.chave] = { usuarioId: rows[0].id, vinculoId };
    }

    const equipes: Record<string, string> = {};
    for (const e of d.equipes) {
      equipes[e.nome] = randomUUID();
      await tx.db.insert(equipe).values({
        id: equipes[e.nome],
        empresaId,
        nome: e.nome,
        unidadeId: e.unidade ? unidades[e.unidade] : null,
        gestorId: e.gestor ? pessoas[e.gestor].usuarioId : null,
      });
    }
    for (const p of d.pessoas) {
      if (p.equipe) {
        await tx.db
          .update(vinculo)
          .set({ equipeId: equipes[p.equipe] })
          .where(eq(vinculo.id, pessoas[p.chave].vinculoId));
      }
    }

    return { empresaId, perfis: criada.perfis, unidades, equipes, pessoas };
  });
}
