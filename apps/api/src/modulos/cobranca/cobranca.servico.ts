// Cobrança recorrente atrás de interface (Prompt Mestre: fornecedor atrás de interface, com versão de
// demonstração que funciona sem conta). O provedor real entra depois, sem mudar telas nem regras.
import { and, desc, eq, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { DIAS_TESTE, PLANOS, PRECOS_PLANOS, type AssinaturaDto, type Modulo } from "@mg/shared";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { assinatura, empresa, fatura } from "../../infra/esquema.js";
import { conflito, invalido, naoEncontrado } from "../../infra/erros.js";
import { iso } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { fusoDe, hojeNoFuso, somarDias } from "../operacao/comum.js";

export interface ProvedorCobranca {
  readonly id: string;
  /** Cria a cobrança no provedor e devolve o link de pagamento (null no de demonstração). */
  criarCobranca(f: { empresaId: string; faturaId: string; valorCentavos: number; vencimento: string; descricao: string }): Promise<{ idExterno: string; link: string | null }>;
}

/** Demonstração: não fala com ninguém; a fatura é paga pelo botão "Pagar (simulado)". */
export function provedorCobrancaDemonstracao(): ProvedorCobranca {
  return {
    id: "demonstracao",
    async criarCobranca(f) {
      return { idExterno: `demo-${f.faturaId}`, link: null };
    },
  };
}

export const FILA_COBRANCA = "cobranca.ciclo";

const somarMes = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
};

