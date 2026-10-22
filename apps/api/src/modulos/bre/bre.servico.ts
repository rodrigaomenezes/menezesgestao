// Motor BRE sem IA (fase 8.1, ETR BRE-ETR-001 v0.2). Regras determinísticas: registro de 30 s, ciclo de contato
// (tentativas e silêncio), limites de frequência, Regra de Ouro do Break, reentradas, encerramento guiado, pós-venda
// e o estado diário do cliente. Os números vêm de bre_config (cada empresa ajusta); os códigos são da doutrina.
import {
  CHECKLIST_ENCERRAMENTO,
  CONFIG_BRE_PADRAO,
  ConfigBre,
  ESCALONAMENTOS,
  MOTIVOS_BREAK_PADRAO,
  PROXIMAS_ACOES,
  acaoPadraoBreak,
  mascararDadosPessoais,
  type CategoriaBreak,
  type Escopo,
  type ConcordanciaDto,
  type EscalonamentoDto,
  type InteligenciaContatoDto,
  type ItemFilaBreDto,
  type MarcoBre,
  type Pagina,
  type ReentradaDto,
  type RegistroBreEntrada,
  type SituacaoEscalonamento,
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
import { notificar } from "../notificacoes/notificar.js";
import type { AnaliseBreDto, EncerramentoBreEntrada, ReentradaEntrada, SaidaIaBre } from "@mg/shared";
import { ZodError } from "zod";
import { criarProvedorIaBre, IaIndisponivel, type MensagemAnalise, type ProvedorIaBre, type ResultadoIa } from "./ia.js";

/** Versão da doutrina aplicada nas análises (BRE-FR-017). */
export const VERSAO_DOUTRINA = "BRE-v1.0 / ETR 0.2";

/** Fila dos pedidos à IA (análise da conversa e prévia do SQ-BRE). */
export const FILA_BRE_IA = "bre.ia";
/** Pedido parado na fila por mais que isto conta como falha (o job pode ter esgotado as tentativas). */
const EXPIRA_IA_MS = 10 * 60_000;
export const IA_SEM_RESPOSTA = "A IA não respondeu a tempo. Tente de novo ou preencha manualmente.";
export const expirada = (status: string, criadoEm: Date) => status === "processando" && Date.now() - new Date(criadoEm).getTime() > EXPIRA_IA_MS;

import { marcarBpiVelho } from "./bpi-cache.js";
export { marcarBpiVelho };

/** Robustez: limite de pedidos à IA por hora na empresa (sugestões + prévias do SQ-BRE). */
export async function exigirLimiteIa(tx: Tx): Promise<void> {
  const { limiteIaPorHora } = await lerConfig(tx);
  const [r] = await q<{ n: number }>(
    tx,
    `SELECT (SELECT count(*) FROM analise_bre WHERE empresa_id = $1 AND criado_em > now() - interval '1 hour')
          + (SELECT count(*) FROM sq_bre WHERE empresa_id = $1 AND criado_em > now() - interval '1 hour') AS n`,
    [tx.empresaId],
  );
  if (Number(r!.n) >= limiteIaPorHora) throw invalido(`A empresa chegou ao limite de ${limiteIaPorHora} análises de IA por hora. Tente de novo mais tarde ou preencha manualmente.`);
}

type Linha = Record<string, unknown>;
const ORIGEM_SISTEMA = (empresaId: string): Origem => ({ empresaId, atorId: null, ip: null, dispositivo: "motor-bre" });

export async function q<T extends Linha>(tx: Tx, texto: string, valores: unknown[] = []): Promise<T[]> {
  return (await tx.cliente.query(texto, valores)).rows as T[];
}

/** Página por (criado_em, id), da mais recente para a mais antiga. */
export function paginar<T, D>(linhas: (T & { criado_em: Date; id: string })[], limite: number, dto: (l: T & { criado_em: Date; id: string }) => D): Pagina<D> {
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

/**
 * As últimas 100 mensagens de texto da conversa, em ordem, como a IA lê (cliente × atendente). Com a opção da
 * empresa ligada (DEC-009), os dados pessoais saem trocados por marcadores.
 */
export async function mensagensDaConversa(tx: Tx, conversaId: string): Promise<MensagemAnalise[]> {
  const { mascararDadosIa } = await lerConfig(tx);
  const nomes = mascararDadosIa
    ? (await q<{ nome: string }>(tx, "SELECT c.nome FROM conversa v JOIN contato c ON c.id = v.contato_id WHERE v.id = $1", [conversaId])).map((c) => c.nome)
    : [];
  const linhas = await q<{ direcao: string; texto: string }>(
    tx,
    `SELECT direcao, texto FROM (SELECT direcao, texto, criado_em FROM mensagem
       WHERE conversa_id = $1 AND empresa_id = $2 AND tipo = 'texto' AND direcao IN ('entrada','saida') AND texto IS NOT NULL
       ORDER BY criado_em DESC LIMIT 100) m ORDER BY criado_em`,
    [conversaId, tx.empresaId],
  );
  return linhas.map((m) => ({ de: m.direcao === "entrada" ? "cliente" : "atendente", texto: mascararDadosIa ? mascararDadosPessoais(m.texto, nomes) : m.texto }));
}

/**
 * Por que uma nova tentativa ativa não pode acontecer agora (BR-012, BR-013, BR-014, BR-015), ou null.
 * Data combinada com o cliente (reentrada ou retorno vencendo hoje) prevalece sobre o limite entre ciclos.
 */
export async function bloqueioDeTentativa(tx: Tx, c: { id: string; nao_contatar: boolean; estado_bre: string | null; ultima_entrega_em: string | null }, cfg: ConfigBre): Promise<string | null> {
  if (c.nao_contatar) return "{O contato} pediu para não ser contatad{o|a:contato}. Só fale de novo quando {o contato} mandar mensagem.";
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
  if (r!.cedo) return `{Contato} recente: o primeiro contato só ${cfg.horasAntesDoPrimeiroContato} horas depois da entrega.`;
  if (r!.espera) return `Aguarde ${cfg.horasEntreTentativas} horas desde a última tentativa antes de abordar de novo.`;
  if (r!.entre_ciclos && !r!.combinado) return `{Este contato} não respondeu ao último ciclo. Novo contato só ${cfg.diasEntreCiclos} dias depois, ou na data combinada com {ele|ela:contato}.`;
  return null;
}

export function criarServicoBre(s: Servicos, ia?: ProvedorIaBre) {
  const { banco } = s;
  let provedor = ia;

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

  async function criarTarefa(tx: Tx, origem: Origem, contatoId: string, responsavelId: string, titulo: string, venceEm: string, tipo: "retorno" | "pos_venda") {
    await q(
      tx,
      `INSERT INTO tarefa (empresa_id, contato_id, titulo, responsavel_id, vence_em, criado_por, origem_bre)
       VALUES ($1, $2, $3, $4, ($5::date + time '09:00') AT TIME ZONE (SELECT fuso FROM empresa WHERE id = $1), $6, $7)`,
      [tx.empresaId, contatoId, titulo, responsavelId, venceEm, origem.atorId, tipo],
    );
  }

  /**
   * BR-017: abre o escalonamento (um aberto por cliente × situação) e avisa quem responde pelo cliente e o gestor
   * da equipe dele. Enquanto estiver aberto, as automações não mandam mensagem para esse cliente.
   */
  async function abrirEscalonamento(
    tx: Tx,
    origem: Origem,
    e: { contatoId: string; conversaId: string | null; situacao: SituacaoEscalonamento; origem: "ia" | "manual"; observacao?: string | null },
  ): Promise<string | null> {
    const [l] = await q<{ id: string }>(
      tx,
      `INSERT INTO escalonamento (empresa_id, contato_id, conversa_id, situacao, origem, observacao, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (empresa_id, contato_id, situacao) WHERE status = 'aberto' DO NOTHING RETURNING id`,
      [tx.empresaId, e.contatoId, e.conversaId, e.situacao, e.origem, e.observacao ?? null, origem.atorId],
    );
    if (!l) return null;
    const destinos = await q<{ usuario_id: string; nome: string }>(
      tx,
      `SELECT DISTINCT d.usuario_id, c.nome FROM contato c
         CROSS JOIN LATERAL (
           SELECT c.responsavel_id AS usuario_id
           UNION SELECT eq.gestor_id FROM vinculo v JOIN equipe eq ON eq.id = v.equipe_id
            WHERE v.empresa_id = c.empresa_id AND v.usuario_id = c.responsavel_id AND v.status = 'ativo' AND v.arquivado_em IS NULL AND eq.arquivado_em IS NULL
         ) d
       WHERE c.id = $1 AND c.empresa_id = $2 AND d.usuario_id IS NOT NULL`,
      [e.contatoId, tx.empresaId],
    );
    const nomeSituacao = ESCALONAMENTOS.find((x) => x.codigo === e.situacao)!.nome;
    for (const d of destinos) {
      await notificar(tx, origem, { usuarioId: d.usuario_id, titulo: `Precisa de uma pessoa: ${nomeSituacao}`, texto: d.nome, link: "/bre" });
    }
    await registrar(tx, origem, {
      acao: "bre.escalonamento_aberto",
      entidade: "contato",
      entidadeId: e.contatoId,
      contatoId: e.contatoId,
      depois: { escalonamentoId: l.id, situacao: e.situacao, origem: e.origem },
    });
    return l.id;
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
        await criarTarefa(tx, origem, c.id, ctx.usuarioId, `Retorno: ${nome.toLowerCase()}`, e.retornoEm, "retorno");
        tarefas++;
      }
      // BR-019: venda gera a agenda de pós-venda.
      if (e.resultado === "PURCHASED") {
        for (const dias of cfg.diasPosVenda) {
          await criarTarefa(tx, origem, c.id, responsavel, `Pós-venda D+${dias}`, await hojeMais(tx, dias), "pos_venda");
          tarefas++;
        }
      }
      if (e.escalonamento) {
        await abrirEscalonamento(tx, origem, { contatoId: c.id, conversaId: e.conversaId ?? null, situacao: e.escalonamento, origem: "manual" });
      }
      await marcarBpiVelho(tx);
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
      const NOMES: Record<string, string> = { RECENT: "Primeiro contato depois da entrega", ACTIVE: "Manter o relacionamento", ABOUT_TO_SLEEP: "Reativar antes de esfriar", INACTIVE: "Reativar" };
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

  /**
   * Pede a análise da conversa à IA (fase 8.2, pela fila de jobs desde a 8.5). Valida na hora — quem pediu "não
   * contatar" ou foi anonimizado nunca vai para a IA; limite por hora da empresa — e devolve a análise "processando".
   * O trabalhador preenche a sugestão e avisa quem pediu em tempo real.
   */
  async function pedirAnalise(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, conversaId: string): Promise<AnaliseBreDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [conv] = await q<{ contato_id: string | null }>(tx, "SELECT contato_id FROM conversa WHERE id = $1 AND empresa_id = $2", [conversaId, ctx.empresaId]);
      if (!conv?.contato_id) throw naoEncontrado("Conversa");
      const c = await contatoVisivel(tx, ctx, escopo, conv.contato_id);
      const [extra] = await q<{ anonimizado: boolean }>(tx, "SELECT anonimizado_em IS NOT NULL AS anonimizado FROM contato WHERE id = $1", [c.id]);
      if (c.nao_contatar || extra!.anonimizado) throw invalido("{Este contato} pediu para não ser contatad{o|a:contato} ou foi anonimizad{o|a:contato}: a conversa não vai para a IA.");
      await exigirLimiteIa(tx);
      const [l] = await q<{ id: string }>(
        tx,
        "INSERT INTO analise_bre (empresa_id, conversa_id, contato_id, provedor, doutrina, status, autor_id) VALUES ($1, $2, $3, '', $4, 'processando', $5) RETURNING id",
        [ctx.empresaId, conversaId, c.id, VERSAO_DOUTRINA, ctx.usuarioId],
      );
      await s.jobs.enfileirar(tx, FILA_BRE_IA, { empresaId: ctx.empresaId, tipo: "analise", id: l!.id });
      await registrar(tx, origem, { acao: "bre.analise_pedida", entidade: "analise_bre", entidadeId: l!.id, contatoId: c.id, depois: { conversaId } });
      return { id: l!.id, status: "processando" as const, provedor: null, erro: null, sugestao: null };
    });
  }

  async function obterAnalise(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<AnaliseBreDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [a] = await q<{ contato_id: string; status: "processando" | "pronta" | "falhou"; provedor: string; erro: string | null; saida: SaidaIaBre | null; bloqueios: string[]; criado_em: Date }>(
        tx,
        "SELECT contato_id, status, provedor, erro, saida, bloqueios, criado_em FROM analise_bre WHERE id = $1 AND empresa_id = $2",
        [id, ctx.empresaId],
      );
      if (!a) throw naoEncontrado("Análise");
      await contatoVisivel(tx, ctx, escopo, a.contato_id);
      const status = expirada(a.status, a.criado_em) ? "falhou" : a.status;
      return {
        id,
        status,
        provedor: a.provedor || null,
        erro: status === "falhou" ? (a.erro ?? IA_SEM_RESPOSTA) : null,
        sugestao: a.status === "pronta" && a.saida ? { ...a.saida, bloqueios: a.bloqueios } : null,
      };
    });
  }

  /**
   * Trabalhador da fila: chama a IA fora de qualquer transação, aplica os filtros das regras e guarda o resultado.
   * Recusa ou resposta fora do contrato vira "falhou" com o motivo; erro passageiro (rede, limite do provedor) sobe
   * para a fila tentar de novo.
   */
  async function processarAnalise(empresaId: string, id: string): Promise<void> {
    const dados = await comEmpresa(banco, empresaId, async (tx) => {
      const [a] = await q<{ conversa_id: string; contato_id: string; autor_id: string; status: string }>(
        tx,
        "SELECT conversa_id, contato_id, autor_id, status FROM analise_bre WHERE id = $1 AND empresa_id = $2",
        [id, empresaId],
      );
      if (!a || a.status !== "processando") return null;
      const [c] = await q<{ estado_bre: string | null; diagnostico: boolean }>(
        tx,
        `SELECT c.estado_bre, EXISTS (SELECT 1 FROM oportunidade o JOIN etapa e ON e.id = o.etapa_id
                  WHERE o.empresa_id = c.empresa_id AND o.contato_id = c.id AND e.marco_bre IN ('INTEREST','PROPOSAL','NEGOTIATION','SALE')) AS diagnostico
         FROM contato c WHERE c.id = $1`,
        [a.contato_id],
      );
      return { ...a, estado: c?.estado_bre ?? null, diagnostico: Boolean(c?.diagnostico), mensagens: await mensagensDaConversa(tx, a.conversa_id) };
    });
    if (!dados) return;

    provedor ??= criarProvedorIaBre(s.config);
    const inicio = Date.now();
    let resultado: ResultadoIa;
    try {
      resultado = await provedor.analisar(dados.mensagens);
    } catch (err) {
      if (!(err instanceof IaIndisponivel) && !(err instanceof ZodError)) throw err; // passageiro: a fila tenta de novo
      const erro = err instanceof IaIndisponivel ? err.message : "A IA devolveu uma resposta fora do formato. Preencha o registro manualmente.";
      await comEmpresa(banco, empresaId, async (tx) => {
        await q(tx, "UPDATE analise_bre SET status = 'falhou', erro = $2, provedor = $3, ms = $4, concluida_em = now() WHERE id = $1 AND status = 'processando'", [
          id,
          erro,
          provedor!.nome,
          Date.now() - inicio,
        ]);
        await registrar(tx, ORIGEM_SISTEMA(empresaId), { acao: "bre.analise_falhou", entidade: "analise_bre", entidadeId: id, contatoId: dados.contato_id, paraUsuarioId: dados.autor_id, depois: { erro } });
      });
      return;
    }

    let saida = resultado.saida;
    const bloqueios: string[] = [];
    if (saida.sugereDesconto && dados.estado === "RECENT") {
      saida = { ...saida, sugereDesconto: false };
      bloqueios.push("Desconto não sugerido: no estado Recente nunca há desconto.");
    } else if (saida.sugereDesconto && !dados.diagnostico) {
      saida = { ...saida, sugereDesconto: false };
      bloqueios.push("Desconto não sugerido: só depois do diagnóstico concluído.");
    }
    if (saida.sugereOferta && saida.sins.length < 3) {
      saida = { ...saida, sugereOferta: false };
      bloqueios.push("Oferta não sugerida: faltam os três \"sim\" (confirmação, concordância e visualização).");
    }

    await comEmpresa(banco, empresaId, async (tx) => {
      const r = await tx.cliente.query(
        `UPDATE analise_bre SET status = 'pronta', provedor = $2, saida = $3, bloqueios = $4, ms = $5, tokens_entrada = $6, tokens_saida = $7, concluida_em = now()
         WHERE id = $1 AND status = 'processando'`,
        [id, provedor!.nome, JSON.stringify(saida), JSON.stringify(bloqueios), Date.now() - inicio, resultado.tokens?.entrada ?? null, resultado.tokens?.saida ?? null],
      );
      if (!r.rowCount) return; // outra execução já concluiu
      const origem = ORIGEM_SISTEMA(empresaId);
      if (saida.escalonamento) {
        await abrirEscalonamento(tx, origem, { contatoId: dados.contato_id, conversaId: dados.conversa_id, situacao: saida.escalonamento, origem: "ia", observacao: saida.resumo.slice(0, 500) });
      }
      await registrar(tx, origem, {
        acao: "bre.analise_pronta",
        entidade: "analise_bre",
        entidadeId: id,
        contatoId: dados.contato_id,
        paraUsuarioId: dados.autor_id,
        depois: { conversaId: dados.conversa_id, provedor: provedor!.nome, resultado: saida.resultado, bloqueios },
      });
    });
  }

  async function escalonamentos(ctx: ContextoEmpresa, escopo: Escopo, f: { status: string; cursor?: string; limite: number }): Promise<Pagina<EscalonamentoDto>> {
    const cursor = lerCursor(f.cursor);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .execute<{ id: string; contato_id: string; contato_nome: string; conversa_id: string | null; situacao: SituacaoEscalonamento; origem: "ia" | "manual"; observacao: string | null; status: "aberto" | "resolvido"; criado_em: Date }>(sql`
          SELECT x.id, x.contato_id, c.nome AS contato_nome, x.conversa_id, x.situacao, x.origem, x.observacao, x.status, x.criado_em
          FROM escalonamento x JOIN contato c ON c.id = x.contato_id
          WHERE x.empresa_id = ${ctx.empresaId} AND x.status = ${f.status}
            AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("c.responsavel_id"))})
            ${cursor ? sql`AND (x.criado_em, x.id) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : sql``}
          ORDER BY x.criado_em DESC, x.id DESC LIMIT ${f.limite + 1}`)
        .then((r) => r.rows.map((l) => ({ ...l, criado_em: new Date(l.criado_em) })));
      return paginar(linhas, f.limite, (l) => ({
        id: l.id,
        contatoId: l.contato_id,
        contatoNome: l.contato_nome,
        conversaId: l.conversa_id,
        situacao: l.situacao,
        origem: l.origem,
        observacao: l.observacao,
        status: l.status,
        criadoEm: l.criado_em.toISOString(),
      }));
    });
  }

  async function resolverEscalonamento(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string) {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [x] = await q<{ contato_id: string }>(tx, "SELECT contato_id FROM escalonamento WHERE id = $1 AND empresa_id = $2 AND status = 'aberto'", [id, ctx.empresaId]);
      if (!x) throw naoEncontrado("Escalonamento aberto");
      await contatoVisivel(tx, ctx, escopo, x.contato_id);
      await q(tx, "UPDATE escalonamento SET status = 'resolvido', resolvido_por = $2, resolvido_em = now() WHERE id = $1", [id, ctx.usuarioId]);
      await registrar(tx, origem, { acao: "bre.escalonamento_resolvido", entidade: "contato", entidadeId: x.contato_id, contatoId: x.contato_id, depois: { escalonamentoId: id } });
    });
    return { ok: true as const };
  }

  /** FR-006: dos campos de inteligência da empresa, quais o cliente já tem e quais faltam. */
  async function inteligenciaDoContato(ctx: ContextoEmpresa, escopo: Escopo, contatoId: string): Promise<InteligenciaContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await contatoVisivel(tx, ctx, escopo, contatoId);
      const campos = await q<{ rotulo: string; preenchido: boolean }>(
        tx,
        `SELECT f.rotulo, coalesce(c.campos->>f.chave, '') <> '' AS preenchido
         FROM campo_personalizado f JOIN contato c ON c.id = $2 AND c.empresa_id = f.empresa_id
         WHERE f.empresa_id = $1 AND f.entidade = 'contato' AND f.inteligencia_bre AND f.arquivado_em IS NULL
         ORDER BY f.ordem, f.rotulo`,
        [ctx.empresaId, contatoId],
      );
      return { campos: campos.length, preenchidos: campos.filter((c) => c.preenchido).length, faltando: campos.filter((c) => !c.preenchido).map((c) => c.rotulo) };
    });
  }

  /**
   * DEC-010: na amostra mais recente, quanto a sugestão da IA bateu com o que a pessoa registrou (resultado,
   * temperatura e categoria do Break) e com a nota SQ-BRE confirmada (até 5 pontos). A automação só se libera com
   * amostra mínima, o percentual da empresa em todos os campos e nenhuma sugestão barrada pelas regras.
   */
  async function concordancia(ctx: ContextoEmpresa): Promise<ConcordanciaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const cfg = await lerConfig(tx);
      const pares = await q<{ resultado: boolean; temperatura: boolean; categoria: boolean; bloqueio: boolean }>(
        tx,
        `SELECT a.saida->>'resultado' = r.resultado AS resultado, a.saida->>'temperatura' = r.temperatura AS temperatura,
                coalesce(a.saida->'break'->>'categoria', '') = coalesce((SELECT b.categoria FROM break_bre b WHERE b.registro_id = r.id LIMIT 1), '') AS categoria,
                jsonb_array_length(a.bloqueios) > 0 AS bloqueio
         FROM registro_bre r
         JOIN LATERAL (SELECT saida, bloqueios FROM analise_bre x WHERE x.empresa_id = r.empresa_id AND x.conversa_id = r.conversa_id AND x.criado_em <= r.criado_em
                         AND x.status = 'pronta'
                       ORDER BY x.criado_em DESC LIMIT 1) a ON true
         WHERE r.empresa_id = $1 AND r.conversa_id IS NOT NULL
         ORDER BY r.criado_em DESC LIMIT $2`,
        [ctx.empresaId, cfg.amostraParaAutomacao],
      );
      const sq = await q<{ perto: boolean }>(
        tx,
        "SELECT abs(nota_previa - nota) <= 5 AS perto FROM sq_bre WHERE empresa_id = $1 AND nota IS NOT NULL AND nota_previa IS NOT NULL ORDER BY confirmada_em DESC LIMIT $2",
        [ctx.empresaId, cfg.amostraParaAutomacao],
      );
      const campo = (campoId: string, nome: string, valores: boolean[]) => ({
        campo: campoId,
        nome,
        pares: valores.length,
        iguais: valores.filter(Boolean).length,
        percentual: valores.length ? Math.round((valores.filter(Boolean).length / valores.length) * 1000) / 10 : null,
      });
      const campos = [
        campo("resultado", "Resultado do contato", pares.map((p) => p.resultado)),
        campo("temperatura", "Temperatura", pares.map((p) => p.temperatura)),
        campo("categoria", "Categoria do Break", pares.map((p) => p.categoria)),
        campo("sqBre", "Nota SQ-BRE (até 5 pontos)", sq.map((s) => s.perto)),
      ];
      const comBloqueio = pares.filter((p) => p.bloqueio).length;
      const curto = campos.find((c) => c.pares < cfg.amostraParaAutomacao);
      const baixo = campos.find((c) => (c.percentual ?? 0) < cfg.concordanciaParaAutomacao);
      const motivo = curto
        ? `Amostra ainda pequena em "${curto.nome}": ${curto.pares} de ${cfg.amostraParaAutomacao}.`
        : baixo
          ? `"${baixo.nome}" está em ${baixo.percentual}%, abaixo dos ${cfg.concordanciaParaAutomacao}% definidos.`
          : comBloqueio
            ? `${comBloqueio} sugestão(ões) da IA foram barradas pelas regras na amostra.`
            : "A IA atingiu a concordância definida em todos os campos.";
      return {
        amostraMinima: cfg.amostraParaAutomacao,
        percentualMinimo: cfg.concordanciaParaAutomacao,
        campos,
        analises: pares.length,
        analisesComBloqueio: comBloqueio,
        liberado: !curto && !baixo && !comBloqueio,
        motivo,
      };
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
    pedirAnalise,
    obterAnalise,
    processarAnalise,
    inteligenciaDoContato,
    concordancia,
    escalonamentos,
    resolverEscalonamento,
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
