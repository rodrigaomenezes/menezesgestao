// Motor BRE sem IA (fase 8.1, ETR BRE-ETR-001 v0.2). Regras determinísticas: registro de 30 s, ciclo de contato
// (tentativas e silêncio), limites de frequência, Regra de Ouro do Break, reentradas, encerramento guiado, pós-venda
// e o estado diário do cliente. Os números vêm de bre_config (cada empresa ajusta); os códigos são da doutrina.
import {
  CHECKLIST_ENCERRAMENTO,
  CONFIG_BRE_PADRAO,
  ConfigBre,
  MOTIVOS_BREAK_PADRAO,
  PROXIMAS_ACOES,
  acaoPadraoBreak,
  type CategoriaBreak,
  type Escopo,
  type ItemFilaBreDto,
  type MarcoBre,
  type Pagina,
  type ReentradaDto,
  type RegistroBreEntrada,
  type TipoReentrada,
} from "@mg/shared";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import type { Servicos } from "../../app.js";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { lerCursor } from "../../infra/paginacao.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import type { EncerramentoBreEntrada, ReentradaEntrada } from "@mg/shared";

type Linha = Record<string, unknown>;
const ORIGEM_SISTEMA = (empresaId: string): Origem => ({ empresaId, atorId: null, ip: null, dispositivo: "motor-bre" });

async function q<T extends Linha>(tx: Tx, texto: string, valores: unknown[] = []): Promise<T[]> {
  return (await tx.cliente.query(texto, valores)).rows as T[];
}

/** Página por (criado_em, id), da mais recente para a mais antiga. */
function paginar<T, D>(linhas: (T & { criado_em: Date; id: string })[], limite: number, dto: (l: T & { criado_em: Date; id: string }) => D): Pagina<D> {
  const temMais = linhas.length > limite;
  const itens = temMais ? linhas.slice(0, limite) : linhas;
  const ultimo = itens.at(-1);
  return {
    itens: itens.map(dto),
    proximoCursor: temMais && ultimo ? Buffer.from(JSON.stringify([ultimo.criado_em.toISOString(), ultimo.id])).toString("base64url") : null,
  };
}

const hojeMais = (tx: Tx, dias: number) => q<{ d: string }>(tx, "SELECT to_char((now() AT TIME ZONE e.fuso)::date + $2::int, 'YYYY-MM-DD') AS d FROM empresa e WHERE e.id = $1", [tx.empresaId, dias]).then((r) => r[0]!.d);

export async function lerConfig(tx: Tx): Promise<ConfigBre & { versao: number }> {
  const [l] = await q<{ config: object; versao: number }>(tx, "SELECT config, versao FROM bre_config WHERE empresa_id = $1", [tx.empresaId]);
  return { ...ConfigBre.parse(l?.config ?? {}), versao: l?.versao ?? 0 };
}