export function criarServicoCobranca(s: Servicos, provedor: ProvedorCobranca = provedorCobrancaDemonstracao()) {
  const { banco } = s;

  /** Começa o período de teste (cadastro aberto). Roda na transação que cria a empresa. */
  async function iniciarTeste(tx: Tx, empresaId: string, plano: keyof typeof PRECOS_PLANOS, hoje: string): Promise<void> {
    const testeAte = somarDias(hoje, DIAS_TESTE);
    await tx.db.insert(assinatura).values({ empresaId, plano, status: "teste", valorCentavos: PRECOS_PLANOS[plano], provedor: provedor.id, testeAte, proximaCobranca: testeAte });
  }

  async function obter(ctx: ContextoEmpresa): Promise<AssinaturaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ plano: empresa.plano, modulos: empresa.modulos }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      const [a] = await tx.db.select().from(assinatura).where(eq(assinatura.empresaId, ctx.empresaId));
      const faturas = a
        ? await tx.db.select().from(fatura).where(eq(fatura.assinaturaId, a.id)).orderBy(desc(fatura.vencimento)).limit(24)
        : [];
      return {
        plano: e?.plano ?? "essencial",
        // Empresa sem assinatura (criada pela administração): plano ativo, sem cobrança pelo sistema.
        status: a?.status ?? "ativa",
        valorCentavos: a?.valorCentavos ?? 0,
        provedor: a?.provedor ?? "manual",
        testeAte: a?.testeAte ?? null,
        proximaCobranca: a?.proximaCobranca ?? null,
        modulos: e?.modulos ?? [],
        faturas: faturas.map((f) => ({ id: f.id, plano: f.plano, valorCentavos: f.valorCentavos, vencimento: f.vencimento, status: f.status, link: f.link, pagaEm: iso(f.pagaEm) })),
      };
    });
  }

  /** Trocar de plano liga/desliga módulos (desligar esconde, nunca apaga dados) e ajusta o valor da assinatura. */
  async function trocarPlano(ctx: ContextoEmpresa, origem: Origem, plano: keyof typeof PRECOS_PLANOS): Promise<AssinaturaDto> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ plano: empresa.plano, modulos: empresa.modulos }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      if (e?.plano === "sob_medida") throw conflito("O plano sob medida é ajustado pela equipe comercial. Fale com o suporte.");
      const modulos: Modulo[] = PLANOS[plano].modulos;
      await tx.db.update(empresa).set({ plano, modulos, atualizadoEm: new Date() }).where(eq(empresa.id, ctx.empresaId));
      const [a] = await tx.db.select().from(assinatura).where(eq(assinatura.empresaId, ctx.empresaId));
      if (a) {
        await tx.db.update(assinatura).set({ plano, valorCentavos: PRECOS_PLANOS[plano], atualizadoEm: new Date() }).where(eq(assinatura.id, a.id));
      } else {
        const hoje = hojeNoFuso(fusoDe(ctx));
        await tx.db.insert(assinatura).values({ empresaId: ctx.empresaId, plano, status: "ativa", valorCentavos: PRECOS_PLANOS[plano], provedor: provedor.id, proximaCobranca: hoje });
      }
      await registrar(tx, origem, { acao: "empresa.plano_alterado", entidade: "empresa", entidadeId: ctx.empresaId, antes: e, depois: { plano, modulos } });
    });
    return obter(ctx);
  }

  /** Só no provedor de demonstração: simula o pagamento. */
  async function pagarDemonstracao(ctx: ContextoEmpresa, origem: Origem, faturaId: string): Promise<AssinaturaDto> {
    if (provedor.id !== "demonstracao") throw invalido("O pagamento é feito pelo link da fatura.");
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [f] = await tx.db.select().from(fatura).where(and(eq(fatura.id, faturaId), eq(fatura.empresaId, ctx.empresaId)));
      if (!f) throw naoEncontrado("Fatura");
      if (f.status === "paga") throw conflito("Esta fatura já está paga.");
      await confirmarPagamento(tx, origem, f.id);
    });
    return obter(ctx);
  }

  /** Pagamento confirmado (pelo webhook do provedor ou pela simulação): fatura paga e assinatura em dia. */
  async function confirmarPagamento(tx: Tx, origem: Origem, faturaId: string): Promise<void> {
    const [f] = await tx.db.update(fatura).set({ status: "paga", pagaEm: new Date(), atualizadoEm: new Date() }).where(eq(fatura.id, faturaId)).returning();
    const [abertas] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(fatura)
      .where(and(eq(fatura.assinaturaId, f.assinaturaId), eq(fatura.status, "vencida")));
    if (!abertas.n) await tx.db.update(assinatura).set({ status: "ativa", atualizadoEm: new Date() }).where(eq(assinatura.id, f.assinaturaId));
    await registrar(tx, origem, { acao: "fatura.paga", entidade: "fatura", entidadeId: f.id, depois: { valorCentavos: f.valorCentavos, vencimento: f.vencimento } });
  }

  /**
   * Ciclo diário (job): gera a fatura de quem vence nos próximos 3 dias, marca as vencidas e põe a assinatura
   * como atrasada. Pode rodar mais de uma vez no mesmo dia sem duplicar (índice único por vencimento).
   */
  async function executarCiclo(hoje: string): Promise<{ geradas: number; vencidas: number }> {
    const limite = somarDias(hoje, 3);
    const aCobrar = await comoSistema(banco, (tx) =>
      tx.db
        .select()
        .from(assinatura)
        .where(and(ne(assinatura.status, "cancelada"), lte(assinatura.proximaCobranca, limite))),
    );
    let geradas = 0;
    for (const a of aCobrar) {
      if (!a.proximaCobranca) continue;
      await comEmpresa(banco, a.empresaId, async (tx) => {
        const [f] = await tx.db
          .insert(fatura)
          .values({ empresaId: a.empresaId, assinaturaId: a.id, plano: a.plano, valorCentavos: a.valorCentavos, vencimento: a.proximaCobranca! })
          .onConflictDoNothing()
          .returning();
        if (f) {
          const c = await provedor.criarCobranca({ empresaId: a.empresaId, faturaId: f.id, valorCentavos: f.valorCentavos, vencimento: f.vencimento, descricao: `Plano ${a.plano}` });
          await tx.db.update(fatura).set({ idExterno: c.idExterno, link: c.link }).where(eq(fatura.id, f.id));
          geradas++;
        }
        await tx.db.update(assinatura).set({ proximaCobranca: somarMes(a.proximaCobranca!), atualizadoEm: new Date() }).where(eq(assinatura.id, a.id));
      });
    }
    const vencidas = await comoSistema(banco, async (tx) => {
      const v = await tx.db
        .update(fatura)
        .set({ status: "vencida", atualizadoEm: new Date() })
        .where(and(eq(fatura.status, "pendente"), lt(fatura.vencimento, hoje)))
        .returning({ assinaturaId: fatura.assinaturaId });
      const ids = [...new Set(v.map((x) => x.assinaturaId))];
      if (ids.length) await tx.db.update(assinatura).set({ status: "atrasada", atualizadoEm: new Date() }).where(and(inArray(assinatura.id, ids), ne(assinatura.status, "cancelada")));
      return v.length;
    });
    return { geradas, vencidas };
  }

  return { provedor, iniciarTeste, obter, trocarPlano, pagarDemonstracao, confirmarPagamento, executarCiclo };
}
