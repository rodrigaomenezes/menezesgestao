// Catálogo de ofertas e entregas (turma, agenda, projeto…) com capacidade, prestador e participantes.
import { and, desc, eq, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import { temPermissao, type EntregaDto, type Escopo, type OfertaDto, type Pagina, type ParticipanteDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { contato, entrega, entregaParticipante, oferta, usuario } from "../../infra/esquema.js";
import { codigoPg, conflito, invalido, naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import * as contatos from "../crm/contatos.repositorio.js";
import { exigirPessoa } from "../operacao/comum.js";

const ocupadas = sql<number>`(SELECT count(*)::int FROM entrega_participante p WHERE p.entrega_id = ${sql.raw('"entrega"."id"')} AND p.status = 'ativo')`;

/** Ocupa uma vaga (com trava na entrega: duas vendas ao mesmo tempo não passam da capacidade). */
export async function ocuparVaga(tx: Tx, empresaId: string, entregaId: string, contatoId: string, atorId: string, vendaId: string | null): Promise<string> {
  const { rows } = await tx.cliente.query<{ capacidade: number | null; status: string; arquivado_em: Date | null }>(
    "SELECT capacidade, status, arquivado_em FROM entrega WHERE id = $1 AND empresa_id = $2 FOR UPDATE",
    [entregaId, empresaId],
  );
  const e = rows[0];
  if (!e || e.arquivado_em) throw invalido("Entrega não encontrada.");
  if (e.status !== "aberta") throw conflito("Esta entrega está encerrada e não recebe mais participantes.");
  const { rows: c } = await tx.cliente.query<{ n: number }>("SELECT count(*)::int AS n FROM entrega_participante WHERE entrega_id = $1 AND status = 'ativo'", [entregaId]);
  if (e.capacidade !== null && c[0].n >= e.capacidade) throw conflito(`Não há vagas: as ${e.capacidade} vagas já estão ocupadas.`);
  try {
    const [p] = await tx.db
      .insert(entregaParticipante)
      .values({ empresaId, entregaId, contatoId, vendaId, criadoPor: atorId })
      .returning({ id: entregaParticipante.id });
    return p.id;
  } catch (err) {
    if (codigoPg(err) === "23505") throw conflito("Esta pessoa já está nesta entrega.");
    throw err;
  }
}

export function criarServicoOfertas(s: Servicos) {
  const { banco } = s;

  // Ofertas -------------------------------------------------------------------------------------------

  const colunasOferta = { id: oferta.id, nome: oferta.nome, descricao: oferta.descricao, precoCentavos: oferta.precoCentavos, criadoEm: oferta.criadoEm, arquivadoEm: oferta.arquivadoEm };
  const ofertaDto = ({ criadoEm: _c, ...o }: { id: string; nome: string; descricao: string | null; precoCentavos: number | null; criadoEm: Date; arquivadoEm: Date | null }): OfertaDto => ({
    ...o,
    arquivadoEm: iso(o.arquivadoEm),
  });

  async function listarOfertas(ctx: ContextoEmpresa, f: { arquivados: "sim" | "nao"; busca?: string; cursor?: string; limite: number }): Promise<Pagina<OfertaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .select(colunasOferta)
        .from(oferta)
        .where(
          and(
            eq(oferta.empresaId, ctx.empresaId),
            f.arquivados === "sim" ? isNotNull(oferta.arquivadoEm) : isNull(oferta.arquivadoEm),
            f.busca ? ilike(oferta.nome, `%${f.busca}%`) : undefined,
            condicaoCursor(oferta.criadoEm, oferta.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(oferta.criadoEm), desc(oferta.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, ofertaDto);
    });
  }

  async function salvarOferta(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string | null,
    d: { nome?: string; descricao?: string | null; precoCentavos?: number | null; arquivar?: boolean },
  ): Promise<OfertaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      let ofertaId = id;
      try {
        if (!ofertaId) {
          const [n] = await tx.db
            .insert(oferta)
            .values({ empresaId: ctx.empresaId, nome: d.nome!, descricao: d.descricao ?? null, precoCentavos: d.precoCentavos ?? null, criadoPor: ctx.usuarioId })
            .returning({ id: oferta.id });
          ofertaId = n.id;
        } else {
          const [antes] = await tx.db.select({ id: oferta.id }).from(oferta).where(and(eq(oferta.id, ofertaId), eq(oferta.empresaId, ctx.empresaId)));
          if (!antes) throw naoEncontrado("Oferta");
          await tx.db
            .update(oferta)
            .set({
              ...(d.nome !== undefined ? { nome: d.nome } : {}),
              ...(d.descricao !== undefined ? { descricao: d.descricao } : {}),
              ...(d.precoCentavos !== undefined ? { precoCentavos: d.precoCentavos } : {}),
              ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
              atualizadoEm: new Date(),
            })
            .where(eq(oferta.id, ofertaId));
        }
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Já existe uma oferta ativa com esse nome.");
        throw err;
      }
      await registrar(tx, origem, {
        acao: !id ? "oferta.criada" : d.arquivar === true ? "oferta.arquivada" : d.arquivar === false ? "oferta.restaurada" : "oferta.atualizada",
        entidade: "oferta",
        entidadeId: ofertaId,
        depois: d,
      });
      const [l] = await tx.db.select(colunasOferta).from(oferta).where(eq(oferta.id, ofertaId));
      return ofertaDto(l);
    });
  }

  // Entregas ------------------------------------------------------------------------------------------

  function consultaEntregas(tx: Tx) {
    return tx.db
      .select({
        id: entrega.id,
        ofertaId: entrega.ofertaId,
        ofertaNome: oferta.nome,
        nome: entrega.nome,
        prestadorId: entrega.prestadorId,
        prestadorNome: usuario.nome,
        capacidade: entrega.capacidade,
        ocupadas,
        inicio: entrega.inicio,
        fim: entrega.fim,
        horario: entrega.horario,
        status: entrega.status,
        criadoEm: entrega.criadoEm,
        arquivadoEm: entrega.arquivadoEm,
      })
      .from(entrega)
      .leftJoin(oferta, eq(oferta.id, entrega.ofertaId))
      .leftJoin(usuario, eq(usuario.id, entrega.prestadorId));
  }
  type LinhaEntrega = Awaited<ReturnType<ReturnType<typeof consultaEntregas>["execute"]>>[number];
  const entregaDto = ({ criadoEm: _c, ...e }: LinhaEntrega): EntregaDto => ({ ...e, ocupadas: Number(e.ocupadas), arquivadoEm: iso(e.arquivadoEm) });

  /** Prestador com escopo "próprio" vê só as entregas em que trabalha. */
  const entregaVisivel = (ctx: ContextoEmpresa, escopo: Escopo) => (escopo === "empresa" ? sql`true` : filtroUsuariosVisiveis(ctx, escopo, entrega.prestadorId));

  async function carregarEntrega(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const [e] = await consultaEntregas(tx).where(and(eq(entrega.id, id), eq(entrega.empresaId, ctx.empresaId), entregaVisivel(ctx, escopo)));
    if (!e) throw naoEncontrado("Entrega");
    return e;
  }

  async function listarEntregas(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { ofertaId?: string; status?: "aberta" | "encerrada"; arquivados: "sim" | "nao"; cursor?: string; limite: number },
  ): Promise<Pagina<EntregaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await consultaEntregas(tx)
        .where(
          and(
            eq(entrega.empresaId, ctx.empresaId),
            entregaVisivel(ctx, escopo),
            f.arquivados === "sim" ? isNotNull(entrega.arquivadoEm) : isNull(entrega.arquivadoEm),
            f.ofertaId ? eq(entrega.ofertaId, f.ofertaId) : undefined,
            f.status ? eq(entrega.status, f.status) : undefined,
            condicaoCursor(entrega.criadoEm, entrega.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(entrega.criadoEm), desc(entrega.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, entregaDto);
    });
  }

  async function obterEntrega(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<EntregaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => entregaDto(await carregarEntrega(tx, ctx, escopo, id)));
  }

  type DadosEntrega = {
    ofertaId?: string;
    nome?: string;
    prestadorId?: string | null;
    capacidade?: number | null;
    inicio?: string | null;
    fim?: string | null;
    horario?: string | null;
    status?: "aberta" | "encerrada";
    arquivar?: boolean;
  };

  async function salvarEntrega(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string | null, d: DadosEntrega): Promise<EntregaDto> {
    if (d.inicio && d.fim && d.fim < d.inicio) throw invalido("O fim precisa ser depois do início.");
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      if (d.ofertaId) {
        const [o] = await tx.db.select({ id: oferta.id }).from(oferta).where(and(eq(oferta.id, d.ofertaId), eq(oferta.empresaId, ctx.empresaId), isNull(oferta.arquivadoEm)));
        if (!o) throw invalido("Oferta não encontrada.");
      }
      // O prestador pode ser qualquer pessoa ativa da empresa (escopo empresa para escolher).
      const prestadorId = d.prestadorId ? await exigirPessoa(tx, ctx, "empresa", d.prestadorId) : d.prestadorId;
      let entregaId = id;
      if (!entregaId) {
        if (!d.ofertaId || !d.nome) throw invalido("Informe a oferta e o nome.");
        const [n] = await tx.db
          .insert(entrega)
          .values({
            empresaId: ctx.empresaId,
            ofertaId: d.ofertaId,
            nome: d.nome,
            prestadorId: prestadorId ?? null,
            capacidade: d.capacidade ?? null,
            inicio: d.inicio ?? null,
            fim: d.fim ?? null,
            horario: d.horario ?? null,
            criadoPor: ctx.usuarioId,
          })
          .returning({ id: entrega.id });
        entregaId = n.id;
      } else {
        const antes = await carregarEntrega(tx, ctx, escopo, entregaId);
        if (d.capacidade != null && d.capacidade < Number(antes.ocupadas)) {
          throw conflito(`A capacidade não pode ficar menor que as ${antes.ocupadas} vagas já ocupadas.`);
        }
        await tx.db
          .update(entrega)
          .set({
            ...(d.ofertaId !== undefined ? { ofertaId: d.ofertaId } : {}),
            ...(d.nome !== undefined ? { nome: d.nome } : {}),
            ...(prestadorId !== undefined ? { prestadorId } : {}),
            ...(d.capacidade !== undefined ? { capacidade: d.capacidade } : {}),
            ...(d.inicio !== undefined ? { inicio: d.inicio } : {}),
            ...(d.fim !== undefined ? { fim: d.fim } : {}),
            ...(d.horario !== undefined ? { horario: d.horario } : {}),
            ...(d.status !== undefined ? { status: d.status } : {}),
            ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
            atualizadoEm: new Date(),
          })
          .where(eq(entrega.id, entregaId));
      }
      await registrar(tx, origem, {
        acao: !id ? "entrega.criada" : d.arquivar ? "entrega.arquivada" : "entrega.atualizada",
        entidade: "entrega",
        entidadeId: entregaId,
        responsavelId: prestadorId ?? null,
        depois: d,
      });
      return entregaDto(await carregarEntrega(tx, ctx, "empresa", entregaId));
    });
  }

  async function participantes(ctx: ContextoEmpresa, escopo: Escopo, entregaId: string, f: { cursor?: string; limite: number }): Promise<Pagina<ParticipanteDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await carregarEntrega(tx, ctx, escopo, entregaId);
      const linhas = await tx.db
        .select({
          id: entregaParticipante.id,
          contatoId: entregaParticipante.contatoId,
          contatoNome: contato.nome,
          vendaId: entregaParticipante.vendaId,
          status: entregaParticipante.status,
          criadoEm: entregaParticipante.criadoEm,
        })
        .from(entregaParticipante)
        .leftJoin(contato, eq(contato.id, entregaParticipante.contatoId))
        .where(and(eq(entregaParticipante.entregaId, entregaId), condicaoCursor(entregaParticipante.criadoEm, entregaParticipante.id, lerCursor(f.cursor))))
        .orderBy(desc(entregaParticipante.criadoEm), desc(entregaParticipante.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, (l) => ({ ...l, criadoEm: iso(l.criadoEm) }));
    });
  }

  async function incluir(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, entregaId: string, contatoId: string): Promise<ParticipanteDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const e = await carregarEntrega(tx, ctx, escopo, entregaId);
      const escopoCrm = temPermissao(ctx.permissoes, "crm", "ver");
      const c = escopoCrm ? await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopoCrm, contatoId) : null;
      if (!c) throw invalido("Contato não encontrado na sua carteira.");
      const id = await ocuparVaga(tx, ctx.empresaId, entregaId, contatoId, ctx.usuarioId, null);
      await registrar(tx, origem, { acao: "entrega.participante_incluido", entidade: "entrega", entidadeId: entregaId, contatoId, dados: { entrega: e.nome } });
      const [p] = await tx.db
        .select({ id: entregaParticipante.id, contatoId: entregaParticipante.contatoId, contatoNome: contato.nome, vendaId: entregaParticipante.vendaId, status: entregaParticipante.status, criadoEm: entregaParticipante.criadoEm })
        .from(entregaParticipante)
        .leftJoin(contato, eq(contato.id, entregaParticipante.contatoId))
        .where(eq(entregaParticipante.id, id));
      return { ...p, criadoEm: iso(p.criadoEm) };
    });
  }

  async function retirar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, entregaId: string, participanteId: string): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const e = await carregarEntrega(tx, ctx, escopo, entregaId);
      const [p] = await tx.db
        .update(entregaParticipante)
        .set({ status: "cancelado", atualizadoEm: new Date() })
        .where(and(eq(entregaParticipante.id, participanteId), eq(entregaParticipante.entregaId, entregaId), eq(entregaParticipante.status, "ativo")))
        .returning({ contatoId: entregaParticipante.contatoId });
      if (!p) throw naoEncontrado("Participante");
      await registrar(tx, origem, { acao: "entrega.participante_retirado", entidade: "entrega", entidadeId: entregaId, contatoId: p.contatoId, dados: { entrega: e.nome } });
    });
  }

  return { listarOfertas, salvarOferta, listarEntregas, obterEntrega, salvarEntrega, participantes, incluir, retirar };
}

