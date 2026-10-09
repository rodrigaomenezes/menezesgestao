// Metas (pessoa, equipe ou empresa) e painel de desempenho. Os números saem só dos eventos (indicadores.ts).
import { and, desc, eq, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DesempenhoDto, Escopo, IndicadorId, MetaDto, Pagina, PeriodoId } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { equipe, meta, usuario, vinculo } from "../../infra/esquema.js";
import { codigoPg, conflito, invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { exigirPessoa, fusoDe, hojeNoFuso, instantesDoPeriodo, limitesPeriodo, pessoasVisiveis } from "./comum.js";
import { calcularIndicadores, zerados } from "./indicadores.js";

type LinhaMeta = typeof meta.$inferSelect & { usuarioNome: string | null; equipeNome: string | null };

/** Metas que o escopo de "ver" alcança. */
function metaVisivel(ctx: ContextoEmpresa, escopo: Escopo): SQL {
  if (escopo === "empresa") return sql`true`;
  const equipes = sql`(${meta.equipeId} = ${ctx.equipeId ?? null}::uuid OR ${meta.equipeId} IN (SELECT id FROM equipe WHERE gestor_id = ${ctx.usuarioId}))`;
  return or(
    eq(meta.alvo, "empresa"),
    and(eq(meta.alvo, "equipe"), escopo === "unidade" ? sql`true` : equipes),
    and(eq(meta.alvo, "pessoa"), filtroUsuariosVisiveis(ctx, escopo, meta.usuarioId)),
  )!;
}

async function membrosDaEquipe(tx: Tx, empresaId: string, equipeId: string): Promise<string[]> {
  const linhas = await tx.db
    .select({ id: vinculo.usuarioId })
    .from(vinculo)
    .where(and(eq(vinculo.empresaId, empresaId), eq(vinculo.equipeId, equipeId), eq(vinculo.status, "ativo"), isNull(vinculo.arquivadoEm)));
  return linhas.map((l) => l.id);
}

export function criarServicoDesempenho(s: Servicos) {
  const { banco } = s;

  function consulta(tx: Tx) {
    return tx.db
      .select({
        id: meta.id,
        empresaId: meta.empresaId,
        alvo: meta.alvo,
        usuarioId: meta.usuarioId,
        equipeId: meta.equipeId,
        indicador: meta.indicador,
        periodo: meta.periodo,
        valor: meta.valor,
        criadoPor: meta.criadoPor,
        criadoEm: meta.criadoEm,
        atualizadoEm: meta.atualizadoEm,
        arquivadoEm: meta.arquivadoEm,
        usuarioNome: usuario.nome,
        equipeNome: equipe.nome,
      })
      .from(meta)
      .leftJoin(usuario, eq(usuario.id, meta.usuarioId))
      .leftJoin(equipe, eq(equipe.id, meta.equipeId));
  }

  /** Calcula o realizado de cada meta no período que contém `dia`. */
  async function comProgresso(tx: Tx, ctx: ContextoEmpresa, linhas: LinhaMeta[], dia: string): Promise<MetaDto[]> {
    const fuso = fusoDe(ctx);
    const cache = new Map<string, Map<string, Record<IndicadorId, number>>>();
    async function valores(periodo: PeriodoId, chave: string, usuarios: string[] | null) {
      const k = `${periodo}:${chave}`;
      if (!cache.has(k)) {
        const { inicio, fim } = limitesPeriodo(periodo, dia);
        const { de, ate } = instantesDoPeriodo(inicio, fim, fuso);
        cache.set(k, await calcularIndicadores(tx, ctx.empresaId, de, ate, usuarios, chave === "pessoas"));
      }
      return cache.get(k)!;
    }
    // Metas de pessoa: uma consulta por período para todas as pessoas da página.
    const pessoasDaPagina = [...new Set(linhas.filter((l) => l.alvo === "pessoa").map((l) => l.usuarioId!))];
    const dtos: MetaDto[] = [];
    for (const l of linhas) {
      const periodo = l.periodo;
      let mapa: Map<string, Record<IndicadorId, number>>;
      let chave = "total";
      if (l.alvo === "pessoa") {
        mapa = await valores(periodo, "pessoas", pessoasDaPagina);
        chave = l.usuarioId!;
      } else if (l.alvo === "equipe") {
        mapa = await valores(periodo, `equipe:${l.equipeId}`, await membrosDaEquipe(tx, ctx.empresaId, l.equipeId!));
      } else {
        mapa = await valores(periodo, "empresa", null);
      }
      const indicador = l.indicador as IndicadorId;
      const realizado = (mapa.get(chave) ?? zerados())[indicador] ?? 0;
      const valor = Number(l.valor);
      const { inicio, fim } = limitesPeriodo(periodo, dia);
      dtos.push({
        id: l.id,
        alvo: l.alvo,
        usuarioId: l.usuarioId,
        equipeId: l.equipeId,
        alvoNome: l.alvo === "pessoa" ? (l.usuarioNome ?? "Pessoa") : l.alvo === "equipe" ? (l.equipeNome ?? "Equipe") : "Empresa toda",
        indicador,
        periodo,
        valor,
        realizado,
        percentual: Math.round((realizado / valor) * 1000) / 10,
        inicioPeriodo: inicio,
        fimPeriodo: fim,
        arquivadoEm: iso(l.arquivadoEm),
      });
    }
    return dtos;
  }

  async function listarMetas(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { data?: string; alvo?: "pessoa" | "equipe" | "empresa"; arquivados: "sim" | "nao"; cursor?: string; limite: number },
  ): Promise<Pagina<MetaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await consulta(tx)
        .where(
          and(
            eq(meta.empresaId, ctx.empresaId),
            f.arquivados === "sim" ? isNotNull(meta.arquivadoEm) : isNull(meta.arquivadoEm),
            metaVisivel(ctx, escopo),
            f.alvo ? eq(meta.alvo, f.alvo) : undefined,
            condicaoCursor(meta.criadoEm, meta.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(meta.criadoEm), desc(meta.id))
        .limit(f.limite + 1);
      const pagina = montarPagina(linhas, f.limite, (l) => l);
      return { itens: await comProgresso(tx, ctx, pagina.itens, f.data ?? hojeNoFuso(fusoDe(ctx))), proximoCursor: pagina.proximoCursor };
    });
  }

  /** Metas da própria pessoa (as dela, as da equipe dela e as da empresa) — usadas na rotina. */
  async function minhasMetas(tx: Tx, ctx: ContextoEmpresa, dia: string): Promise<MetaDto[]> {
    const linhas = await consulta(tx)
      .where(
        and(
          eq(meta.empresaId, ctx.empresaId),
          isNull(meta.arquivadoEm),
          or(
            and(eq(meta.alvo, "pessoa"), eq(meta.usuarioId, ctx.usuarioId)),
            ctx.equipeId ? and(eq(meta.alvo, "equipe"), eq(meta.equipeId, ctx.equipeId)) : undefined,
            eq(meta.alvo, "empresa"),
          ),
        ),
      )
      .orderBy(meta.alvo, meta.indicador)
      .limit(20);
    return comProgresso(tx, ctx, linhas, dia);
  }

  /** Definir metas é gestão: quem só enxerga a si não define a própria meta. */
  async function validarAlvo(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, alvo: "pessoa" | "equipe" | "empresa", usuarioId?: string | null, equipeId?: string | null) {
    if (escopo === "proprio") throw semPermissao();
    if (alvo === "pessoa") {
      if (!usuarioId) throw invalido("Escolha a pessoa da meta.");
      await exigirPessoa(tx, ctx, escopo, usuarioId);
      return { usuarioId, equipeId: null };
    }
    if (alvo === "equipe") {
      if (!equipeId) throw invalido("Escolha a equipe da meta.");
      const [e] = await tx.db
        .select({ id: equipe.id, gestorId: equipe.gestorId })
        .from(equipe)
        .where(and(eq(equipe.id, equipeId), eq(equipe.empresaId, ctx.empresaId), isNull(equipe.arquivadoEm)));
      if (!e) throw invalido("Equipe não encontrada.");
      if (escopo === "equipe" && e.gestorId !== ctx.usuarioId && e.id !== ctx.equipeId) throw semPermissao();
      return { usuarioId: null, equipeId };
    }
    if (escopo !== "empresa") throw semPermissao();
    return { usuarioId: null, equipeId: null };
  }

  async function criarMeta(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    d: { alvo: "pessoa" | "equipe" | "empresa"; usuarioId?: string | null; equipeId?: string | null; indicador: IndicadorId; periodo: PeriodoId; valor: number },
  ): Promise<MetaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const alvo = await validarAlvo(tx, ctx, escopo, d.alvo, d.usuarioId, d.equipeId);
      let id: string;
      try {
        [{ id }] = await tx.db
          .insert(meta)
          .values({ empresaId: ctx.empresaId, alvo: d.alvo, ...alvo, indicador: d.indicador, periodo: d.periodo, valor: String(d.valor), criadoPor: ctx.usuarioId })
          .returning({ id: meta.id });
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Já existe uma meta desse indicador e período para esse alvo. Altere o valor da que existe.");
        throw err;
      }
      await registrar(tx, origem, {
        acao: "meta.criada",
        entidade: "meta",
        entidadeId: id,
        responsavelId: alvo.usuarioId,
        depois: { ...d },
        dados: { indicador: d.indicador, periodo: d.periodo, valor: d.valor },
      });
      const [l] = await consulta(tx).where(eq(meta.id, id));
      return (await comProgresso(tx, ctx, [l], hojeNoFuso(fusoDe(ctx))))[0];
    });
  }

  async function atualizarMeta(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, d: { valor?: number; arquivar?: boolean }): Promise<MetaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [antes] = await consulta(tx).where(and(eq(meta.id, id), eq(meta.empresaId, ctx.empresaId), metaVisivel(ctx, escopo)));
      if (!antes) throw naoEncontrado("Meta");
      await validarAlvo(tx, ctx, escopo, antes.alvo, antes.usuarioId, antes.equipeId);
      const mudancas: Partial<typeof meta.$inferInsert> = { atualizadoEm: new Date() };
      if (d.valor !== undefined) mudancas.valor = String(d.valor);
      if (d.arquivar !== undefined) mudancas.arquivadoEm = d.arquivar ? new Date() : null;
      try {
        await tx.db.update(meta).set(mudancas).where(eq(meta.id, id));
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Já existe outra meta ativa desse indicador e período para esse alvo.");
        throw err;
      }
      await registrar(tx, origem, {
        acao: d.arquivar === true ? "meta.arquivada" : d.arquivar === false ? "meta.restaurada" : "meta.atualizada",
        entidade: "meta",
        entidadeId: id,
        responsavelId: antes.usuarioId,
        antes: { valor: Number(antes.valor) },
        depois: d,
      });
      const [l] = await consulta(tx).where(eq(meta.id, id));
      return (await comProgresso(tx, ctx, [l], hojeNoFuso(fusoDe(ctx))))[0];
    });
  }

  async function painel(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { periodo: PeriodoId; data?: string; equipeId?: string; cursor?: string; limite: number },
  ): Promise<DesempenhoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { inicio, fim } = limitesPeriodo(f.periodo, f.data ?? hojeNoFuso(fusoDe(ctx)));
      const { pessoas, proximoCursor } = await pessoasVisiveis(tx, ctx, escopo, f);
      const { de, ate } = instantesDoPeriodo(inicio, fim, fusoDe(ctx));
      const valores = await calcularIndicadores(tx, ctx.empresaId, de, ate, pessoas.map((p) => p.id), true);
      return {
        inicio,
        fim,
        itens: pessoas.map((p) => ({ usuarioId: p.id, nome: p.nome, valores: valores.get(p.id) ?? zerados() })),
        proximoCursor,
      };
    });
  }

  return { listarMetas, minhasMetas, criarMeta, atualizarMeta, painel };
}
