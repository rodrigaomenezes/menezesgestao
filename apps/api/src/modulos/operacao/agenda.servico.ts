// Agenda de compromissos por pessoa, com lembrete pelo sino (job agendado, nunca setInterval).
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { temPermissao, type CompromissoDto, type Escopo, type Pagina } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { compromisso, contato, empresa, usuario } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { iso } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import * as contatos from "../crm/contatos.repositorio.js";
import { notificar } from "../notificacoes/notificar.js";
import { exigirPessoa, fusoDe, instantesDoPeriodo } from "./comum.js";

export const FILA_LEMBRETE = "agenda.lembrete";
const MAX_DIAS = 62;

type Dados = {
  usuarioId?: string | null;
  contatoId?: string | null;
  titulo?: string;
  descricao?: string | null;
  local?: string | null;
  inicio?: string;
  fim?: string;
  lembreteMinutos?: number | null;
  arquivar?: boolean;
};

export function criarServicoAgenda(s: Servicos) {
  const { banco, jobs } = s;

  function consulta(tx: Tx) {
    return tx.db
      .select({
        id: compromisso.id,
        usuarioId: compromisso.usuarioId,
        usuarioNome: usuario.nome,
        contatoId: compromisso.contatoId,
        contatoNome: contato.nome,
        titulo: compromisso.titulo,
        descricao: compromisso.descricao,
        local: compromisso.local,
        inicio: compromisso.inicio,
        fim: compromisso.fim,
        lembreteMinutos: compromisso.lembreteMinutos,
        arquivadoEm: compromisso.arquivadoEm,
      })
      .from(compromisso)
      .leftJoin(usuario, eq(usuario.id, compromisso.usuarioId))
      .leftJoin(contato, eq(contato.id, compromisso.contatoId));
  }
  type Linha = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];
  const dto = (l: Linha): CompromissoDto => ({ ...l, inicio: iso(l.inicio), fim: iso(l.fim), arquivadoEm: iso(l.arquivadoEm) });

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const [l] = await consulta(tx).where(and(eq(compromisso.id, id), eq(compromisso.empresaId, ctx.empresaId), filtroUsuariosVisiveis(ctx, escopo, compromisso.usuarioId)));
    if (!l) throw naoEncontrado("Compromisso");
    return l;
  }

  /** Ligar a um contato exige enxergá-lo no CRM. */
  async function validarContato(tx: Tx, ctx: ContextoEmpresa, contatoId: string | null | undefined): Promise<string | null> {
    if (!contatoId) return null;
    const escopoCrm = temPermissao(ctx.permissoes, "crm", "ver");
    if (!escopoCrm || !(await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopoCrm, contatoId))) {
      throw invalido("Contato não encontrado na sua carteira.");
    }
    return contatoId;
  }

  async function agendarLembrete(tx: Tx, c: { id: string; empresaId: string; inicio: Date; lembreteMinutos: number | null }) {
    if (c.lembreteMinutos === null) return;
    const quando = c.inicio.getTime() - c.lembreteMinutos * 60_000;
    const aposSegundos = Math.max(1, Math.round((quando - Date.now()) / 1000));
    if (c.inicio.getTime() <= Date.now()) return;
    await jobs.enfileirar(
      tx,
      FILA_LEMBRETE,
      { empresaId: c.empresaId, compromissoId: c.id, inicio: c.inicio.toISOString(), lembreteMinutos: c.lembreteMinutos },
      { aposSegundos, chaveUnica: `${c.id}:${c.inicio.toISOString()}:${c.lembreteMinutos}` },
    );
  }

  async function listar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { de: string; ate: string; usuarioId?: string; cursor?: string; limite: number },
  ): Promise<Pagina<CompromissoDto>> {
    if (f.ate < f.de) throw invalido("A data final precisa ser depois da inicial.");
    if ((Date.parse(f.ate) - Date.parse(f.de)) / 86_400_000 > MAX_DIAS) throw invalido(`Consulte no máximo ${MAX_DIAS} dias por vez.`);
    let cursor: [string, string] | null = null;
    if (f.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(f.cursor, "base64url").toString("utf8")) as [string, string];
      } catch {
        throw invalido("O marcador de página é inválido. Volte ao início da lista.");
      }
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { de, ate } = instantesDoPeriodo(f.de, f.ate, fusoDe(ctx));
      const linhas = await consulta(tx)
        .where(
          and(
            eq(compromisso.empresaId, ctx.empresaId),
            isNull(compromisso.arquivadoEm),
            filtroUsuariosVisiveis(ctx, escopo, compromisso.usuarioId),
            eq(compromisso.usuarioId, f.usuarioId ?? ctx.usuarioId),
            sql`${compromisso.inicio} < ${ate} AND ${compromisso.fim} > ${de}`,
            cursor ? sql`(${compromisso.inicio}, ${compromisso.id}) > (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)` : undefined,
          ),
        )
        .orderBy(asc(compromisso.inicio), asc(compromisso.id))
        .limit(f.limite + 1);
      const temMais = linhas.length > f.limite;
      const itens = linhas.slice(0, f.limite);
      const ultimo = itens[itens.length - 1];
      return {
        itens: itens.map(dto),
        proximoCursor: temMais && ultimo ? Buffer.from(JSON.stringify([ultimo.inicio.toISOString(), ultimo.id])).toString("base64url") : null,
      };
    });
  }

  /** Compromissos de hoje da pessoa (para a rotina). */
  async function doDia(tx: Tx, ctx: ContextoEmpresa, dia: string): Promise<CompromissoDto[]> {
    const { de, ate } = instantesDoPeriodo(dia, dia, fusoDe(ctx));
    const linhas = await consulta(tx)
      .where(
        and(
          eq(compromisso.empresaId, ctx.empresaId),
          isNull(compromisso.arquivadoEm),
          eq(compromisso.usuarioId, ctx.usuarioId),
          sql`${compromisso.inicio} < ${ate} AND ${compromisso.fim} > ${de}`,
        ),
      )
      .orderBy(asc(compromisso.inicio))
      .limit(30);
    return linhas.map(dto);
  }

  async function criar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, d: Dados & { titulo: string; inicio: string; fim: string }): Promise<CompromissoDto> {
    const inicio = new Date(d.inicio);
    const fim = new Date(d.fim);
    if (fim <= inicio) throw invalido("O fim precisa ser depois do início.");
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const usuarioId = await exigirPessoa(tx, ctx, escopo, d.usuarioId);
      const contatoId = await validarContato(tx, ctx, d.contatoId);
      const [c] = await tx.db
        .insert(compromisso)
        .values({
          empresaId: ctx.empresaId,
          usuarioId,
          contatoId,
          titulo: d.titulo,
          descricao: d.descricao ?? null,
          local: d.local ?? null,
          inicio,
          fim,
          lembreteMinutos: d.lembreteMinutos ?? null,
          criadoPor: ctx.usuarioId,
        })
        .returning();
      await registrar(tx, origem, {
        acao: "compromisso.criado",
        entidade: "compromisso",
        entidadeId: c.id,
        contatoId,
        responsavelId: usuarioId,
        depois: { titulo: d.titulo, inicio: d.inicio, fim: d.fim },
        dados: { titulo: d.titulo, inicio: d.inicio },
      });
      await agendarLembrete(tx, c);
      return dto(await carregar(tx, ctx, "empresa", c.id));
    });
  }

  async function atualizar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, d: Dados): Promise<CompromissoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      const inicio = d.inicio ? new Date(d.inicio) : antes.inicio;
      const fim = d.fim ? new Date(d.fim) : antes.fim;
      if (fim <= inicio) throw invalido("O fim precisa ser depois do início.");
      const mudancas: Partial<typeof compromisso.$inferInsert> = { inicio, fim, atualizadoEm: new Date() };
      if (d.titulo !== undefined) mudancas.titulo = d.titulo;
      if (d.descricao !== undefined) mudancas.descricao = d.descricao;
      if (d.local !== undefined) mudancas.local = d.local;
      if (d.lembreteMinutos !== undefined) mudancas.lembreteMinutos = d.lembreteMinutos;
      if (d.usuarioId !== undefined && d.usuarioId !== antes.usuarioId) mudancas.usuarioId = await exigirPessoa(tx, ctx, escopo, d.usuarioId);
      if (d.contatoId !== undefined && d.contatoId !== antes.contatoId) mudancas.contatoId = await validarContato(tx, ctx, d.contatoId);
      if (d.arquivar !== undefined) mudancas.arquivadoEm = d.arquivar ? new Date() : null;
      const [c] = await tx.db.update(compromisso).set(mudancas).where(eq(compromisso.id, id)).returning();
      await registrar(tx, origem, {
        acao: d.arquivar === true ? "compromisso.arquivado" : d.arquivar === false ? "compromisso.restaurado" : "compromisso.atualizado",
        entidade: "compromisso",
        entidadeId: id,
        contatoId: c.contatoId,
        responsavelId: c.usuarioId,
        antes: { titulo: antes.titulo, inicio: antes.inicio, fim: antes.fim, usuarioId: antes.usuarioId },
        depois: d,
        dados: { titulo: c.titulo, inicio: iso(c.inicio) },
      });
      if (!c.arquivadoEm) await agendarLembrete(tx, c);
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  /** Job: avisa no sino se o compromisso continua igual (não foi arquivado nem remarcado). */
  async function lembrar(d: { empresaId: string; compromissoId: string; inicio: string; lembreteMinutos: number }): Promise<void> {
    await comEmpresa(banco, d.empresaId, async (tx) => {
      const [c] = await tx.db.select().from(compromisso).where(and(eq(compromisso.id, d.compromissoId), eq(compromisso.empresaId, d.empresaId)));
      if (!c || c.arquivadoEm || c.inicio.toISOString() !== d.inicio || c.lembreteMinutos !== d.lembreteMinutos) return;
      const [e] = await tx.db.select({ fuso: empresa.fuso }).from(empresa).where(eq(empresa.id, d.empresaId));
      const hora = c.inicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: fusoDe({ fuso: e?.fuso ?? null }) });
      await notificar(
        tx,
        { empresaId: d.empresaId, atorId: null, ip: null, dispositivo: null },
        { usuarioId: c.usuarioId, titulo: `Compromisso às ${hora}: ${c.titulo}`, texto: c.local ?? undefined, link: "/agenda" },
      );
    });
  }

  return { listar, doDia, criar, atualizar, lembrar };
}
