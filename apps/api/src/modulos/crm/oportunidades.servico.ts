// Oportunidades no funil: criar, editar, mover de etapa (com campos obrigatórios e motivo de perda),
// arquivar e o quadro kanban. Mover de etapa publica oportunidade.etapa_alterada (e ganha/perdida).
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Escopo, KanbanDto, OportunidadeDto, Pagina } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { contato, etapa, funil, motivoPerda, oportunidade, usuario } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis, type QuemVe } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { validarCampos, type DefinicaoCampo } from "./campos.js";
import { validarResponsavel } from "./carteira.js";
import { buscarEtapa, definicoesDeCampos, etapaDto } from "./configuracao.servico.js";
import * as contatos from "./contatos.repositorio.js";

const responsavel = alias(usuario, "responsavel");

const colunas = {
  id: oportunidade.id,
  contatoId: oportunidade.contatoId,
  contatoNome: contato.nome,
  funilId: oportunidade.funilId,
  etapaId: oportunidade.etapaId,
  titulo: oportunidade.titulo,
  valorCentavos: oportunidade.valorCentavos,
  oferta: oportunidade.oferta,
  responsavelId: oportunidade.responsavelId,
  responsavelNome: responsavel.nome,
  status: oportunidade.status,
  motivoPerdaId: oportunidade.motivoPerdaId,
  fechadaEm: oportunidade.fechadaEm,
  campos: oportunidade.campos,
  criadoEm: oportunidade.criadoEm,
  atualizadoEm: oportunidade.atualizadoEm,
  arquivadoEm: oportunidade.arquivadoEm,
};

function consulta(tx: Tx) {
  return tx.db
    .select(colunas)
    .from(oportunidade)
    .innerJoin(contato, eq(contato.id, oportunidade.contatoId))
    .leftJoin(responsavel, eq(responsavel.id, oportunidade.responsavelId));
}
type Linha = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];

const dto = (o: Linha): OportunidadeDto => ({
  ...o,
  campos: o.campos ?? {},
  fechadaEm: iso(o.fechadaEm),
  criadoEm: iso(o.criadoEm),
  atualizadoEm: iso(o.atualizadoEm),
  arquivadoEm: iso(o.arquivadoEm),
});

const visivel = (quem: QuemVe, escopo: Escopo) => filtroUsuariosVisiveis(quem, escopo, oportunidade.responsavelId);

/** O que falta preencher para entrar na etapa (uma regra, um lugar). */
export function camposFaltando(
  exigidos: string[],
  o: { valorCentavos: number | null; oferta: string | null; campos: Record<string, unknown> },
  definicoes: DefinicaoCampo[],
): string[] {
  const rotulo = (chave: string) => definicoes.find((d) => d.chave === chave)?.rotulo ?? chave;
  return exigidos
    .filter((chave) => {
      if (chave === "valor") return o.valorCentavos === null || o.valorCentavos === undefined;
      if (chave === "oferta") return !o.oferta;
      const v = o.campos[chave];
      return v === undefined || v === null || v === "";
    })
    .map((chave) => (chave === "valor" ? "Valor" : chave === "oferta" ? "Oferta" : rotulo(chave)));
}

