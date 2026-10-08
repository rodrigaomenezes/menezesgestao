// Dados de exemplo do CRM (npm run db:seed): etiquetas, contatos em carteiras diferentes e oportunidades
// espalhadas pelas etapas do funil padrão. Telefones fictícios, normalizados como na vida real.
import { and, asc, eq } from "drizzle-orm";
import { normalizarTelefone } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { contato, contatoEtiqueta, etapa, etiqueta, funil, oportunidade } from "../../infra/esquema.js";
import { registrar } from "../auditoria/registro.js";

export interface DescricaoCrm {
  etiquetas?: { nome: string; cor: string }[];
  contatos: {
    nome: string;
    telefone: string;
    email?: string;
    origem?: string;
    /** Chave da pessoa responsável (da descrição da empresa). */
    responsavel: string;
    etiquetas?: string[];
    oportunidade?: { titulo: string; etapa: number; valor?: number };
  }[];
}

export async function semearCrm(tx: Tx, empresaId: string, d: DescricaoCrm, pessoas: Record<string, { usuarioId: string }>): Promise<void> {
  const etiquetas = new Map<string, string>();
  for (const e of d.etiquetas ?? []) {
    const [linha] = await tx.db.insert(etiqueta).values({ empresaId, nome: e.nome, cor: e.cor }).returning({ id: etiqueta.id });
    etiquetas.set(e.nome, linha.id);
  }
  const [principal] = await tx.db.select().from(funil).where(eq(funil.empresaId, empresaId)).orderBy(asc(funil.ordem)).limit(1);
  const etapas = principal
    ? await tx.db.select().from(etapa).where(and(eq(etapa.empresaId, empresaId), eq(etapa.funilId, principal.id))).orderBy(asc(etapa.ordem))
    : [];

  for (const c of d.contatos) {
    const responsavelId = pessoas[c.responsavel]?.usuarioId ?? null;
    const origem = { empresaId, atorId: responsavelId, ip: null, dispositivo: "dados de exemplo" };
    const [{ id }] = await tx.db
      .insert(contato)
      .values({ empresaId, nome: c.nome, telefone: normalizarTelefone(c.telefone), email: c.email ?? null, origem: c.origem ?? null, responsavelId, criadoPor: responsavelId })
      .returning({ id: contato.id });
    const ids = (c.etiquetas ?? []).map((n) => etiquetas.get(n)).filter((x): x is string => Boolean(x));
    if (ids.length) await tx.db.insert(contatoEtiqueta).values(ids.map((etiquetaId) => ({ empresaId, contatoId: id, etiquetaId })));
    await registrar(tx, origem, { acao: "contato.criado", entidade: "contato", entidadeId: id, contatoId: id, responsavelId, silencioso: true, depois: { nome: c.nome } });

    const et = c.oportunidade && etapas[Math.min(c.oportunidade.etapa, etapas.length - 1)];
    if (c.oportunidade && et && principal) {
      const [op] = await tx.db
        .insert(oportunidade)
        .values({
          empresaId,
          contatoId: id,
          funilId: principal.id,
          etapaId: et.id,
          titulo: c.oportunidade.titulo,
          valorCentavos: c.oportunidade.valor ? c.oportunidade.valor * 100 : null,
          status: et.tipo,
          fechadaEm: et.tipo === "aberta" ? null : new Date(),
          responsavelId,
          criadoPor: responsavelId,
        })
        .returning({ id: oportunidade.id });
      await registrar(tx, origem, { acao: "oportunidade.criada", entidade: "oportunidade", entidadeId: op.id, contatoId: id, responsavelId, silencioso: true, depois: { titulo: c.oportunidade.titulo }, dados: { titulo: c.oportunidade.titulo } });
    }
  }
}
