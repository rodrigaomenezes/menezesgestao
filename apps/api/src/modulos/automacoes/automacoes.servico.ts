// Automações "quando [evento] e se [condições], então [ação]". Um job varre os eventos recentes (a mesma tabela
// somente-inserção que alimenta histórico e metas) e roda cada regra uma vez por evento: a execução é gravada
// na mesma transação da ação, com índice único (regra × evento) — passar duas vezes não repete nada.
import { erroSeguro, registrarLog } from "../../infra/log.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { preencherVariaveis, type RegraAutomacaoDto } from "@mg/shared";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import {
  automacaoExecucao,
  canal,
  contato,
  contatoEtiqueta,
  conversa,
  empresa,
  equipe,
  etapa,
  oportunidade,
  perfil,
  regraAutomacao,
  tarefa,
  vinculo,
  type CondicaoAutomacao,
} from "../../infra/esquema.js";
import { codigoPg, invalido, naoEncontrado } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import type { ServicoEnvio } from "../conversas/envio.servico.js";
import { notificar } from "../notificacoes/notificar.js";

export const FILA_AUTOMACOES = "automacao.varrer";

interface Evento {
  id: string;
  empresa_id: string;
  tipo: string;
  entidade: string;
  entidade_id: string | null;
  contato_id: string | null;
  dados: Record<string, unknown>;
}
type Regra = typeof regraAutomacao.$inferSelect;
type Resultado = { status: "executada" | "ignorada"; detalhe?: string };

class Ignorar extends Error {}