export function criarServicoBre(s: Servicos) {
  const { banco } = s;

  async function contatoVisivel(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, contatoId: string) {
    const [c] = await tx.db.execute<{ id: string; nome: string; nao_contatar: boolean; estado_bre: string | null; ultima_entrega_em: string | null; responsavel_id: string | null }>(sql`
      SELECT id, nome, nao_contatar, estado_bre, to_char(ultima_entrega_em, 'YYYY-MM-DD') AS ultima_entrega_em, responsavel_id
      FROM contato WHERE id = ${contatoId} AND empresa_id = ${ctx.empresaId} AND arquivado_em IS NULL
        AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("responsavel_id"))})`).then((r) => r.rows);
    if (!c) throw naoEncontrado("{Contato}");
    return c;
  }

  async function criarReentrada(tx: Tx, origem: Origem, r: { contatoId: string; tipo: TipoReentrada; previstaPara: string | null; condicao: string | null; motivo: string; breakId?: string | null }) {
    const [l] = await q<{ id: string }>(
      tx,
      `INSERT INTO reentrada (empresa_id, contato_id, tipo, prevista_para, condicao, motivo, break_id, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [tx.empresaId, r.contatoId, r.tipo, r.previstaPara, r.condicao, r.motivo, r.breakId ?? null, origem.atorId],
    );
    await registrar(tx, origem, { acao: "bre.reentrada_programada", entidade: "contato", entidadeId: r.contatoId, contatoId: r.contatoId, depois: r });
    return l!.id;
  }

  async function criarTarefa(tx: Tx, origem: Origem, contatoId: string, responsavelId: string, titulo: string, venceEm: string) {
    await q(tx, `INSERT INTO tarefa (empresa_id, contato_id, titulo, responsavel_id, vence_em, criado_por) VALUES ($1, $2, $3, $4, ($5::date + time '09:00') AT TIME ZONE (SELECT fuso FROM empresa WHERE id = $1), $6)`, [
      tx.empresaId,
      contatoId,
      titulo,
      responsavelId,
      venceEm,
      origem.atorId,
    ]);
  }

  /**
   * Por que uma nova tentativa ativa não pode acontecer agora (BR-012, BR-013, BR-014, BR-015), ou null.
   * Data combinada com o cliente (reentrada ou retorno vencendo hoje) prevalece sobre o limite entre ciclos.
   */
  async function bloqueioDeTentativa(tx: Tx, c: { id: string; nao_contatar: boolean; estado_bre: string | null; ultima_entrega_em: string | null }, cfg: ConfigBre): Promise<string | null> {
    if (c.nao_contatar) return "O cliente pediu para não ser contatado. Só fale com ele quando ele mandar mensagem.";
    const [r] = await q<{ cedo: boolean; espera: boolean; entre_ciclos: boolean; combinado: boolean }>(
      tx,
      `SELECT
         ($2::text = 'RECENT' AND $3::date IS NOT NULL AND $3::date + make_interval(hours => $4) > now()) AS cedo,
         EXISTS (SELECT 1 FROM ciclo_contato WHERE empresa_id = $1 AND contato_id = $5 AND encerrado_em IS NULL
                   AND ultima_tentativa_em > now() - make_interval(hours => $6)) AS espera,
         EXISTS (SELECT 1 FROM ciclo_contato WHERE empresa_id = $1 AND contato_id = $5 AND sem_resposta
                   AND encerrado_em > now() - make_interval(days => $7)) AS entre_ciclos,
         EXISTS (SELECT 1 FROM reentrada WHERE empresa_id = $1 AND contato_id = $5 AND status = 'pendente'
                   AND prevista_para <= (now() AT TIME ZONE (SELECT fuso FROM empresa WHERE id = $1))::date)
           OR EXISTS (SELECT 1 FROM registro_bre WHERE empresa_id = $1 AND contato_id = $5
                   AND retorno_em = (now() AT TIME ZONE (SELECT fuso FROM empresa WHERE id = $1))::date) AS combinado`,
      [tx.empresaId, c.estado_bre, c.ultima_entrega_em, cfg.horasAntesDoPrimeiroContato, c.id, cfg.horasEntreTentativas, cfg.diasEntreCiclos],
    );
    if (r!.cedo) return `Cliente recente: o primeiro contato só ${cfg.horasAntesDoPrimeiroContato} horas depois da entrega.`;
    if (r!.espera) return `Aguarde ${cfg.horasEntreTentativas} horas desde a última tentativa antes de abordar de novo.`;
    if (r!.entre_ciclos && !r!.combinado) return `Este cliente não respondeu ao último ciclo. Novo contato só ${cfg.diasEntreCiclos} dias depois, ou na data combinada com ele.`;
    return null;
  }

  async function registrarConversa(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, e: RegistroBreEntrada) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await contatoVisivel(tx, ctx, escopo, e.contatoId);
      const cfg = await lerConfig(tx);
      if (e.resultado === "NO_REPLY") {
        const motivo = await bloqueioDeTentativa(tx, c, cfg);
        if (motivo) throw invalido(motivo);
      }

      // Referências opcionais só valem dentro da empresa (a chave estrangeira não passa pela RLS).
      const [refs] = await q<{ ok: boolean }>(
        tx,
        `SELECT ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM conversa WHERE id = $2 AND empresa_id = $1))
            AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM oferta WHERE id = $3 AND empresa_id = $1))
            AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM oferta WHERE id = $4 AND empresa_id = $1)) AS ok`,
        [ctx.empresaId, e.conversaId ?? null, e.interesseOfertaId ?? null, e.produtoOfertaId ?? null],
      );
      if (!refs!.ok) throw invalido("Conversa ou oferta não encontrada nesta empresa.");

      // Marco BRE da oportunidade, quando houver (onde o pipeline estava na conversa).
      let marco: MarcoBre | null = null;
      if (e.oportunidadeId) {
        const [o] = await q<{ marco_bre: MarcoBre | null }>(
          tx,
          "SELECT e.marco_bre FROM oportunidade o JOIN etapa e ON e.id = o.etapa_id WHERE o.id = $1 AND o.empresa_id = $2 AND o.contato_id = $3",
          [e.oportunidadeId, ctx.empresaId, c.id],
        );
        if (!o) throw naoEncontrado("{Oportunidade}");
        marco = o.marco_bre;
      }

      // Ciclo de contato: abre se não houver; tentativa sem resposta conta, resposta zera o silêncio.
      let [ciclo] = await q<{ id: string; tentativas: number }>(tx, "SELECT id, tentativas FROM ciclo_contato WHERE empresa_id = $1 AND contato_id = $2 AND encerrado_em IS NULL", [ctx.empresaId, c.id]);
      ciclo ??= (await q<{ id: string; tentativas: number }>(tx, "INSERT INTO ciclo_contato (empresa_id, contato_id) VALUES ($1, $2) RETURNING id, tentativas", [ctx.empresaId, c.id]))[0]!;
      let encerrar: { motivo: string; semResposta: boolean } | null = null;
      if (e.resultado === "NO_REPLY") {
        const tentativas = ciclo.tentativas + 1;
        await q(tx, "UPDATE ciclo_contato SET tentativas = $2, ultima_tentativa_em = now() WHERE id = $1", [ciclo.id, tentativas]);
        if (tentativas >= cfg.tentativasPorCiclo) encerrar = { motivo: "MAX_ATTEMPTS", semResposta: true };
      } else {
        await q(tx, "UPDATE ciclo_contato SET ultima_resposta_em = now() WHERE id = $1", [ciclo.id]);
        if (e.resultado === "PURCHASED") encerrar = { motivo: "PURCHASE_DONE", semResposta: false };
        if (e.resultado === "OPTED_OUT") encerrar = { motivo: "CUSTOMER_REQUESTED", semResposta: false };
      }

      const [reg] = await q<{ id: string }>(
        tx,
        `INSERT INTO registro_bre (empresa_id, contato_id, conversa_id, oportunidade_id, ciclo_id, autor_id, resultado, temperatura, estado_emocional,
           sins, marco, interesse_oferta_id, produto_oferta_id, proxima_acao, retorno_em, segundos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [
          ctx.empresaId, c.id, e.conversaId ?? null, e.oportunidadeId ?? null, ciclo.id, ctx.usuarioId, e.resultado, e.temperatura, e.estadoEmocional ?? null,
          JSON.stringify(e.sins), marco, e.interesseOfertaId ?? null, e.produtoOfertaId ?? null, e.proximaAcao, e.retornoEm ?? null, e.segundos ?? null,
        ],
      );
      const registroId = reg!.id;
      let reentradaId: string | null = null;
      let tarefas = 0;

      // Regra de Ouro: categoria, motivo (da categoria), comentário e a ação padrão aplicada pelo motor.
      if (e.break) {
        const [m] = await q<{ id: string; nome: string }>(tx, "SELECT id, nome FROM motivo_break WHERE id = $1 AND empresa_id = $2 AND categoria = $3 AND arquivado_em IS NULL", [
          e.break.motivoId,
          ctx.empresaId,
          e.break.categoria,
        ]);
        if (!m) throw invalido("Escolha um motivo da categoria do Break.");
        const acao = acaoPadraoBreak(e.break.categoria as CategoriaBreak);
        const [b] = await q<{ id: string }>(
          tx,
          `INSERT INTO break_bre (empresa_id, contato_id, registro_id, oportunidade_id, categoria, motivo_id, comentario, marco, acao_padrao, autor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [ctx.empresaId, c.id, registroId, e.oportunidadeId ?? null, e.break.categoria, m.id, e.break.comentario, marco, acao.texto, ctx.usuarioId],
        );
        await registrar(tx, origem, {
          acao: "bre.break_registrado",
          entidade: "contato",
          entidadeId: c.id,
          contatoId: c.id,
          depois: { categoria: e.break.categoria, motivo: m.nome, marco },
        });
        if (acao.reentrada) {
          reentradaId = await criarReentrada(tx, origem, {
            contatoId: c.id,
            tipo: acao.reentrada.tipo,
            previstaPara: acao.reentrada.dias === null ? null : await hojeMais(tx, acao.reentrada.dias),
            condicao: acao.reentrada.condicao,
            motivo: `Break ${e.break.categoria}: ${m.nome}`,
            breakId: b!.id,
          });
        }
      }

      if (encerrar) {
        await q(tx, "UPDATE ciclo_contato SET encerrado_em = now(), motivo_encerramento = $2, sem_resposta = $3 WHERE id = $1", [ciclo.id, encerrar.motivo, encerrar.semResposta]);
        if (encerrar.motivo === "MAX_ATTEMPTS" && !reentradaId) {
          reentradaId = await criarReentrada(tx, origem, {
            contatoId: c.id,
            tipo: "TIME",
            previstaPara: await hojeMais(tx, cfg.diasEntreCiclos),
            condicao: null,
            motivo: `Sem resposta em ${cfg.tentativasPorCiclo} tentativas`,
          });
        }
      }
      if (e.resultado === "OPTED_OUT") await q(tx, "UPDATE contato SET nao_contatar = true, atualizado_em = now() WHERE id = $1 AND empresa_id = $2", [c.id, ctx.empresaId]);

      const responsavel = c.responsavel_id ?? ctx.usuarioId;
      if (e.retornoEm && e.resultado !== "OPTED_OUT") {
        const nome = PROXIMAS_ACOES.find((a) => a.codigo === e.proximaAcao)!.nome;
        await criarTarefa(tx, origem, c.id, ctx.usuarioId, `Retorno: ${nome.toLowerCase()}`, e.retornoEm);
        tarefas++;
      }
      // BR-019: venda gera a agenda de pós-venda.
      if (e.resultado === "PURCHASED") {
        for (const dias of cfg.diasPosVenda) {
          await criarTarefa(tx, origem, c.id, responsavel, `Pós-venda D+${dias}`, await hojeMais(tx, dias));
          tarefas++;
        }
      }
      await registrar(tx, origem, {
        acao: "bre.conversa_registrada",
        entidade: "contato",
        entidadeId: c.id,
        contatoId: c.id,
        responsavelId: c.responsavel_id,
        depois: { resultado: e.resultado, temperatura: e.temperatura, proximaAcao: e.proximaAcao, retornoEm: e.retornoEm ?? null, cicloEncerrado: encerrar?.motivo ?? null },
      });
      return { id: registroId, cicloEncerrado: encerrar !== null, reentradaId, tarefas };
    });
  }

  // Configuração e motivos --------------------------------------------------------------------------

  async function config(ctx: ContextoEmpresa) {
    return comEmpresa(banco, ctx.empresaId, lerConfig);
  }

  async function salvarConfig(ctx: ContextoEmpresa, origem: Origem, mudancas: Partial<ConfigBre>) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { versao, ...antes } = await lerConfig(tx);
      const depois = ConfigBre.parse({ ...antes, ...mudancas });
      if (depois.recenteAte >= depois.inativoApos || depois.ativoAte >= depois.inativoApos) throw invalido("O limite de Inativo precisa ser maior que os de Recente e Ativo.");
      await q(
        tx,
        `INSERT INTO bre_config (empresa_id, config, versao) VALUES ($1, $2, 1)
         ON CONFLICT (empresa_id) DO UPDATE SET config = excluded.config, versao = bre_config.versao + 1, atualizado_em = now()`,
        [ctx.empresaId, JSON.stringify(depois)],
      );
      await registrar(tx, origem, { acao: "bre.config_alterada", entidade: "empresa", entidadeId: ctx.empresaId, antes, depois });
      return { ...depois, versao: versao + 1 };
    });
  }

  async function motivos(ctx: ContextoEmpresa) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      // Primeira vez: a empresa recebe os motivos padrão da doutrina e ajusta depois.
      const [{ n }] = (await q<{ n: number }>(tx, "SELECT count(*)::int AS n FROM motivo_break WHERE empresa_id = $1", [ctx.empresaId])) as [{ n: number }];
      if (n === 0) {
        for (const [categoria, nomes] of Object.entries(MOTIVOS_BREAK_PADRAO)) {
          for (const nome of nomes) await q(tx, "INSERT INTO motivo_break (empresa_id, categoria, nome) VALUES ($1, $2, $3)", [ctx.empresaId, categoria, nome]);
        }
      }
      const linhas = await q<{ id: string; categoria: CategoriaBreak; nome: string; arquivado_em: Date | null }>(
        tx,
        "SELECT id, categoria, nome, arquivado_em FROM motivo_break WHERE empresa_id = $1 ORDER BY categoria, criado_em, nome",
        [ctx.empresaId],
      );
      return { itens: linhas.map((l) => ({ id: l.id, categoria: l.categoria, nome: l.nome, arquivadoEm: l.arquivado_em?.toISOString() ?? null })) };
    });
  }

  async function salvarMotivo(ctx: ContextoEmpresa, origem: Origem, id: string | null, d: { categoria?: CategoriaBreak; nome?: string; arquivado?: boolean }) {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      if (!id) {
        const [l] = await q<{ id: string }>(tx, "INSERT INTO motivo_break (empresa_id, categoria, nome) VALUES ($1, $2, $3) RETURNING id", [ctx.empresaId, d.categoria, d.nome]);
        id = l!.id;
      } else {
        const r = await tx.cliente.query(
          `UPDATE motivo_break SET nome = coalesce($3, nome),
             arquivado_em = CASE WHEN $4::boolean IS NULL THEN arquivado_em WHEN $4 THEN coalesce(arquivado_em, now()) ELSE NULL END
           WHERE id = $1 AND empresa_id = $2`,
          [id, ctx.empresaId, d.nome ?? null, d.arquivado ?? null],
        );
        if (!r.rowCount) throw naoEncontrado("Motivo");
      }
      await registrar(tx, origem, { acao: "bre.motivo_salvo", entidade: "motivo_break", entidadeId: id, depois: d });
    });
    return { ok: true as const };
  }

  // Listas -----------------------------------------------------------------------------------------

  async function breaks(ctx: ContextoEmpresa, escopo: Escopo, f: { contatoId?: string; cursor?: string; limite: number }) {
    const cursor = lerCursor(f.cursor);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .execute<{ id: string; contato_id: string; categoria: CategoriaBreak; motivo: string; comentario: string; marco: MarcoBre | null; acao_padrao: string; criado_em: Date }>(sql`
          SELECT b.id, b.contato_id, b.categoria, m.nome AS motivo, b.comentario, b.marco, b.acao_padrao, b.criado_em
          FROM break_bre b JOIN motivo_break m ON m.id = b.motivo_id JOIN contato c ON c.id = b.contato_id
          WHERE b.empresa_id = ${ctx.empresaId}
            ${f.contatoId ? sql`AND b.contato_id = ${f.contatoId}` : sql``}
            AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("c.responsavel_id"))})
            ${cursor ? sql`AND (b.criado_em, b.id) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : sql``}
          ORDER BY b.criado_em DESC, b.id DESC LIMIT ${f.limite + 1}`)
        .then((r) => r.rows.map((l) => ({ ...l, criado_em: new Date(l.criado_em) })));
      return paginar(linhas, f.limite, (l) => ({
        id: l.id,
        contatoId: l.contato_id,
        categoria: l.categoria,
        motivo: l.motivo,
        comentario: l.comentario,
        marco: l.marco,
        acaoPadrao: l.acao_padrao,
        criadoEm: l.criado_em.toISOString(),
      }));
    });
  }

  async function reentradas(ctx: ContextoEmpresa, escopo: Escopo, f: { status: string; cursor?: string; limite: number }): Promise<Pagina<ReentradaDto>> {
    const cursor = lerCursor(f.cursor);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .execute<{ id: string; contato_id: string; contato_nome: string; tipo: TipoReentrada; prevista_para: string | null; condicao: string | null; motivo: string; status: ReentradaDto["status"]; criado_em: Date }>(sql`
          SELECT r.id, r.contato_id, c.nome AS contato_nome, r.tipo, to_char(r.prevista_para, 'YYYY-MM-DD') AS prevista_para, r.condicao, r.motivo, r.status, r.criado_em
          FROM reentrada r JOIN contato c ON c.id = r.contato_id
          WHERE r.empresa_id = ${ctx.empresaId} AND r.status = ${f.status}
            AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("c.responsavel_id"))})
            ${cursor ? sql`AND (r.criado_em, r.id) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : sql``}
          ORDER BY r.criado_em DESC, r.id DESC LIMIT ${f.limite + 1}`)
        .then((r) => r.rows.map((l) => ({ ...l, criado_em: new Date(l.criado_em) })));
      return paginar(linhas, f.limite, (l) => ({
        id: l.id,
        contatoId: l.contato_id,
        contatoNome: l.contato_nome,
        tipo: l.tipo,
        previstaPara: l.prevista_para,
        condicao: l.condicao,
        motivo: l.motivo,
        status: l.status,
        criadoEm: l.criado_em.toISOString(),
      })) as Pagina<ReentradaDto>;
    });
  }

  async function programarReentrada(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, r: z.infer<typeof ReentradaEntrada>) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await contatoVisivel(tx, ctx, escopo, r.contatoId);
      const id = await criarReentrada(tx, origem, { contatoId: r.contatoId, tipo: r.tipo, previstaPara: r.previstaPara ?? null, condicao: r.condicao ?? null, motivo: r.motivo });
      return { id };
    });
  }

  async function concluirReentrada(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, status: "feita" | "cancelada") {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [r] = await q<{ contato_id: string }>(tx, "SELECT contato_id FROM reentrada WHERE id = $1 AND empresa_id = $2 AND status = 'pendente'", [id, ctx.empresaId]);
      if (!r) throw naoEncontrado("Reentrada pendente");
      await contatoVisivel(tx, ctx, escopo, r.contato_id);
      await q(tx, "UPDATE reentrada SET status = $2, atualizado_em = now() WHERE id = $1", [id, status]);
      await registrar(tx, origem, { acao: `bre.reentrada_${status}`, entidade: "contato", entidadeId: r.contato_id, contatoId: r.contato_id, depois: { reentradaId: id } });
    });
    return { ok: true as const };
  }

  /** BR-002: encerrar exige um dos 6 critérios e o checklist inteiro. */
  async function encerrar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, oportunidadeId: string, e: z.infer<typeof EncerramentoBreEntrada>) {
    const faltando = CHECKLIST_ENCERRAMENTO.filter((i) => !e.checklist[i.codigo]).map((i) => i.nome);
    if (faltando.length) throw invalido("Complete o checklist de encerramento antes de salvar.", { faltando });
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [o] = await tx.db
        .execute<{ id: string; contato_id: string }>(sql`
          SELECT id, contato_id FROM oportunidade WHERE id = ${oportunidadeId} AND empresa_id = ${ctx.empresaId} AND arquivado_em IS NULL
            AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("responsavel_id"))})`)
        .then((r) => r.rows);
      if (!o) throw naoEncontrado("{Oportunidade}");
      const registro = { criterio: e.criterio, temperatura: e.temperatura, checklist: e.checklist, por: ctx.usuarioId, em: new Date().toISOString() };
      await q(tx, "UPDATE oportunidade SET encerramento_bre = $2, atualizado_em = now() WHERE id = $1", [o.id, JSON.stringify(registro)]);
      if (e.criterio === "CUSTOMER_REQUESTED" || e.criterio === "CONTACT_BLOCKED") {
        await q(tx, "UPDATE contato SET nao_contatar = true, atualizado_em = now() WHERE id = $1", [o.contato_id]);
      }
      let reentradaId: string | null = null;
      if (e.reentrada) {
        reentradaId = await criarReentrada(tx, origem, { contatoId: o.contato_id, tipo: e.reentrada.tipo, previstaPara: e.reentrada.previstaPara ?? null, condicao: e.reentrada.condicao ?? null, motivo: e.reentrada.motivo });
      }
      await registrar(tx, origem, { acao: "bre.oportunidade_encerrada", entidade: "oportunidade", entidadeId: o.id, contatoId: o.contato_id, depois: registro });
      return { ok: true as const, reentradaId };
    });
  }

  /**
   * FR-022: quem pode ser contatado hoje, já sem os bloqueados pelos limites (mesmas regras de
   * bloqueioDeTentativa, em SQL para a lista inteira). Paginada por (criado_em, id) do contato.
   */
  async function filaDoDia(ctx: ContextoEmpresa, escopo: Escopo, f: { cursor?: string; limite: number }): Promise<Pagina<ItemFilaBreDto>> {
    const cursor = lerCursor(f.cursor);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const cfg = await lerConfig(tx);
      const linhas = await tx.db
        .execute<{ id: string; nome: string; telefone: string | null; estado_bre: ItemFilaBreDto["estado"]; reentrada_id: string | null; reentrada_motivo: string | null; criado_em: Date }>(sql`
          WITH hoje AS (SELECT (now() AT TIME ZONE fuso)::date AS d FROM empresa WHERE id = ${ctx.empresaId})
          SELECT c.id, c.nome, c.telefone, c.estado_bre, c.criado_em, r.id AS reentrada_id, r.motivo AS reentrada_motivo
          FROM contato c CROSS JOIN hoje
          LEFT JOIN LATERAL (SELECT id, motivo FROM reentrada WHERE empresa_id = ${ctx.empresaId} AND contato_id = c.id AND status = 'pendente' AND prevista_para <= hoje.d
                             ORDER BY prevista_para LIMIT 1) r ON true
          WHERE c.empresa_id = ${ctx.empresaId} AND c.arquivado_em IS NULL AND NOT c.nao_contatar
            AND (c.estado_bre IS NOT NULL OR r.id IS NOT NULL)
            AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("c.responsavel_id"))})
            AND NOT coalesce(c.estado_bre = 'RECENT' AND c.ultima_entrega_em + make_interval(hours => ${cfg.horasAntesDoPrimeiroContato}) > now(), false)
            AND NOT EXISTS (SELECT 1 FROM ciclo_contato k WHERE k.empresa_id = c.empresa_id AND k.contato_id = c.id AND k.encerrado_em IS NULL
                              AND k.ultima_tentativa_em > now() - make_interval(hours => ${cfg.horasEntreTentativas}))
            AND (r.id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ciclo_contato k WHERE k.empresa_id = c.empresa_id AND k.contato_id = c.id AND k.sem_resposta
                              AND k.encerrado_em > now() - make_interval(days => ${cfg.diasEntreCiclos})))
            ${cursor ? sql`AND (c.criado_em, c.id) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : sql``}
          ORDER BY c.criado_em DESC, c.id DESC LIMIT ${f.limite + 1}`)
        .then((r) => r.rows.map((l) => ({ ...l, criado_em: new Date(l.criado_em) })));
      const NOMES: Record<string, string> = { RECENT: "Cliente recente", ACTIVE: "Cliente ativo", ABOUT_TO_SLEEP: "Prestes a dormir", INACTIVE: "Inativo: reativar" };
      return paginar(linhas, f.limite, (l) => ({
        id: l.id,
        contatoId: l.id,
        nome: l.nome,
        telefone: l.telefone,
        estado: l.estado_bre,
        motivo: l.reentrada_motivo ? `Reentrada: ${l.reentrada_motivo}` : (NOMES[l.estado_bre ?? ""] ?? ""),
        reentradaId: l.reentrada_id,
        criadoEm: l.criado_em.toISOString(),
      })) as Pagina<ItemFilaBreDto>;
    });
  }

  // Rotinas (fila de jobs) ---------------------------------------------------------------------------

  const empresasComBre = () => comoSistema(banco, (tx) => q<{ id: string }>(tx, "SELECT id FROM empresa WHERE modulos ? 'bre'"));

  /** FR-021: recalcula o estado de cada cliente pelas vendas confirmadas e registra cada mudança. */
  async function classificar(empresaId: string) {
    return comEmpresa(banco, empresaId, async (tx) => {
      const cfg = await lerConfig(tx);
      const mudaram = await q<{ id: string; antes: string | null; depois: string | null }>(
        tx,
        `WITH hoje AS (SELECT (now() AT TIME ZONE fuso)::date AS d FROM empresa WHERE id = $1),
         v AS (SELECT contato_id, count(*)::int AS qtd, max(data_venda) AS ultima FROM venda WHERE empresa_id = $1 AND status = 'confirmada' GROUP BY contato_id),
         calc AS (
           SELECT c.id, c.estado_bre AS antes, v.qtd, v.ultima,
             CASE WHEN v.qtd IS NULL THEN NULL
                  WHEN hoje.d - v.ultima > $4 THEN 'INACTIVE'
                  WHEN v.qtd = 1 THEN CASE WHEN hoje.d - v.ultima <= $2 THEN 'RECENT' ELSE 'ABOUT_TO_SLEEP' END
                  WHEN hoje.d - v.ultima <= $3 THEN 'ACTIVE' ELSE 'ABOUT_TO_SLEEP' END AS depois
           FROM contato c CROSS JOIN hoje LEFT JOIN v ON v.contato_id = c.id
           WHERE c.empresa_id = $1 AND (v.contato_id IS NOT NULL OR c.estado_bre IS NOT NULL))
         UPDATE contato c SET compras_qtd = coalesce(calc.qtd, 0), ultima_entrega_em = calc.ultima, estado_bre = calc.depois,
           estado_bre_em = CASE WHEN calc.depois IS DISTINCT FROM calc.antes THEN now() ELSE c.estado_bre_em END
         FROM calc WHERE c.id = calc.id AND (calc.depois IS DISTINCT FROM calc.antes OR c.compras_qtd IS DISTINCT FROM coalesce(calc.qtd, 0) OR c.ultima_entrega_em IS DISTINCT FROM calc.ultima)
         RETURNING c.id, calc.antes, calc.depois`,
        [empresaId, cfg.recenteAte, cfg.ativoAte, cfg.inativoApos],
      );
      for (const m of mudaram.filter((x) => x.antes !== x.depois)) {
        await registrar(tx, ORIGEM_SISTEMA(empresaId), { acao: "bre.estado_cliente_alterado", entidade: "contato", entidadeId: m.id, contatoId: m.id, antes: { estado: m.antes }, depois: { estado: m.depois } });
      }
      return mudaram.length;
    });
  }

  /** BR-012: ciclo com tentativa sem resposta há N dias encerra sozinho e programa reentrada. */
  async function encerrarSilencios(empresaId: string) {
    return comEmpresa(banco, empresaId, async (tx) => {
      const cfg = await lerConfig(tx);
      const fechados = await q<{ id: string; contato_id: string }>(
        tx,
        `UPDATE ciclo_contato SET encerrado_em = now(), motivo_encerramento = 'SILENCE', sem_resposta = true
         WHERE empresa_id = $1 AND encerrado_em IS NULL AND tentativas > 0
           AND (ultima_resposta_em IS NULL OR ultima_resposta_em < ultima_tentativa_em)
           AND ultima_tentativa_em < now() - make_interval(days => $2)
         RETURNING id, contato_id`,
        [empresaId, cfg.diasSilencioEncerra],
      );
      for (const f of fechados) {
        await criarReentrada(tx, ORIGEM_SISTEMA(empresaId), {
          contatoId: f.contato_id,
          tipo: "TIME",
          previstaPara: await hojeMais(tx, cfg.diasEntreCiclos),
          condicao: null,
          motivo: `Sem resposta por ${cfg.diasSilencioEncerra} dias`,
        });
      }
      return fechados.length;
    });
  }

  async function rotinaDiaria() {
    for (const e of await empresasComBre()) await classificar(e.id);
  }
  async function rotinaHoraria() {
    for (const e of await empresasComBre()) await encerrarSilencios(e.id);
  }

  return {
    registrarConversa,
    config,
    salvarConfig,
    motivos,
    salvarMotivo,
    breaks,
    reentradas,
    programarReentrada,
    concluirReentrada,
    encerrar,
    filaDoDia,
    classificar,
    encerrarSilencios,
    rotinaDiaria,
    rotinaHoraria,
    padrao: CONFIG_BRE_PADRAO,
  };
}
