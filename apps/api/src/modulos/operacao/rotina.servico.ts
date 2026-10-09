// Rotina diária: o que a pessoa precisa fazer hoje, juntado dos outros módulos (só os que o perfil vê),
// mais o check-list do perfil.
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { moduloAtivo, temPermissao, type ChecklistItemDto, type Modulo, type RotinaDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { checklistItem, checklistMarcacao, perfil } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { criarServicoAgenda } from "./agenda.servico.js";
import { fusoDe, hojeNoFuso, instantesDoPeriodo } from "./comum.js";
import { criarServicoDesempenho } from "./desempenho.servico.js";

const LIMITE_SECAO = 20;

const pode = (ctx: ContextoEmpresa, modulo: Modulo) => moduloAtivo(modulo, ctx.modulos) && Boolean(temPermissao(ctx.permissoes, modulo, "ver"));

export function criarServicoRotina(s: Servicos) {
  const { banco } = s;
  const agenda = criarServicoAgenda(s);
  const desempenho = criarServicoDesempenho(s);

  async function checklistDoDia(tx: Tx, ctx: ContextoEmpresa, dia: string) {
    const { rows } = await tx.db.execute<{ id: string; texto: string; feito: boolean | null }>(sql`
      SELECT i.id, i.texto, m.feito
      FROM checklist_item i
      LEFT JOIN checklist_marcacao m ON m.item_id = i.id AND m.usuario_id = ${ctx.usuarioId} AND m.data = ${dia}::date
      WHERE i.empresa_id = ${ctx.empresaId} AND i.arquivado_em IS NULL
        AND (i.perfil_id IS NULL OR i.perfil_id = ${ctx.perfilId ?? null}::uuid)
      ORDER BY i.ordem, i.criado_em
      LIMIT 50`);
    return rows.map((r) => ({ itemId: r.id, texto: r.texto, feito: Boolean(r.feito) }));
  }

  async function rotina(ctx: ContextoEmpresa): Promise<RotinaDto> {
    const fuso = fusoDe(ctx);
    const dia = hojeNoFuso(fuso);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { de, ate } = instantesDoPeriodo(dia, dia, fuso);

      let tarefas: RotinaDto["tarefas"] = null;
      if (pode(ctx, "crm")) {
        const [c] = (
          await tx.db.execute<{ vencidas: string; hoje: string }>(sql`
            SELECT count(*) FILTER (WHERE vence_em < ${de}) AS vencidas,
                   count(*) FILTER (WHERE vence_em >= ${de} AND vence_em < ${ate}) AS hoje
            FROM tarefa
            WHERE empresa_id = ${ctx.empresaId} AND responsavel_id = ${ctx.usuarioId}
              AND concluida_em IS NULL AND arquivado_em IS NULL AND vence_em < ${ate}`)
        ).rows;
        const { rows } = await tx.db.execute<{ id: string; titulo: string; vence_em: Date | null; contato_id: string | null; contato_nome: string | null }>(sql`
          SELECT t.id, t.titulo, t.vence_em, t.contato_id, c.nome AS contato_nome
          FROM tarefa t LEFT JOIN contato c ON c.id = t.contato_id
          WHERE t.empresa_id = ${ctx.empresaId} AND t.responsavel_id = ${ctx.usuarioId}
            AND t.concluida_em IS NULL AND t.arquivado_em IS NULL AND t.vence_em < ${ate}
          ORDER BY t.vence_em, t.id
          LIMIT ${LIMITE_SECAO}`);
        tarefas = {
          vencidas: Number(c?.vencidas ?? 0),
          hoje: Number(c?.hoje ?? 0),
          itens: rows.map((r) => ({ id: r.id, titulo: r.titulo, venceEm: r.vence_em ? new Date(r.vence_em).toISOString() : null, contatoId: r.contato_id, contatoNome: r.contato_nome })),
        };
      }

      // Retornos agendados até hoje cujo último resultado foi registrado pela própria pessoa (tirado dos eventos).
      let retornos: RotinaDto["retornos"] = null;
      if (pode(ctx, "fila")) {
        const { rows } = await tx.db.execute<{ id: string; fila_id: string; fila_nome: string; contato_id: string; contato_nome: string; retornar_em: Date }>(sql`
          SELECT fi.id, fi.fila_id, f.nome AS fila_nome, fi.contato_id, c.nome AS contato_nome, fi.retornar_em
          FROM fila_item fi
          JOIN fila f ON f.id = fi.fila_id
          JOIN contato c ON c.id = fi.contato_id
          WHERE fi.empresa_id = ${ctx.empresaId} AND fi.status = 'pendente' AND fi.retornar_em < ${ate}
            AND f.status = 'ativa' AND f.arquivado_em IS NULL AND c.arquivado_em IS NULL
            AND (SELECT e.ator_id FROM evento e
                 WHERE e.empresa_id = fi.empresa_id AND e.entidade = 'fila_item' AND e.entidade_id = fi.id
                   AND e.tipo = 'fila.resultado_registrado'
                 ORDER BY e.criado_em DESC LIMIT 1) = ${ctx.usuarioId}::uuid
          ORDER BY fi.retornar_em
          LIMIT ${LIMITE_SECAO}`);
        retornos = rows.map((r) => ({
          itemId: r.id,
          filaId: r.fila_id,
          filaNome: r.fila_nome,
          contatoId: r.contato_id,
          contatoNome: r.contato_nome,
          retornarEm: new Date(r.retornar_em).toISOString(),
        }));
      }

      // Conversas da pessoa em que a última mensagem é do cliente.
      let conversas: RotinaDto["conversas"] = null;
      if (pode(ctx, "conversas")) {
        const { rows } = await tx.db.execute<{ id: string; contato_nome: string | null; telefone: string | null; ultima_mensagem: string | null; ultima_entrada_em: Date | null }>(sql`
          SELECT cv.id, c.nome AS contato_nome, cv.telefone, cv.ultima_mensagem, cv.ultima_entrada_em
          FROM conversa cv LEFT JOIN contato c ON c.id = cv.contato_id
          WHERE cv.empresa_id = ${ctx.empresaId} AND cv.atribuida_a = ${ctx.usuarioId} AND cv.status = 'aberta'
            AND cv.mesclada_em_id IS NULL AND cv.arquivado_em IS NULL
            AND cv.ultima_entrada_em IS NOT NULL AND cv.ultima_entrada_em >= coalesce(cv.ultima_mensagem_em, cv.ultima_entrada_em)
          ORDER BY cv.ultima_entrada_em
          LIMIT ${LIMITE_SECAO}`);
        conversas = rows.map((r) => ({
          id: r.id,
          contatoNome: r.contato_nome,
          telefone: r.telefone,
          ultimaMensagem: r.ultima_mensagem,
          ultimaEntradaEm: r.ultima_entrada_em ? new Date(r.ultima_entrada_em).toISOString() : null,
        }));
      }

      return {
        data: dia,
        tarefas,
        retornos,
        conversas,
        compromissos: pode(ctx, "agenda") ? await agenda.doDia(tx, ctx, dia) : null,
        checklist: await checklistDoDia(tx, ctx, dia),
        metas: pode(ctx, "desempenho") ? await desempenho.minhasMetas(tx, ctx, dia) : null,
      };
    });
  }

  async function marcar(ctx: ContextoEmpresa, origem: Origem, itemId: string, feito: boolean): Promise<void> {
    const dia = hojeNoFuso(fusoDe(ctx));
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [i] = await tx.db
        .select({ id: checklistItem.id, texto: checklistItem.texto })
        .from(checklistItem)
        .where(
          and(
            eq(checklistItem.id, itemId),
            eq(checklistItem.empresaId, ctx.empresaId),
            isNull(checklistItem.arquivadoEm),
            or(isNull(checklistItem.perfilId), ctx.perfilId ? eq(checklistItem.perfilId, ctx.perfilId) : undefined),
          ),
        );
      if (!i) throw naoEncontrado("Item do check-list");
      await tx.db
        .insert(checklistMarcacao)
        .values({ empresaId: ctx.empresaId, itemId, usuarioId: ctx.usuarioId, data: dia, feito })
        .onConflictDoUpdate({ target: [checklistMarcacao.itemId, checklistMarcacao.usuarioId, checklistMarcacao.data], set: { feito, atualizadoEm: new Date() } });
      await registrar(tx, origem, {
        acao: feito ? "checklist.feito" : "checklist.desfeito",
        entidade: "checklist_item",
        entidadeId: itemId,
        responsavelId: ctx.usuarioId,
        dados: { texto: i.texto, data: dia },
      });
    });
  }

  // Configuração do check-list ------------------------------------------------------------------------

  function consultaItens(tx: Tx) {
    return tx.db
      .select({ id: checklistItem.id, perfilId: checklistItem.perfilId, perfilNome: perfil.nome, texto: checklistItem.texto, ordem: checklistItem.ordem })
      .from(checklistItem)
      .leftJoin(perfil, eq(perfil.id, checklistItem.perfilId));
  }

  async function itens(ctx: ContextoEmpresa): Promise<{ itens: ChecklistItemDto[] }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => ({
      itens: await consultaItens(tx)
        .where(and(eq(checklistItem.empresaId, ctx.empresaId), isNull(checklistItem.arquivadoEm)))
        .orderBy(asc(checklistItem.ordem), asc(checklistItem.criadoEm))
        .limit(200),
    }));
  }

  async function validarPerfil(tx: Tx, ctx: ContextoEmpresa, perfilId: string | null | undefined) {
    if (!perfilId) return null;
    const [p] = await tx.db.select({ id: perfil.id }).from(perfil).where(and(eq(perfil.id, perfilId), eq(perfil.empresaId, ctx.empresaId)));
    if (!p) throw invalido("Perfil não encontrado.");
    return perfilId;
  }

  async function salvarItem(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string | null,
    d: { texto?: string; perfilId?: string | null; ordem?: number; arquivar?: boolean },
  ): Promise<ChecklistItemDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      let itemId = id;
      if (!itemId) {
        const [n] = await tx.db
          .insert(checklistItem)
          .values({ empresaId: ctx.empresaId, texto: d.texto!, perfilId: await validarPerfil(tx, ctx, d.perfilId), ordem: d.ordem ?? 0 })
          .returning({ id: checklistItem.id });
        itemId = n.id;
      } else {
        const [antes] = await tx.db.select({ id: checklistItem.id }).from(checklistItem).where(and(eq(checklistItem.id, itemId), eq(checklistItem.empresaId, ctx.empresaId)));
        if (!antes) throw naoEncontrado("Item do check-list");
        await tx.db
          .update(checklistItem)
          .set({
            ...(d.texto !== undefined ? { texto: d.texto } : {}),
            ...(d.perfilId !== undefined ? { perfilId: await validarPerfil(tx, ctx, d.perfilId) } : {}),
            ...(d.ordem !== undefined ? { ordem: d.ordem } : {}),
            ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
            atualizadoEm: new Date(),
          })
          .where(eq(checklistItem.id, itemId));
      }
      await registrar(tx, origem, {
        acao: !id ? "checklist.item_criado" : d.arquivar ? "checklist.item_arquivado" : "checklist.item_atualizado",
        entidade: "checklist_item",
        entidadeId: itemId,
        depois: d,
      });
      const [l] = await consultaItens(tx).where(eq(checklistItem.id, itemId));
      return l;
    });
  }

  return { rotina, marcar, itens, salvarItem };
}