export function criarServicoAutomacoes(s: Servicos, envio: ServicoEnvio | null) {
  const { banco } = s;

  // CRUD ------------------------------------------------------------------------------------------------

  async function listar(ctx: ContextoEmpresa): Promise<{ itens: RegraAutomacaoDto[] }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .select({
          r: regraAutomacao,
          execucoes: sql<number>`(SELECT count(*)::int FROM automacao_execucao x WHERE x.regra_id = ${sql.raw('"regra_automacao"."id"')} AND x.status = 'executada')`,
          ultima: sql<Date | null>`(SELECT max(x.criado_em) FROM automacao_execucao x WHERE x.regra_id = ${sql.raw('"regra_automacao"."id"')})`,
        })
        .from(regraAutomacao)
        .where(and(eq(regraAutomacao.empresaId, ctx.empresaId), isNull(regraAutomacao.arquivadoEm)))
        .orderBy(desc(regraAutomacao.criadoEm))
        .limit(200);
      return {
        itens: linhas.map(({ r, execucoes, ultima }) => ({
          id: r.id,
          nome: r.nome,
          gatilho: r.gatilho,
          condicoes: r.condicoes,
          acao: r.acao,
          parametros: r.parametros,
          ativa: r.ativa,
          execucoes: Number(execucoes),
          ultimaExecucao: ultima ? new Date(ultima).toISOString() : null,
        })),
      };
    });
  }

  async function criar(
    ctx: ContextoEmpresa,
    origem: Origem,
    d: { nome: string; gatilho: string; condicoes: CondicaoAutomacao[]; acao: Regra["acao"]; parametros: Record<string, string | number | undefined> },
  ): Promise<{ id: string }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      if (d.parametros.etapaId) {
        const [e] = await tx.db.select({ id: etapa.id }).from(etapa).where(and(eq(etapa.id, String(d.parametros.etapaId)), eq(etapa.empresaId, ctx.empresaId)));
        if (!e) throw invalido("Etapa não encontrada.");
      }
      if (d.parametros.canalId) {
        const [c] = await tx.db.select({ id: canal.id }).from(canal).where(and(eq(canal.id, String(d.parametros.canalId)), eq(canal.empresaId, ctx.empresaId)));
        if (!c) throw invalido("Canal não encontrado.");
      }
      const parametros = Object.fromEntries(Object.entries(d.parametros).filter(([, v]) => v !== undefined)) as Record<string, string | number>;
      const [r] = await tx.db
        .insert(regraAutomacao)
        .values({ empresaId: ctx.empresaId, nome: d.nome, gatilho: d.gatilho, condicoes: d.condicoes, acao: d.acao, parametros, criadoPor: ctx.usuarioId })
        .returning({ id: regraAutomacao.id });
      await registrar(tx, origem, { acao: "automacao.regra_criada", entidade: "regra_automacao", entidadeId: r.id, depois: d });
      return r;
    });
  }

  async function atualizar(ctx: ContextoEmpresa, origem: Origem, id: string, d: { ativa?: boolean; arquivar?: boolean }): Promise<{ ok: true }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [r] = await tx.db
        .update(regraAutomacao)
        .set({
          ...(d.ativa !== undefined ? { ativa: d.ativa } : {}),
          ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
          atualizadoEm: new Date(),
        })
        .where(and(eq(regraAutomacao.id, id), eq(regraAutomacao.empresaId, ctx.empresaId)))
        .returning({ id: regraAutomacao.id });
      if (!r) throw naoEncontrado("Automação");
      await registrar(tx, origem, { acao: "automacao.regra_alterada", entidade: "regra_automacao", entidadeId: id, depois: d });
      return { ok: true as const };
    });
  }

  // Execução --------------------------------------------------------------------------------------------

  async function condicaoVale(tx: Tx, ev: Evento, c: CondicaoAutomacao): Promise<boolean> {
    if (c.campo === "contato.etiqueta") {
      if (!ev.contato_id || !c.valor) return false;
      const [t] = await tx.db.select({ x: sql`1` }).from(contatoEtiqueta).where(and(eq(contatoEtiqueta.contatoId, ev.contato_id), eq(contatoEtiqueta.etiquetaId, c.valor)));
      return Boolean(t);
    }
    if (c.campo === "contato.responsavel") {
      if (!ev.contato_id) return false;
      const [ct] = await tx.db.select({ r: contato.responsavelId }).from(contato).where(eq(contato.id, ev.contato_id));
      return c.operador === "vazio" ? !ct?.r : Boolean(ct?.r);
    }
    const bruto = ev.dados[c.campo];
    const valor = typeof bruto === "boolean" ? (bruto ? "sim" : "nao") : bruto == null ? "" : String(bruto);
    const alvo = (c.valor ?? "").toLowerCase();
    switch (c.operador) {
      case "igual":
        return valor.toLowerCase() === alvo;
      case "diferente":
        return valor.toLowerCase() !== alvo;
      case "contem":
        return valor.toLowerCase().includes(alvo);
      case "vazio":
        return !valor;
      case "preenchido":
        return Boolean(valor);
      default:
        return false;
    }
  }

  async function dadosDoContato(tx: Tx, contatoId: string | null) {
    if (!contatoId) return null;
    const [c] = await tx.db
      .select({ id: contato.id, nome: contato.nome, telefone: contato.telefone, responsavelId: contato.responsavelId, naoContatar: contato.naoContatar, arquivadoEm: contato.arquivadoEm })
      .from(contato)
      .where(eq(contato.id, contatoId));
    return c ?? null;
  }

  async function agir(tx: Tx, origem: Origem, r: Regra, ev: Evento): Promise<Resultado> {
    const p = r.parametros;
    const ct = await dadosDoContato(tx, ev.contato_id);
    const marca = { regraAutomacaoId: r.id };
    const [emp] = await tx.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, ev.empresa_id));
    const variaveis = { nome: ct?.nome?.split(" ")[0] ?? "", empresa: emp?.nome ?? "" };

    switch (r.acao) {
      case "criar_tarefa": {
        if (!ct) throw new Ignorar("O evento não tem contato.");
        const horas = Number(p.horas ?? 0);
        const [t] = await tx.db
          .insert(tarefa)
          .values({
            empresaId: ev.empresa_id,
            contatoId: ct.id,
            titulo: preencherVariaveis(String(p.titulo), variaveis).slice(0, 200),
            responsavelId: ct.responsavelId,
            venceEm: new Date(Date.now() + horas * 3_600_000),
          })
          .returning({ id: tarefa.id });
        await registrar(tx, origem, { acao: "tarefa.criada", entidade: "tarefa", entidadeId: t.id, contatoId: ct.id, responsavelId: ct.responsavelId, dados: { titulo: String(p.titulo), ...marca } });
        return { status: "executada", detalhe: "Tarefa criada." };
      }
      case "mover_etapa": {
        const [destino] = await tx.db.select().from(etapa).where(eq(etapa.id, String(p.etapaId)));
        if (!destino || destino.arquivadoEm) throw new Ignorar("A etapa de destino não existe mais.");
        const [op] =
          ev.entidade === "oportunidade" && ev.entidade_id
            ? await tx.db.select().from(oportunidade).where(eq(oportunidade.id, ev.entidade_id))
            : ct
              ? await tx.db
                  .select()
                  .from(oportunidade)
                  .where(and(eq(oportunidade.contatoId, ct.id), eq(oportunidade.funilId, destino.funilId), eq(oportunidade.status, "aberta"), isNull(oportunidade.arquivadoEm)))
                  .orderBy(desc(oportunidade.atualizadoEm))
                  .limit(1)
              : [];
        if (!op || op.funilId !== destino.funilId || op.status !== "aberta" || op.etapaId === destino.id) throw new Ignorar("Nenhuma oportunidade aberta para mover nesse funil.");
        const status = destino.tipo === "aberta" ? "aberta" : destino.tipo;
        await tx.db.update(oportunidade).set({ etapaId: destino.id, status, atualizadoEm: new Date() }).where(eq(oportunidade.id, op.id));
        await registrar(tx, origem, {
          acao: "oportunidade.etapa_alterada",
          entidade: "oportunidade",
          entidadeId: op.id,
          contatoId: op.contatoId,
          responsavelId: op.responsavelId,
          dados: { titulo: op.titulo, etapaNova: destino.nome, oportunidadeId: op.id, etapaAnteriorId: op.etapaId, etapaNovaId: destino.id, ...marca },
        });
        return { status: "executada", detalhe: `Movida para ${destino.nome}.` };
      }
      case "avisar": {
        const texto = preencherVariaveis(String(p.texto), variaveis);
        const destinos = new Set<string>();
        if (ct?.responsavelId) {
          destinos.add(ct.responsavelId);
          const gestores = await tx.db
            .select({ id: equipe.gestorId })
            .from(vinculo)
            .innerJoin(equipe, eq(equipe.id, vinculo.equipeId))
            .where(and(eq(vinculo.empresaId, ev.empresa_id), eq(vinculo.usuarioId, ct.responsavelId)));
          for (const g of gestores) if (g.id) destinos.add(g.id);
        }
        if (destinos.size <= 1) {
          // Sem gestor de equipe: avisa quem administra a empresa.
          const donos = await tx.db
            .select({ id: vinculo.usuarioId })
            .from(vinculo)
            .innerJoin(perfil, eq(perfil.id, vinculo.perfilId))
            .where(and(eq(vinculo.empresaId, ev.empresa_id), eq(perfil.base, "dono"), eq(vinculo.status, "ativo"), isNull(vinculo.arquivadoEm)));
          for (const d of donos) destinos.add(d.id);
        }
        for (const usuarioId of destinos) {
          await notificar(tx, origem, { usuarioId, titulo: r.nome, texto, link: ct ? `/contatos/${ct.id}` : undefined });
        }
        return { status: "executada", detalhe: `${destinos.size} pessoa(s) avisada(s).` };
      }
      case "enviar_mensagem": {
        if (!envio) throw new Ignorar("Mensagens indisponíveis.");
        if (!ct?.telefone || ct.arquivadoEm) throw new Ignorar("Contato sem telefone.");
        if (ct.naoContatar) throw new Ignorar("Contato pediu para não ser contatado (LGPD).");
        const [cn] = await tx.db.select().from(canal).where(and(eq(canal.id, String(p.canalId)), isNull(canal.arquivadoEm)));
        if (!cn) throw new Ignorar("O canal não existe mais.");
        let [c] = await tx.db
          .select()
          .from(conversa)
          .where(and(eq(conversa.canalId, cn.id), eq(conversa.contatoId, ct.id), isNull(conversa.mescladaEmId)))
          .limit(1);
        if (!c) {
          [c] = await tx.db
            .insert(conversa)
            .values({ empresaId: ev.empresa_id, canalId: cn.id, contatoId: ct.id, telefone: ct.telefone, atribuidaA: ct.responsavelId, equipeId: cn.equipeId, ultimaMensagemEm: new Date() })
            .returning();
        }
        const texto = preencherVariaveis(String(p.texto), { ...variaveis, vendedor: "" });
        await envio.criarSaida(tx, origem, c, { tipo: "texto", texto, autorId: null });
        return { status: "executada", detalhe: "Mensagem enfileirada." };
      }
    }
  }

  /** Avalia uma regra num evento e grava a execução (tudo na mesma transação). */
  async function executar(r: Regra, ev: Evento): Promise<Resultado | null> {
    const origem: Origem = { empresaId: ev.empresa_id, atorId: null, ip: null, dispositivo: "automação" };
    try {
      return await comEmpresa(banco, ev.empresa_id, async (tx) => {
        let resultado: Resultado;
        let condicoesOk = true;
        for (const c of r.condicoes) if (!(await condicaoVale(tx, ev, c))) condicoesOk = false;
        if (!condicoesOk) resultado = { status: "ignorada", detalhe: "Condições não atendidas." };
        else {
          try {
            resultado = await agir(tx, origem, r, ev);
          } catch (err) {
            if (!(err instanceof Ignorar)) throw err;
            resultado = { status: "ignorada", detalhe: err.message };
          }
        }
        await tx.db.insert(automacaoExecucao).values({ empresaId: ev.empresa_id, regraId: r.id, eventoId: ev.id, status: resultado.status, detalhe: resultado.detalhe ?? null });
        return resultado;
      });
    } catch (err) {
      if (codigoPg(err) === "23505") return null; // outra varredura já executou esta regra neste evento
      // Falha inesperada: registra para não tentar de novo para sempre (e aparece na tela da regra).
      await comEmpresa(banco, ev.empresa_id, (tx) =>
        tx.db
          .insert(automacaoExecucao)
          .values({ empresaId: ev.empresa_id, regraId: r.id, eventoId: ev.id, status: "falhou", detalhe: (err as Error).message.slice(0, 500) })
          .onConflictDoNothing(),
      );
      registrarLog({ level: "error", event: "automacao.falhou", regraId: r.id, eventoId: ev.id, erro: erroSeguro(err) });
      return null;
    }
  }

  /**
   * Varre os eventos dos últimos 15 minutos que casam com regras ativas e ainda não foram tratados por elas.
   * Eventos gerados por automações não disparam outras automações (sem laços).
   */
  async function varrer(): Promise<number> {
    const pares = await comoSistema(banco, (tx) =>
      tx.cliente.query<Evento & { regra_id: string }>(
        `SELECT e.id, e.empresa_id, e.tipo, e.entidade, e.entidade_id, e.contato_id, e.dados, r.id AS regra_id
           FROM regra_automacao r
           JOIN evento e ON e.empresa_id = r.empresa_id AND e.tipo = r.gatilho
          WHERE r.ativa AND r.arquivado_em IS NULL
            AND e.criado_em > now() - interval '15 minutes' AND e.criado_em >= r.criado_em
            AND NOT (e.dados ? 'regraAutomacaoId')
            AND NOT EXISTS (SELECT 1 FROM automacao_execucao x WHERE x.regra_id = r.id AND x.evento_id = e.id)
          ORDER BY e.criado_em
          LIMIT 500`,
      ),
    );
    if (!pares.rows.length) return 0;
    const ids = [...new Set(pares.rows.map((p) => p.regra_id))];
    const regras = await comoSistema(banco, (tx) => tx.db.select().from(regraAutomacao).where(sql`${regraAutomacao.id} IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`));
    const porId = new Map(regras.map((r) => [r.id, r]));
    let executadas = 0;
    for (const p of pares.rows) {
      const r = porId.get(p.regra_id);
      if (!r) continue;
      const res = await executar(r, p);
      if (res?.status === "executada") executadas++;
    }
    return executadas;
  }

  return { listar, criar, atualizar, varrer };
}

