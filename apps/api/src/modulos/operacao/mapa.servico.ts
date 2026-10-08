// Mapa de atividades por hora: eventos (o que passou pelo sistema) + lançamentos manuais corrigíveis (o que não
// passou: reunião, visita, treinamento). Nada é digitado como "contagem": o mapa só lê.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { CATEGORIAS_MAPA, type AtividadeDto, type Escopo, type LinhaMapaDto, type Pagina, type TipoAtividadeId } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { atividadeManual, usuario } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { exigirPessoa, fusoDe, hojeNoFuso, instantesDoPeriodo, pessoasVisiveis } from "./comum.js";

/** Eventos que contam no mapa, por categoria (constantes do código). */
const CATEGORIAS: Record<(typeof CATEGORIAS_MAPA)[number], string> = {
  ligacoes: "tipo = 'ligacao.encerrada'",
  mensagens: "tipo = 'mensagem.criada'",
  fila: "tipo = 'fila.resultado_registrado'",
  crm: "(tipo LIKE 'contato.%' OR tipo LIKE 'oportunidade.%' OR tipo LIKE 'tarefa.%' OR tipo LIKE 'nota.%' OR tipo LIKE 'conversa.%') AND NOT (dados ? 'importacaoId')",
};

const LIMITE_ATIVIDADE_MS = 16 * 3600_000;