export function criarServicoOportunidades(s: Servicos) {
  const { banco } = s;

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const [o] = await consulta(tx).where(and(eq(oportunidade.id, id), eq(oportunidade.empresaId, ctx.empresaId), visivel(ctx, escopo)));
    if (!o) throw naoEncontrado("Oportunidade");
    return o;
  }

  async function exigirCompleta(tx: Tx, empresaId: string, etapaExigida: { camposObrigatorios: string[]; nome: string }, o: Parameters<typeof camposFaltando>[1]) {
    const faltando = camposFaltando(etapaExigida.camposObrigatorios, o, await definicoesDeCampos(tx, empresaId, "oportunidade"));
    if (faltando.length) {
      throw invalido(`Para entrar em "${etapaExigida.nome}", preencha: ${faltando.join(", ")}.`, { faltando });
    }
  }

  async function listar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { arquivados: "sim" | "nao"; busca?: string; funilId?: string; etapaId?: string; contatoId?: string; responsavelId?: string; status?: "aberta" | "ganha" | "perdida"; cursor?: string; limite: number },
  ): Promise<Pagina<OportunidadeDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await consulta(tx)
        .where(
          and(
            eq(oportunidade.empresaId, ctx.empresaId),
            visivel(ctx, escopo),
            f.arquivados === "sim" ? isNotNull(oportunidade.arquivadoEm) : isNull(oportunidade.arquivadoEm),
            f.busca ? ilike(oportunidade.titulo, `%${f.busca}%`) : undefined,
            f.funilId ? eq(oportunidade.funilId, f.funilId) : undefined,
            f.etapaId ? eq(oportunidade.etapaId, f.etapaId) : undefined,
            f.contatoId ? eq(oportunidade.contatoId, f.contatoId) : undefined,
            f.responsavelId ? eq(oportunidade.responsavelId, f.responsavelId) : undefined,
            f.status ? eq(oportunidade.status, f.status) : undefined,
            condicaoCursor(oportunidade.criadoEm, oportunidade.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(oportunidade.criadoEm), desc(oportunidade.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, dto);
    });
  }

  async function obter(ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => dto(await carregar(tx, ctx, escopo, id)));
  }

  async function criar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    dados: { contatoId: string; funilId: string; etapaId?: string | null; titulo: string; valorCentavos?: number | null; oferta?: string | null; responsavelId?: string | null; campos?: Record<string, unknown> },
  ): Promise<OportunidadeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopo, dados.contatoId);
      if (!c || c.arquivadoEm) throw invalido("Escolha um contato ativo da sua carteira.");
      const [f] = await tx.db.select().from(funil).where(and(eq(funil.id, dados.funilId), eq(funil.empresaId, ctx.empresaId), isNull(funil.arquivadoEm)));
      if (!f) throw invalido("Escolha um funil ativo.");
      const [inicial] = dados.etapaId
        ? await tx.db.select().from(etapa).where(and(eq(etapa.id, dados.etapaId), eq(etapa.funilId, f.id), isNull(etapa.arquivadoEm)))
        : await tx.db.select().from(etapa).where(and(eq(etapa.funilId, f.id), eq(etapa.tipo, "aberta"), isNull(etapa.arquivadoEm))).orderBy(asc(etapa.ordem)).limit(1);
      if (!inicial) throw invalido("O funil não tem etapa ativa para começar. Configure as etapas.");
      if (inicial.tipo !== "aberta") throw invalido("Uma oportunidade nova começa numa etapa em andamento.");
      const responsavelId = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      const campos = validarCampos(await definicoesDeCampos(tx, ctx.empresaId, "oportunidade"), dados.campos ?? {}, { exigirObrigatorios: true });
      await exigirCompleta(tx, ctx.empresaId, inicial, { valorCentavos: dados.valorCentavos ?? null, oferta: dados.oferta ?? null, campos });
      const [{ id }] = await tx.db
        .insert(oportunidade)
        .values({
          empresaId: ctx.empresaId,
          contatoId: c.id,
          funilId: f.id,
          etapaId: inicial.id,
          titulo: dados.titulo,
          valorCentavos: dados.valorCentavos ?? null,
          oferta: dados.oferta ?? null,
          responsavelId,
          campos,
          criadoPor: ctx.usuarioId,
        })
        .returning({ id: oportunidade.id });
      const criada = await carregar(tx, ctx, "empresa", id);
      await registrar(tx, origem, {
        acao: "oportunidade.criada",
        entidade: "oportunidade",
        entidadeId: id,
        contatoId: c.id,
        responsavelId,
        depois: { titulo: dados.titulo, funil: f.nome, etapa: inicial.nome, valorCentavos: dados.valorCentavos ?? null },
        dados: { titulo: dados.titulo, etapa: inicial.nome, valorCentavos: dados.valorCentavos ?? null },
      });
      return dto(criada);
    });
  }

  async function atualizar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    dados: { titulo?: string; valorCentavos?: number | null; oferta?: string | null; responsavelId?: string | null; campos?: Record<string, unknown> },
  ): Promise<OportunidadeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      const mudancas: Partial<typeof oportunidade.$inferInsert> = {};
      if (dados.titulo !== undefined) mudancas.titulo = dados.titulo;
      if (dados.valorCentavos !== undefined) mudancas.valorCentavos = dados.valorCentavos;
      if (dados.oferta !== undefined) mudancas.oferta = dados.oferta;
      if (dados.responsavelId !== undefined && dados.responsavelId !== antes.responsavelId) {
        mudancas.responsavelId = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      }
      if (dados.campos !== undefined) {
        mudancas.campos = validarCampos(await definicoesDeCampos(tx, ctx.empresaId, "oportunidade"), dados.campos, {
          exigirObrigatorios: true,
          atuais: antes.campos,
        });
      }
      // Quem está numa etapa com campos obrigatórios não pode esvaziá-los.
      const etapaAtual = await buscarEtapa(tx, ctx.empresaId, antes.etapaId);
      if (etapaAtual) {
        await exigirCompleta(tx, ctx.empresaId, etapaAtual, {
          valorCentavos: mudancas.valorCentavos !== undefined ? (mudancas.valorCentavos ?? null) : antes.valorCentavos,
          oferta: mudancas.oferta !== undefined ? (mudancas.oferta ?? null) : antes.oferta,
          campos: (mudancas.campos as Record<string, unknown>) ?? antes.campos,
        });
      }
      await tx.db.update(oportunidade).set({ ...mudancas, atualizadoEm: new Date() }).where(and(eq(oportunidade.id, id), eq(oportunidade.empresaId, ctx.empresaId)));
      const depois = await carregar(tx, ctx, "empresa", id);
      await registrar(tx, origem, {
        acao: "oportunidade.atualizada",
        entidade: "oportunidade",
        entidadeId: id,
        contatoId: antes.contatoId,
        responsavelId: depois.responsavelId,
        antes: { titulo: antes.titulo, valorCentavos: antes.valorCentavos, oferta: antes.oferta, responsavelId: antes.responsavelId, campos: antes.campos },
        depois: { titulo: depois.titulo, valorCentavos: depois.valorCentavos, oferta: depois.oferta, responsavelId: depois.responsavelId, campos: depois.campos },
      });
      return dto(depois);
    });
  }

  async function moverEtapa(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    dados: { etapaId: string; motivoPerdaId?: string | null },
  ): Promise<OportunidadeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const o = await carregar(tx, ctx, escopo, id);
      if (o.arquivadoEm) throw invalido("Restaure a oportunidade antes de mudá-la de etapa.");
      if (o.etapaId === dados.etapaId) return dto(o);
      const anterior = await buscarEtapa(tx, ctx.empresaId, o.etapaId);
      const nova = await buscarEtapa(tx, ctx.empresaId, dados.etapaId);
      if (!nova || nova.funilId !== o.funilId || nova.arquivadoEm) throw invalido("Escolha uma etapa ativa do mesmo funil.");
      await exigirCompleta(tx, ctx.empresaId, nova, o);

      let motivoPerdaId: string | null = null;
      let motivoNome: string | null = null;
      if (nova.tipo === "perdida") {
        if (!dados.motivoPerdaId) throw invalido("Diga o motivo da perda.", { faltando: ["Motivo da perda"] });
        const [m] = await tx.db
          .select()
          .from(motivoPerda)
          .where(and(eq(motivoPerda.id, dados.motivoPerdaId), eq(motivoPerda.empresaId, ctx.empresaId), isNull(motivoPerda.arquivadoEm)));
        if (!m) throw invalido("Escolha um motivo de perda válido.");
        motivoPerdaId = m.id;
        motivoNome = m.nome;
      }
      await tx.db
        .update(oportunidade)
        .set({
          etapaId: nova.id,
          status: nova.tipo,
          motivoPerdaId,
          fechadaEm: nova.tipo === "aberta" ? null : new Date(),
          atualizadoEm: new Date(),
        })
        .where(and(eq(oportunidade.id, id), eq(oportunidade.empresaId, ctx.empresaId)));

      const resumo = { titulo: o.titulo, etapaAnterior: anterior?.nome ?? null, etapaNova: nova.nome, valorCentavos: o.valorCentavos };
      await registrar(tx, origem, {
        acao: "oportunidade.etapa_alterada",
        entidade: "oportunidade",
        entidadeId: id,
        contatoId: o.contatoId,
        responsavelId: o.responsavelId,
        antes: { etapaId: o.etapaId, status: o.status },
        depois: { etapaId: nova.id, status: nova.tipo, motivoPerdaId },
        dados: { ...resumo, oportunidadeId: id, etapaAnteriorId: o.etapaId, etapaNovaId: nova.id },
      });
      if (nova.tipo !== "aberta" && o.status === "aberta") {
        await registrar(tx, origem, {
          acao: nova.tipo === "ganha" ? "oportunidade.ganha" : "oportunidade.perdida",
          entidade: "oportunidade",
          entidadeId: id,
          contatoId: o.contatoId,
          responsavelId: o.responsavelId,
          dados: { ...resumo, motivo: motivoNome },
        });
      }
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function alternarArquivo(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, arquivar: boolean) {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const o = await carregar(tx, ctx, escopo, id);
      await tx.db
        .update(oportunidade)
        .set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() })
        .where(and(eq(oportunidade.id, id), eq(oportunidade.empresaId, ctx.empresaId)));
      await registrar(tx, origem, {
        acao: arquivar ? "oportunidade.arquivada" : "oportunidade.restaurada",
        entidade: "oportunidade",
        entidadeId: id,
        contatoId: o.contatoId,
        responsavelId: o.responsavelId,
        dados: { titulo: o.titulo },
      });
    });
  }

  /** Quadro do funil: até 50 cartões por etapa (os mais recentes), com total e soma de valores. */
  async function kanban(ctx: ContextoEmpresa, escopo: Escopo, funilId: string, f: { responsavelId?: string; busca?: string }): Promise<KanbanDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [fn] = await tx.db.select().from(funil).where(and(eq(funil.id, funilId), eq(funil.empresaId, ctx.empresaId)));
      if (!fn) throw naoEncontrado("Funil");
      const etapas = await tx.db.select().from(etapa).where(and(eq(etapa.funilId, funilId), isNull(etapa.arquivadoEm))).orderBy(asc(etapa.ordem));
      const condicao = and(
        eq(oportunidade.empresaId, ctx.empresaId),
        eq(oportunidade.funilId, funilId),
        isNull(oportunidade.arquivadoEm),
        visivel(ctx, escopo),
        f.responsavelId ? eq(oportunidade.responsavelId, f.responsavelId) : undefined,
        f.busca ? sql`(${oportunidade.titulo} ILIKE ${`%${f.busca}%`} OR ${contato.nome} ILIKE ${`%${f.busca}%`})` : undefined,
      );
      const totais = await tx.db
        .select({ etapaId: oportunidade.etapaId, total: count(), valor: sum(oportunidade.valorCentavos) })
        .from(oportunidade)
        .innerJoin(contato, eq(contato.id, oportunidade.contatoId))
        .where(condicao)
        .groupBy(oportunidade.etapaId);
      // Os 50 mais recentes de cada etapa: primeiro os ids (janela por etapa), depois os cartões completos.
      const posicao = sql<number>`row_number() OVER (PARTITION BY ${oportunidade.etapaId} ORDER BY ${oportunidade.atualizadoEm} DESC, ${oportunidade.id} DESC)`;
      const ranqueados = tx.db
        .select({ id: oportunidade.id, posicao: posicao.as("posicao") })
        .from(oportunidade)
        .innerJoin(contato, eq(contato.id, oportunidade.contatoId))
        .where(condicao)
        .as("ranqueados");
      const ids = (await tx.db.select({ id: ranqueados.id }).from(ranqueados).where(sql`${ranqueados.posicao} <= 50`)).map((r) => r.id);
      const cartoes = ids.length ? await consulta(tx).where(inArray(oportunidade.id, ids)) : [];
      return {
        funil: { id: fn.id, nome: fn.nome, ordem: fn.ordem, arquivadoEm: iso(fn.arquivadoEm), etapas: etapas.map(etapaDto) },
        colunas: etapas.map((e) => {
          const t = totais.find((x) => x.etapaId === e.id);
          return {
            etapaId: e.id,
            total: t?.total ?? 0,
            valorCentavos: Number(t?.valor ?? 0),
            itens: cartoes
              .filter((c) => c.etapaId === e.id)
              .sort((a, b) => b.atualizadoEm.getTime() - a.atualizadoEm.getTime())
              .map(dto),
          };
        }),
      };
    });
  }

  return { listar, obter, criar, atualizar, moverEtapa, alternarArquivo, kanban };
}
