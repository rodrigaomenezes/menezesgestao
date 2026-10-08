// Filas de discagem ativa. Regra central: um item da fila só fica reservado para uma pessoa por vez — a trava é
// do banco (SELECT … FOR UPDATE SKIP LOCKED + UPDATE condicionado), não da tela. A reserva expira sozinha.
import { and, asc, count, desc, eq, inArray, isNull, ne, sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { Escopo, FilaDto, FilaItemDto, FilaLoteDto, Pagina, TipoBaseDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import {
  contato,
  etapa,
  fila,
  filaItem,
  filaLote,
  funil,
  ligacao,
  oportunidade,
  resultadoLigacao,
  tipoBase,
  usuario,
  type StatusFila,
} from "../../infra/esquema.js";
import { ErroApp, invalido, naoEncontrado } from "../../infra/erros.js";
import { iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";

type LinhaItem = typeof filaItem.$inferSelect;

/** Contato da fila visível para quem pede: sem dono (fila de todos) ou dentro do escopo. */
const contatoVisivel = (ctx: ContextoEmpresa, escopo: Escopo, coluna: AnyColumn | SQL = contato.responsavelId): SQL =>
  escopo === "empresa" ? sql`true` : sql`(${coluna} IS NULL OR ${filtroUsuariosVisiveis(ctx, escopo, coluna)})`;

export type ResultadoInclusao = "adicionado" | "ja_ligado" | "em_outra_fila" | "ja_na_fila";

/** Põe um contato numa fila. Contato que já está pendente em outra fila ativa não entra (duas pessoas ligariam). */
export async function incluirNaFila(tx: Tx, empresaId: string, filaId: string, contatoId: string, loteId: string | null): Promise<ResultadoInclusao> {
  const [naFila] = await tx.db.select({ id: filaItem.id }).from(filaItem).where(and(eq(filaItem.filaId, filaId), eq(filaItem.contatoId, contatoId)));
  if (naFila) return "ja_na_fila";
  const { rows: outra } = await tx.db.execute(sql`
    SELECT 1 FROM fila_item fi JOIN fila f ON f.id = fi.fila_id
     WHERE fi.empresa_id = ${empresaId} AND fi.contato_id = ${contatoId} AND fi.fila_id <> ${filaId}
       AND fi.status IN ('pendente', 'reservado') AND f.status <> 'encerrada' AND f.arquivado_em IS NULL
     LIMIT 1`);
  if (outra.length) return "em_outra_fila";
  const inserido = await tx.db.insert(filaItem).values({ empresaId, filaId, contatoId, loteId }).onConflictDoNothing().returning({ id: filaItem.id });
  if (!inserido.length) return "ja_na_fila";
  const [ligou] = await tx.db.select({ id: ligacao.id }).from(ligacao).where(and(eq(ligacao.empresaId, empresaId), eq(ligacao.contatoId, contatoId))).limit(1);
  return ligou ? "ja_ligado" : "adicionado";
}

export function criarServicoFila(s: Servicos) {
  const { banco } = s;
  const reservadoPor = usuario;

  async function carregarFila(tx: Tx, ctx: ContextoEmpresa, id: string) {
    const [f] = await tx.db.select().from(fila).where(and(eq(fila.id, id), eq(fila.empresaId, ctx.empresaId)));
    if (!f) throw naoEncontrado("Fila");
    return f;
  }

  async function validarReferencias(tx: Tx, ctx: ContextoEmpresa, d: { tipoBaseId?: string | null; funilId?: string | null; etapaId?: string | null }) {
    if (d.tipoBaseId) {
      const [t] = await tx.db.select({ id: tipoBase.id }).from(tipoBase).where(and(eq(tipoBase.id, d.tipoBaseId), eq(tipoBase.empresaId, ctx.empresaId)));
      if (!t) throw invalido("Tipo de base não encontrado.");
    }
    if (d.funilId) {
      const [f] = await tx.db.select({ id: funil.id }).from(funil).where(and(eq(funil.id, d.funilId), eq(funil.empresaId, ctx.empresaId)));
      if (!f) throw invalido("Funil não encontrado.");
    }
    if (d.etapaId) {
      const [e] = await tx.db.select({ funilId: etapa.funilId }).from(etapa).where(and(eq(etapa.id, d.etapaId), eq(etapa.empresaId, ctx.empresaId)));
      if (!e || (d.funilId && e.funilId !== d.funilId)) throw invalido("Etapa não encontrada neste funil.");
    }
  }

  async function filaDto(tx: Tx, f: typeof fila.$inferSelect): Promise<FilaDto> {
    const { rows } = await tx.db.execute<{ prontos: number; agendados: number; reservados: number; concluidos: number; total: number }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pendente' AND (retornar_em IS NULL OR retornar_em <= now()))
          + count(*) FILTER (WHERE status = 'reservado' AND reservado_ate < now()) AS prontos,
        count(*) FILTER (WHERE status = 'pendente' AND retornar_em > now()) AS agendados,
        count(*) FILTER (WHERE status = 'reservado' AND reservado_ate >= now()) AS reservados,
        count(*) FILTER (WHERE status IN ('concluido', 'descartado')) AS concluidos,
        count(*) AS total
      FROM fila_item WHERE fila_id = ${f.id}`);
    const c = rows[0];
    const [tb] = f.tipoBaseId ? await tx.db.select({ nome: tipoBase.nome }).from(tipoBase).where(eq(tipoBase.id, f.tipoBaseId)) : [];
    return {
      id: f.id,
      nome: f.nome,
      tipoBaseId: f.tipoBaseId,
      tipoBaseNome: tb?.nome ?? null,
      status: f.status,
      funilId: f.funilId,
      etapaId: f.etapaId,
      reservaMinutos: f.reservaMinutos,
      maxTentativas: f.maxTentativas,
      prontos: Number(c.prontos),
      agendados: Number(c.agendados),
      reservados: Number(c.reservados),
      concluidos: Number(c.concluidos),
      total: Number(c.total),
      arquivadoEm: iso(f.arquivadoEm),
    };
  }

  async function itemDto(tx: Tx, i: LinhaItem): Promise<FilaItemDto> {
    const [l] = await tx.db
      .select({ filaNome: fila.nome, contatoNome: contato.nome, telefone: contato.telefone, reservadoPorNome: reservadoPor.nome, resultadoNome: resultadoLigacao.nome })
      .from(filaItem)
      .innerJoin(fila, eq(fila.id, filaItem.filaId))
      .innerJoin(contato, eq(contato.id, filaItem.contatoId))
      .leftJoin(reservadoPor, eq(reservadoPor.id, filaItem.reservadoPor))
      .leftJoin(resultadoLigacao, eq(resultadoLigacao.id, filaItem.ultimoResultadoId))
      .where(eq(filaItem.id, i.id));
    return {
      id: i.id,
      filaId: i.filaId,
      filaNome: l?.filaNome ?? "",
      contatoId: i.contatoId,
      contatoNome: l?.contatoNome ?? "",
      telefone: l?.telefone ?? null,
      status: i.status,
      tentativas: i.tentativas,
      retornarEm: iso(i.retornarEm),
      reservadoAte: iso(i.reservadoAte),
      reservadoPorNome: l?.reservadoPorNome ?? null,
      ultimoResultadoNome: l?.resultadoNome ?? null,
    };
  }

  async function listar(ctx: ContextoEmpresa, arquivadas: boolean): Promise<FilaDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const filas = await tx.db
        .select()
        .from(fila)
        .where(and(eq(fila.empresaId, ctx.empresaId), arquivadas ? sql`${fila.arquivadoEm} IS NOT NULL` : isNull(fila.arquivadoEm)))
        .orderBy(asc(fila.status), desc(fila.criadoEm))
        .limit(200);
      return Promise.all(filas.map((f) => filaDto(tx, f)));
    });
  }

  async function obter(ctx: ContextoEmpresa, id: string): Promise<FilaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => filaDto(tx, await carregarFila(tx, ctx, id)));
  }

  async function criar(
    ctx: ContextoEmpresa,
    origem: Origem,
    d: { nome: string; tipoBaseId?: string | null; funilId?: string | null; etapaId?: string | null; reservaMinutos: number; maxTentativas: number },
  ): Promise<FilaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await validarReferencias(tx, ctx, d);
      const [f] = await tx.db
        .insert(fila)
        .values({ empresaId: ctx.empresaId, nome: d.nome, tipoBaseId: d.tipoBaseId ?? null, funilId: d.funilId ?? null, etapaId: d.etapaId ?? null, reservaMinutos: d.reservaMinutos, maxTentativas: d.maxTentativas, criadoPor: ctx.usuarioId })
        .returning();
      await registrar(tx, origem, { acao: "fila.criada", entidade: "fila", entidadeId: f.id, depois: { nome: f.nome } });
      return filaDto(tx, f);
    });
  }

  async function atualizar(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string,
    d: { nome?: string; tipoBaseId?: string | null; funilId?: string | null; etapaId?: string | null; reservaMinutos?: number; maxTentativas?: number; status?: StatusFila; arquivado?: boolean },
  ): Promise<FilaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregarFila(tx, ctx, id);
      await validarReferencias(tx, ctx, d);
      const { arquivado, ...resto } = d;
      const [f] = await tx.db
        .update(fila)
        .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
        .where(eq(fila.id, id))
        .returning();
      // Fila pausada, encerrada ou arquivada devolve as reservas.
      if (f.status !== "ativa" || f.arquivadoEm) {
        await tx.db.update(filaItem).set({ status: "pendente", reservadoPor: null, reservadoAte: null, atualizadoEm: new Date() }).where(and(eq(filaItem.filaId, id), eq(filaItem.status, "reservado")));
      }
      await registrar(tx, origem, { acao: "fila.atualizada", entidade: "fila", entidadeId: id, antes: { nome: antes.nome, status: antes.status }, depois: d });
      return filaDto(tx, f);
    });
  }

  /** Pega o próximo da fila (ou devolve a reserva que a pessoa já tem nela). */
  async function proximo(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, filaId: string): Promise<{ item: FilaItemDto | null; motivo: string | null }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const f = await carregarFila(tx, ctx, filaId);
      if (f.arquivadoEm || f.status !== "ativa") return { item: null, motivo: f.status === "pausada" ? "A fila está pausada." : "A fila não está ativa." };
      const [minha] = await tx.db
        .select()
        .from(filaItem)
        .where(and(eq(filaItem.filaId, filaId), eq(filaItem.status, "reservado"), eq(filaItem.reservadoPor, ctx.usuarioId), sql`${filaItem.reservadoAte} >= now()`))
        .limit(1);
      if (minha) return { item: await itemDto(tx, minha), motivo: null };

      // Contato que pediu para não ser contatado (ou foi para a lixeira) sai da fila antes de alguém ligar.
      await tx.db.execute(sql`
        UPDATE fila_item fi SET status = 'descartado', reservado_por = NULL, reservado_ate = NULL, atualizado_em = now()
          FROM contato c
         WHERE fi.contato_id = c.id AND fi.fila_id = ${filaId} AND fi.status = 'pendente'
           AND (c.nao_contatar OR c.arquivado_em IS NOT NULL)`);

      const { rows } = await tx.db.execute<{ id: string }>(sql`
        WITH candidato AS (
          SELECT fi.id FROM fila_item fi JOIN contato c ON c.id = fi.contato_id
           WHERE fi.fila_id = ${filaId} AND fi.empresa_id = ${ctx.empresaId}
             AND (fi.status = 'pendente' OR (fi.status = 'reservado' AND fi.reservado_ate < now()))
             AND (fi.retornar_em IS NULL OR fi.retornar_em <= now())
             AND c.telefone IS NOT NULL AND NOT c.nao_contatar AND c.arquivado_em IS NULL
             AND ${contatoVisivel(ctx, escopo, sql.raw("c.responsavel_id"))}
           ORDER BY fi.prioridade DESC, fi.retornar_em NULLS FIRST, fi.ordem
           LIMIT 1
           FOR UPDATE OF fi SKIP LOCKED)
        UPDATE fila_item SET status = 'reservado', reservado_por = ${ctx.usuarioId},
               reservado_ate = now() + make_interval(mins => ${f.reservaMinutos}), atualizado_em = now()
          FROM candidato
         WHERE fila_item.id = candidato.id
           AND (fila_item.status = 'pendente' OR fila_item.reservado_ate < now())
        RETURNING fila_item.id`);
      if (!rows[0]) return { item: null, motivo: "Ninguém para ligar agora nesta fila. Os retornos agendados aparecem na hora marcada." };
      const [i] = await tx.db.select().from(filaItem).where(eq(filaItem.id, rows[0].id));
      await registrar(tx, origem, { acao: "fila.lead_reservado", entidade: "fila_item", entidadeId: i.id, contatoId: i.contatoId, responsavelId: ctx.usuarioId, dados: { filaId } });
      return { item: await itemDto(tx, i), motivo: null };
    });
  }

  async function carregarReservaMinha(tx: Tx, ctx: ContextoEmpresa, itemId: string): Promise<LinhaItem> {
    const [i] = await tx.db.select().from(filaItem).where(and(eq(filaItem.id, itemId), eq(filaItem.empresaId, ctx.empresaId))).for("update");
    if (!i) throw naoEncontrado("Item da fila");
    if (i.status !== "reservado" || i.reservadoPor !== ctx.usuarioId) {
      throw new ErroApp(409, "CONFLITO", "Este contato não está mais reservado para você (a reserva venceu ou outra pessoa pegou). Pegue o próximo da fila.");
    }
    return i;
  }

  async function liberar(ctx: ContextoEmpresa, origem: Origem, itemId: string): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const i = await carregarReservaMinha(tx, ctx, itemId);
      await tx.db.update(filaItem).set({ status: "pendente", reservadoPor: null, reservadoAte: null, atualizadoEm: new Date() }).where(eq(filaItem.id, i.id));
      await registrar(tx, origem, { acao: "fila.lead_liberado", entidade: "fila_item", entidadeId: i.id, contatoId: i.contatoId });
    });
  }

  /** Registra o resultado do contato da fila e aplica a ação do resultado (reagendar, encerrar, descartar, converter). */
  async function registrarResultado(
    ctx: ContextoEmpresa,
    origem: Origem,
    itemId: string,
    d: { resultadoId: string; observacao?: string | null; retornarEm?: string | null; ligacaoId?: string | null },
  ): Promise<{ item: FilaItemDto; oportunidadeId: string | null }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const i = await carregarReservaMinha(tx, ctx, itemId);
      const [r] = await tx.db.select().from(resultadoLigacao).where(and(eq(resultadoLigacao.id, d.resultadoId), eq(resultadoLigacao.empresaId, ctx.empresaId), isNull(resultadoLigacao.arquivadoEm)));
      if (!r) throw invalido("Resultado não encontrado.");
      const [f] = await tx.db.select().from(fila).where(eq(fila.id, i.filaId));
      const tentativas = i.tentativas + 1;
      let status: LinhaItem["status"] = "pendente";
      let retornarEm: Date | null = null;
      let oportunidadeId: string | null = null;

      switch (r.acao) {
        case "reagendar": {
          if (r.horas) retornarEm = new Date(Date.now() + r.horas * 3600_000);
          else if (d.retornarEm) retornarEm = new Date(d.retornarEm);
          else throw invalido("Escolha quando ligar de novo.");
          if (retornarEm.getTime() <= Date.now()) throw invalido("A data de retorno precisa ser no futuro.");
          // Esgotou as tentativas: sai da fila (o histórico fica).
          if (tentativas >= f.maxTentativas && !d.retornarEm) status = "concluido";
          break;
        }
        case "encerrar":
          status = "concluido";
          break;
        case "descartar":
          status = "descartado";
          break;
        case "converter": {
          status = "concluido";
          oportunidadeId = await converter(tx, ctx, origem, f, i.contatoId);
          break;
        }
        case "nenhuma":
          break;
      }

      const [atualizado] = await tx.db
        .update(filaItem)
        .set({ status, tentativas, ultimoResultadoId: r.id, retornarEm: status === "pendente" ? retornarEm : null, reservadoPor: null, reservadoAte: null, atualizadoEm: new Date() })
        .where(eq(filaItem.id, i.id))
        .returning();
      if (d.ligacaoId) {
        await tx.db
          .update(ligacao)
          .set({ resultadoId: r.id, observacao: d.observacao ?? null, atualizadoEm: new Date() })
          .where(and(eq(ligacao.id, d.ligacaoId), eq(ligacao.usuarioId, ctx.usuarioId), eq(ligacao.empresaId, ctx.empresaId)));
      }
      await registrar(tx, origem, {
        acao: "fila.resultado_registrado",
        entidade: "fila_item",
        entidadeId: i.id,
        contatoId: i.contatoId,
        responsavelId: ctx.usuarioId,
        dados: { titulo: `${r.nome} — fila ${f.nome}`, resultado: r.nome, acao: r.acao, filaId: f.id, retornarEm: iso(retornarEm), oportunidadeId, observacao: d.observacao ?? null },
      });
      return { item: await itemDto(tx, atualizado), oportunidadeId };
    });
  }

  /** Conversão direta para o funil: oportunidade aberta (reaproveita a que já existe) e o contato passa a ser de quem converteu, se não tinha dono. */
  async function converter(tx: Tx, ctx: ContextoEmpresa, origem: Origem, f: typeof fila.$inferSelect, contatoId: string): Promise<string> {
    const [ct] = await tx.db.select().from(contato).where(eq(contato.id, contatoId));
    let funilId = f.funilId;
    let etapaId = f.etapaId;
    if (!funilId) {
      const [primeiro] = await tx.db.select({ id: funil.id }).from(funil).where(and(eq(funil.empresaId, ctx.empresaId), isNull(funil.arquivadoEm))).orderBy(asc(funil.ordem)).limit(1);
      funilId = primeiro?.id ?? null;
    }
    if (!funilId) throw invalido("A empresa não tem funil ativo para receber a conversão.");
    if (!etapaId) {
      const [e] = await tx.db.select({ id: etapa.id }).from(etapa).where(and(eq(etapa.funilId, funilId), eq(etapa.tipo, "aberta"), isNull(etapa.arquivadoEm))).orderBy(asc(etapa.ordem)).limit(1);
      etapaId = e?.id ?? null;
    }
    if (!etapaId) throw invalido("O funil da fila não tem etapa aberta.");
    const [existente] = await tx.db
      .select({ id: oportunidade.id })
      .from(oportunidade)
      .where(and(eq(oportunidade.contatoId, contatoId), eq(oportunidade.funilId, funilId), eq(oportunidade.status, "aberta"), isNull(oportunidade.arquivadoEm)))
      .limit(1);
    if (existente) return existente.id;
    if (!ct.responsavelId) await tx.db.update(contato).set({ responsavelId: ctx.usuarioId, atualizadoEm: new Date() }).where(eq(contato.id, contatoId));
    const [op] = await tx.db
      .insert(oportunidade)
      .values({ empresaId: ctx.empresaId, contatoId, funilId, etapaId, titulo: `${ct.nome} — ${f.nome}`, responsavelId: ct.responsavelId ?? ctx.usuarioId, criadoPor: ctx.usuarioId })
      .returning({ id: oportunidade.id });
    await registrar(tx, origem, {
      acao: "oportunidade.criada",
      entidade: "oportunidade",
      entidadeId: op.id,
      contatoId,
      responsavelId: ct.responsavelId ?? ctx.usuarioId,
      depois: { titulo: `${ct.nome} — ${f.nome}`, origem: "fila" },
      dados: { titulo: `${ct.nome} — ${f.nome}` },
    });
    return op.id;
  }

  async function adicionar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, filaId: string, contatoIds: string[]) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const f = await carregarFila(tx, ctx, filaId);
      if (f.arquivadoEm || f.status === "encerrada") throw invalido("Esta fila está encerrada. Reabra ou escolha outra.");
      const visiveis = await tx.db
        .select({ id: contato.id, telefone: contato.telefone })
        .from(contato)
        .where(and(eq(contato.empresaId, ctx.empresaId), inArray(contato.id, [...new Set(contatoIds)]), isNull(contato.arquivadoEm), contatoVisivel(ctx, escopo)));
      const r = { adicionados: 0, emOutraFila: 0, jaNaFila: 0, semTelefone: 0 };
      for (const c of visiveis) {
        if (!c.telefone) {
          r.semTelefone++;
          continue;
        }
        const res = await incluirNaFila(tx, ctx.empresaId, filaId, c.id, null);
        if (res === "em_outra_fila") r.emOutraFila++;
        else if (res === "ja_na_fila") r.jaNaFila++;
        else r.adicionados++;
      }
      await registrar(tx, origem, { acao: "fila.contatos_adicionados", entidade: "fila", entidadeId: filaId, dados: r });
      return r;
    });
  }

  async function itens(ctx: ContextoEmpresa, escopo: Escopo, filaId: string, f: { status?: LinhaItem["status"]; cursor?: string; limite: number }): Promise<Pagina<FilaItemDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await carregarFila(tx, ctx, filaId);
      const cursor = lerCursor(f.cursor);
      const linhas = await tx.db
        .select({ i: filaItem })
        .from(filaItem)
        .innerJoin(contato, eq(contato.id, filaItem.contatoId))
        .where(
          and(
            eq(filaItem.filaId, filaId),
            f.status ? eq(filaItem.status, f.status) : ne(filaItem.status, "descartado"),
            contatoVisivel(ctx, escopo),
            cursor ? sql`(${filaItem.criadoEm}, ${filaItem.id}) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(filaItem.criadoEm), desc(filaItem.id))
        .limit(f.limite + 1);
      const dtos = await Promise.all(linhas.slice(0, f.limite + 1).map((l) => itemDto(tx, l.i)));
      return montarPagina(
        linhas.map((l, k) => ({ id: l.i.id, criadoEm: l.i.criadoEm, dto: dtos[k] })),
        f.limite,
        (l) => l.dto,
      );
    });
  }

  async function lotes(ctx: ContextoEmpresa, filaId: string): Promise<FilaLoteDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await carregarFila(tx, ctx, filaId);
      return (await tx.db.select().from(filaLote).where(eq(filaLote.filaId, filaId)).orderBy(desc(filaLote.criadoEm)).limit(50)).map((l) => ({
        id: l.id,
        importacaoId: l.importacaoId,
        novos: l.novos,
        atualizados: l.atualizados,
        emOutraFila: l.emOutraFila,
        jaLigados: l.jaLigados,
        ignorados: l.ignorados,
        criadoEm: iso(l.criadoEm) ?? "",
      }));
    });
  }

  // Tipos de base -----------------------------------------------------------------------------------
  async function tiposBase(ctx: ContextoEmpresa): Promise<TipoBaseDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) =>
      (await tx.db.select().from(tipoBase).where(eq(tipoBase.empresaId, ctx.empresaId)).orderBy(asc(tipoBase.nome)).limit(200)).map((t) => ({
        id: t.id,
        nome: t.nome,
        arquivadoEm: iso(t.arquivadoEm),
      })),
    );
  }

  async function salvarTipoBase(ctx: ContextoEmpresa, origem: Origem, id: string | null, d: { nome: string; arquivado?: boolean }): Promise<TipoBaseDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      let t;
      if (id) {
        [t] = await tx.db
          .update(tipoBase)
          .set({ nome: d.nome, ...(d.arquivado === undefined ? {} : { arquivadoEm: d.arquivado ? new Date() : null }) })
          .where(and(eq(tipoBase.id, id), eq(tipoBase.empresaId, ctx.empresaId)))
          .returning();
        if (!t) throw naoEncontrado("Tipo de base");
      } else {
        [t] = await tx.db.insert(tipoBase).values({ empresaId: ctx.empresaId, nome: d.nome }).returning();
      }
      await registrar(tx, origem, { acao: id ? "tipo_base.atualizado" : "tipo_base.criado", entidade: "tipo_base", entidadeId: t.id, depois: d });
      return { id: t.id, nome: t.nome, arquivadoEm: iso(t.arquivadoEm) };
    });
  }

  /** Quantos itens a fila tem para a pessoa (para o contador do menu). */
  async function totalProntos(ctx: ContextoEmpresa): Promise<number> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [r] = await tx.db
        .select({ n: count() })
        .from(filaItem)
        .innerJoin(fila, eq(fila.id, filaItem.filaId))
        .where(and(eq(filaItem.empresaId, ctx.empresaId), eq(fila.status, "ativa"), eq(filaItem.status, "pendente"), sql`(${filaItem.retornarEm} IS NULL OR ${filaItem.retornarEm} <= now())`));
      return Number(r?.n ?? 0);
    });
  }

  return { listar, obter, criar, atualizar, proximo, liberar, registrarResultado, adicionar, itens, lotes, tiposBase, salvarTipoBase, totalProntos };
}

export type ServicoFila = ReturnType<typeof criarServicoFila>;