export function criarServicoMapa(s: Servicos) {
  const { banco } = s;

  const colunas = {
    id: atividadeManual.id,
    usuarioId: atividadeManual.usuarioId,
    usuarioNome: usuario.nome,
    tipo: atividadeManual.tipo,
    descricao: atividadeManual.descricao,
    inicio: atividadeManual.inicio,
    fim: atividadeManual.fim,
    criadoEm: atividadeManual.criadoEm,
  };
  type Linha = { id: string; usuarioId: string; usuarioNome: string | null; tipo: string; descricao: string | null; inicio: Date; fim: Date; criadoEm: Date };
  const dto = (l: Linha): AtividadeDto => ({ ...l, tipo: l.tipo as TipoAtividadeId, inicio: iso(l.inicio), fim: iso(l.fim) });

  async function mapa(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { data?: string; equipeId?: string; cursor?: string; limite: number },
  ): Promise<{ data: string; itens: LinhaMapaDto[]; proximoCursor: string | null }> {
    const fuso = fusoDe(ctx);
    const data = f.data ?? hojeNoFuso(fuso);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { pessoas, proximoCursor } = await pessoasVisiveis(tx, ctx, escopo, f);
      const ids = pessoas.map((p) => p.id);
      const vazio = () =>
        Array.from({ length: 24 }, (_, hora) => ({ hora, acoes: 0, ligacoes: 0, mensagens: 0, crm: 0, fila: 0, manualMinutos: 0, manualTipos: [] as string[] }));
      const porPessoa = new Map(ids.map((id) => [id, vazio()]));
      if (ids.length) {
        const { de, ate } = instantesDoPeriodo(data, data, fuso);
        const contagens = sql.join(
          CATEGORIAS_MAPA.map((c) => sql`${sql.raw(`count(*) FILTER (WHERE ${CATEGORIAS[c]})`)} AS ${sql.identifier(c)}`),
          sql`, `,
        );
        const { rows } = await tx.db.execute<Record<string, string | number>>(sql`
          SELECT ator_id::text AS usuario, extract(hour FROM criado_em AT TIME ZONE ${fuso})::int AS hora, ${contagens}
          FROM evento
          WHERE empresa_id = ${ctx.empresaId} AND criado_em >= ${de} AND criado_em < ${ate}
            AND ator_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
          GROUP BY 1, 2`);
        for (const r of rows) {
          const h = porPessoa.get(String(r.usuario))?.[Number(r.hora)];
          if (!h) continue;
          for (const c of CATEGORIAS_MAPA) h[c] = Number(r[c] ?? 0);
          h.acoes = h.ligacoes + h.mensagens + h.crm + h.fila;
        }
        // Lançamentos manuais: minutos de cada hora cobertos pela atividade (no fuso da empresa).
        const manuais = await tx.db.execute<{ usuario_id: string; tipo: string; ini: number; fim: number }>(sql`
          SELECT usuario_id, tipo,
                 extract(epoch FROM greatest(inicio, ${de}) - ${de}) / 60 AS ini,
                 extract(epoch FROM least(fim, ${ate}) - ${de}) / 60 AS fim
          FROM atividade_manual
          WHERE empresa_id = ${ctx.empresaId} AND arquivado_em IS NULL AND inicio < ${ate} AND fim > ${de}
            AND usuario_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
        for (const m of manuais.rows) {
          const horas = porPessoa.get(m.usuario_id);
          if (!horas) continue;
          for (let hora = Math.floor(Number(m.ini) / 60); hora < Math.min(24, Math.ceil(Number(m.fim) / 60)); hora++) {
            const minutos = Math.round(Math.min(Number(m.fim), (hora + 1) * 60) - Math.max(Number(m.ini), hora * 60));
            if (minutos <= 0) continue;
            horas[hora].manualMinutos = Math.min(60, horas[hora].manualMinutos + minutos);
            if (!horas[hora].manualTipos.includes(m.tipo)) horas[hora].manualTipos.push(m.tipo);
          }
        }
      }
      return { data, itens: pessoas.map((p) => ({ usuarioId: p.id, nome: p.nome, horas: porPessoa.get(p.id)! })), proximoCursor };
    });
  }

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<Linha> {
    const [l] = await tx.db
      .select(colunas)
      .from(atividadeManual)
      .leftJoin(usuario, eq(usuario.id, atividadeManual.usuarioId))
      .where(and(eq(atividadeManual.id, id), eq(atividadeManual.empresaId, ctx.empresaId), filtroUsuariosVisiveis(ctx, escopo, atividadeManual.usuarioId)));
    if (!l) throw naoEncontrado("Atividade");
    return l;
  }

  function validarIntervalo(inicio: Date, fim: Date) {
    if (fim <= inicio) throw invalido("O fim precisa ser depois do início.");
    if (fim.getTime() - inicio.getTime() > LIMITE_ATIVIDADE_MS) throw invalido("Uma atividade pode ter no máximo 16 horas. Divida em mais lançamentos.");
    if (inicio.getTime() > Date.now() + 86_400_000) throw invalido("Lance só atividades que já aconteceram ou estão acontecendo.");
  }

  async function listarAtividades(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { data?: string; usuarioId?: string; cursor?: string; limite: number },
  ): Promise<Pagina<AtividadeDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const periodo = f.data ? instantesDoPeriodo(f.data, f.data, fusoDe(ctx)) : null;
      const linhas = await tx.db
        .select(colunas)
        .from(atividadeManual)
        .leftJoin(usuario, eq(usuario.id, atividadeManual.usuarioId))
        .where(
          and(
            eq(atividadeManual.empresaId, ctx.empresaId),
            isNull(atividadeManual.arquivadoEm),
            filtroUsuariosVisiveis(ctx, escopo, atividadeManual.usuarioId),
            f.usuarioId ? eq(atividadeManual.usuarioId, f.usuarioId) : undefined,
            periodo ? sql`${atividadeManual.inicio} < ${periodo.ate} AND ${atividadeManual.fim} > ${periodo.de}` : undefined,
            condicaoCursor(atividadeManual.criadoEm, atividadeManual.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(atividadeManual.criadoEm), desc(atividadeManual.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, dto);
    });
  }

  async function criarAtividade(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    d: { usuarioId?: string | null; tipo: TipoAtividadeId; descricao: string | null; inicio: string; fim: string },
  ): Promise<AtividadeDto> {
    const inicio = new Date(d.inicio);
    const fim = new Date(d.fim);
    validarIntervalo(inicio, fim);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const usuarioId = await exigirPessoa(tx, ctx, escopo, d.usuarioId);
      const [{ id }] = await tx.db
        .insert(atividadeManual)
        .values({ empresaId: ctx.empresaId, usuarioId, tipo: d.tipo, descricao: d.descricao, inicio, fim, criadoPor: ctx.usuarioId })
        .returning({ id: atividadeManual.id });
      await registrar(tx, origem, {
        acao: "atividade.lancada",
        entidade: "atividade_manual",
        entidadeId: id,
        responsavelId: usuarioId,
        depois: d,
        dados: { tipo: d.tipo },
      });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function atualizarAtividade(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    d: { tipo?: TipoAtividadeId; descricao?: string | null; inicio?: string; fim?: string; arquivar?: boolean },
  ): Promise<AtividadeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      const inicio = d.inicio ? new Date(d.inicio) : antes.inicio;
      const fim = d.fim ? new Date(d.fim) : antes.fim;
      if (d.inicio || d.fim) validarIntervalo(inicio, fim);
      await tx.db
        .update(atividadeManual)
        .set({
          ...(d.tipo ? { tipo: d.tipo } : {}),
          ...(d.descricao !== undefined ? { descricao: d.descricao } : {}),
          inicio,
          fim,
          ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(atividadeManual.id, id));
      await registrar(tx, origem, {
        acao: d.arquivar ? "atividade.arquivada" : "atividade.corrigida",
        entidade: "atividade_manual",
        entidadeId: id,
        responsavelId: antes.usuarioId,
        antes: { tipo: antes.tipo, descricao: antes.descricao, inicio: antes.inicio, fim: antes.fim },
        depois: d,
      });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  return { mapa, listarAtividades, criarAtividade, atualizarAtividade };
}

