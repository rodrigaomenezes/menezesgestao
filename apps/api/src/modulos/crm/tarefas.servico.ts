// Tarefas (lembretes ligados a contato/oportunidade) e notas do contato.
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Escopo, NotaDto, Pagina, TarefaDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { contato, nota, oportunidade, tarefa, usuario } from "../../infra/esquema.js";
import { invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { validarResponsavel } from "./carteira.js";
import * as contatos from "./contatos.repositorio.js";

const responsavel = alias(usuario, "responsavel");
const autor = alias(usuario, "autor");

const colunasTarefa = {
  id: tarefa.id,
  contatoId: tarefa.contatoId,
  contatoNome: contato.nome,
  oportunidadeId: tarefa.oportunidadeId,
  titulo: tarefa.titulo,
  descricao: tarefa.descricao,
  responsavelId: tarefa.responsavelId,
  responsavelNome: responsavel.nome,
  venceEm: tarefa.venceEm,
  concluidaEm: tarefa.concluidaEm,
  criadoEm: tarefa.criadoEm,
  arquivadoEm: tarefa.arquivadoEm,
};
function consultaTarefas(tx: Tx) {
  return tx.db
    .select(colunasTarefa)
    .from(tarefa)
    .leftJoin(contato, eq(contato.id, tarefa.contatoId))
    .leftJoin(responsavel, eq(responsavel.id, tarefa.responsavelId));
}
type LinhaTarefa = Awaited<ReturnType<ReturnType<typeof consultaTarefas>["execute"]>>[number];
const tarefaDto = (t: LinhaTarefa): TarefaDto => ({
  ...t,
  venceEm: iso(t.venceEm),
  concluidaEm: iso(t.concluidaEm),
  criadoEm: iso(t.criadoEm),
  arquivadoEm: iso(t.arquivadoEm),
});

/** Cursor das tarefas abertas, ordenadas por vencimento (sem vencimento por último). */
function cursorVencimento(cursor: string | undefined) {
  if (!cursor) return sql`true`;
  let v: string | null;
  let id: string;
  try {
    [v, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string | null, string];
  } catch {
    throw invalido("O marcador de página é inválido. Volte ao início da lista.");
  }
  return v === null
    ? sql`(${tarefa.venceEm} IS NULL AND ${tarefa.id} > ${id}::uuid)`
    : sql`(${tarefa.venceEm} > ${v}::timestamptz OR (${tarefa.venceEm} = ${v}::timestamptz AND ${tarefa.id} > ${id}::uuid) OR ${tarefa.venceEm} IS NULL)`;
}

export function criarServicoTarefas(s: Servicos) {
  const { banco } = s;

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const [t] = await consultaTarefas(tx).where(
      and(eq(tarefa.id, id), eq(tarefa.empresaId, ctx.empresaId), filtroUsuariosVisiveis(ctx, escopo, tarefa.responsavelId)),
    );
    if (!t) throw naoEncontrado("Tarefa");
    return t;
  }

  /** Contato (e oportunidade) a que a tarefa se liga precisam estar na carteira de quem cria. */
  async function vinculoDaTarefa(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, contatoId?: string | null, oportunidadeId?: string | null) {
    let contatoFinal = contatoId ?? null;
    if (oportunidadeId) {
      const [o] = await tx.db
        .select({ id: oportunidade.id, contatoId: oportunidade.contatoId })
        .from(oportunidade)
        .where(and(eq(oportunidade.id, oportunidadeId), eq(oportunidade.empresaId, ctx.empresaId), filtroUsuariosVisiveis(ctx, escopo, oportunidade.responsavelId)));
      if (!o) throw invalido("Oportunidade não encontrada na sua carteira.");
      if (contatoFinal && contatoFinal !== o.contatoId) throw invalido("A oportunidade é de outro contato.");
      contatoFinal = o.contatoId;
    }
    if (contatoFinal && !(await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopo, contatoFinal))) {
      throw invalido("Contato não encontrado na sua carteira.");
    }
    return contatoFinal;
  }

  async function listar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { situacao: "abertas" | "concluidas"; responsavelId?: string; contatoId?: string; oportunidadeId?: string; cursor?: string; limite: number },
  ): Promise<Pagina<TarefaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const base = and(
        eq(tarefa.empresaId, ctx.empresaId),
        isNull(tarefa.arquivadoEm),
        filtroUsuariosVisiveis(ctx, escopo, tarefa.responsavelId),
        f.responsavelId ? eq(tarefa.responsavelId, f.responsavelId) : undefined,
        f.contatoId ? eq(tarefa.contatoId, f.contatoId) : undefined,
        f.oportunidadeId ? eq(tarefa.oportunidadeId, f.oportunidadeId) : undefined,
      );
      if (f.situacao === "concluidas") {
        const linhas = await consultaTarefas(tx)
          .where(and(base, isNotNull(tarefa.concluidaEm), condicaoCursor(tarefa.criadoEm, tarefa.id, lerCursor(f.cursor))))
          .orderBy(desc(tarefa.criadoEm), desc(tarefa.id))
          .limit(f.limite + 1);
        return montarPagina(linhas, f.limite, tarefaDto);
      }
      const linhas = await consultaTarefas(tx)
        .where(and(base, isNull(tarefa.concluidaEm), cursorVencimento(f.cursor)))
        .orderBy(sql`${tarefa.venceEm} IS NULL`, asc(tarefa.venceEm), asc(tarefa.id))
        .limit(f.limite + 1);
      const temMais = linhas.length > f.limite;
      const itens = linhas.slice(0, f.limite);
      const ultimo = itens[itens.length - 1];
      return {
        itens: itens.map(tarefaDto),
        proximoCursor: temMais && ultimo ? Buffer.from(JSON.stringify([iso(ultimo.venceEm), ultimo.id])).toString("base64url") : null,
      };
    });
  }

  async function criar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    dados: { contatoId?: string | null; oportunidadeId?: string | null; titulo: string; descricao?: string | null; responsavelId?: string | null; venceEm?: string | null },
  ): Promise<TarefaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const contatoId = await vinculoDaTarefa(tx, ctx, escopo, dados.contatoId, dados.oportunidadeId);
      const responsavelId = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      const [{ id }] = await tx.db
        .insert(tarefa)
        .values({
          empresaId: ctx.empresaId,
          contatoId,
          oportunidadeId: dados.oportunidadeId ?? null,
          titulo: dados.titulo,
          descricao: dados.descricao ?? null,
          responsavelId,
          venceEm: dados.venceEm ? new Date(dados.venceEm) : null,
          criadoPor: ctx.usuarioId,
        })
        .returning({ id: tarefa.id });
      await registrar(tx, origem, {
        acao: "tarefa.criada",
        entidade: "tarefa",
        entidadeId: id,
        contatoId,
        responsavelId,
        depois: { titulo: dados.titulo, venceEm: dados.venceEm ?? null },
        dados: { titulo: dados.titulo, venceEm: dados.venceEm ?? null },
      });
      return tarefaDto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function atualizar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    dados: { titulo?: string; descricao?: string | null; responsavelId?: string | null; venceEm?: string | null; concluida?: boolean },
  ): Promise<TarefaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      const mudancas: Partial<typeof tarefa.$inferInsert> = {};
      if (dados.titulo !== undefined) mudancas.titulo = dados.titulo;
      if (dados.descricao !== undefined) mudancas.descricao = dados.descricao;
      if (dados.venceEm !== undefined) mudancas.venceEm = dados.venceEm ? new Date(dados.venceEm) : null;
      if (dados.responsavelId !== undefined && dados.responsavelId !== antes.responsavelId) {
        mudancas.responsavelId = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      }
      if (dados.concluida !== undefined) mudancas.concluidaEm = dados.concluida ? (antes.concluidaEm ?? new Date()) : null;
      await tx.db.update(tarefa).set({ ...mudancas, atualizadoEm: new Date() }).where(and(eq(tarefa.id, id), eq(tarefa.empresaId, ctx.empresaId)));
      const concluiuAgora = dados.concluida === true && !antes.concluidaEm;
      await registrar(tx, origem, {
        acao: concluiuAgora ? "tarefa.concluida" : dados.concluida === false && antes.concluidaEm ? "tarefa.reaberta" : "tarefa.atualizada",
        entidade: "tarefa",
        entidadeId: id,
        contatoId: antes.contatoId,
        responsavelId: mudancas.responsavelId ?? antes.responsavelId,
        antes: { titulo: antes.titulo, venceEm: antes.venceEm, responsavelId: antes.responsavelId, concluidaEm: antes.concluidaEm },
        depois: mudancas,
        dados: { titulo: mudancas.titulo ?? antes.titulo },
      });
      return tarefaDto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function alternarArquivo(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, arquivar: boolean) {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const t = await carregar(tx, ctx, escopo, id);
      await tx.db.update(tarefa).set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() }).where(and(eq(tarefa.id, id), eq(tarefa.empresaId, ctx.empresaId)));
      await registrar(tx, origem, {
        acao: arquivar ? "tarefa.arquivada" : "tarefa.restaurada",
        entidade: "tarefa",
        entidadeId: id,
        contatoId: t.contatoId,
        responsavelId: t.responsavelId,
        dados: { titulo: t.titulo },
      });
    });
  }

  // Notas -----------------------------------------------------------------------------------------

  const colunasNota = {
    id: nota.id,
    contatoId: nota.contatoId,
    oportunidadeId: nota.oportunidadeId,
    texto: nota.texto,
    autorId: nota.autorId,
    autorNome: autor.nome,
    criadoEm: nota.criadoEm,
    atualizadoEm: nota.atualizadoEm,
  };
  const notaDto = (n: { criadoEm: Date; atualizadoEm: Date } & Omit<NotaDto, "criadoEm" | "atualizadoEm">): NotaDto => ({
    ...n,
    criadoEm: iso(n.criadoEm),
    atualizadoEm: iso(n.atualizadoEm),
  });

  async function listarNotas(ctx: ContextoEmpresa, escopo: Escopo, contatoId: string, cursor: string | undefined, limite: number): Promise<Pagina<NotaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      if (!(await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopo, contatoId))) throw naoEncontrado("Contato");
      const linhas = await tx.db
        .select(colunasNota)
        .from(nota)
        .leftJoin(autor, eq(autor.id, nota.autorId))
        .where(and(eq(nota.empresaId, ctx.empresaId), eq(nota.contatoId, contatoId), isNull(nota.arquivadoEm), condicaoCursor(nota.criadoEm, nota.id, lerCursor(cursor))))
        .orderBy(desc(nota.criadoEm), desc(nota.id))
        .limit(limite + 1);
      return montarPagina(linhas, limite, notaDto);
    });
  }

  async function criarNota(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string, dados: { texto: string; oportunidadeId?: string | null }): Promise<NotaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopo, contatoId);
      if (!c) throw naoEncontrado("Contato");
      if (dados.oportunidadeId) {
        const [o] = await tx.db
          .select({ id: oportunidade.id })
          .from(oportunidade)
          .where(and(eq(oportunidade.id, dados.oportunidadeId), eq(oportunidade.contatoId, contatoId)));
        if (!o) throw invalido("A oportunidade não é deste contato.");
      }
      const [{ id }] = await tx.db
        .insert(nota)
        .values({ empresaId: ctx.empresaId, contatoId, oportunidadeId: dados.oportunidadeId ?? null, texto: dados.texto, autorId: ctx.usuarioId })
        .returning({ id: nota.id });
      await registrar(tx, origem, {
        acao: "nota.criada",
        entidade: "nota",
        entidadeId: id,
        contatoId,
        responsavelId: c.responsavelId,
        depois: { texto: dados.texto },
        dados: { trecho: dados.texto.slice(0, 140) },
      });
      const [n] = await tx.db.select(colunasNota).from(nota).leftJoin(autor, eq(autor.id, nota.autorId)).where(eq(nota.id, id));
      return notaDto(n);
    });
  }

  /** Só quem escreveu (ou quem administra o CRM) corrige ou arquiva a nota; o texto anterior fica na auditoria. */
  async function alterarNota(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, dados: { texto?: string; arquivar?: boolean }): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [n] = await tx.db.select().from(nota).where(and(eq(nota.id, id), eq(nota.empresaId, ctx.empresaId)));
      if (!n || !(await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopo, n.contatoId))) throw naoEncontrado("Nota");
      if (n.autorId !== ctx.usuarioId && !ctx.permissoes.crm?.administrar) throw semPermissao();
      await tx.db
        .update(nota)
        .set({
          ...(dados.texto ? { texto: dados.texto } : {}),
          ...(dados.arquivar !== undefined ? { arquivadoEm: dados.arquivar ? new Date() : null } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(nota.id, id));
      await registrar(tx, origem, {
        acao: dados.arquivar ? "nota.arquivada" : "nota.atualizada",
        entidade: "nota",
        entidadeId: id,
        contatoId: n.contatoId,
        antes: { texto: n.texto },
        depois: { texto: dados.texto ?? n.texto },
      });
    });
  }

  return { listar, criar, atualizar, alternarArquivo, listarNotas, criarNota, alterarNota };
}
