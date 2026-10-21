// Desempenho no método BRE (fase 8.2): SQ-BRE dentro da Qualidade (prévia da IA + confirmação do supervisor),
// BPI por pessoa com ranking e o alerta de coaching. As notas saem dos registros que já existem (vendas, funil,
// registros de conversa, tarefas do motor e SQ-BRE confirmados): nada é digitado à parte.
import {
  PILARES_BPI,
  calcularBpi,
  contraMeta,
  faixaBpi,
  faixaSq,
  somaSq,
  type BpiDto,
  type Escopo,
  type NotasBpi,
  type NotasSq,
  type Pagina,
  type PilarBpi,
  type SqBreDto,
} from "@mg/shared";
import { sql } from "drizzle-orm";
import type { Servicos } from "../../app.js";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { lerCursor } from "../../infra/paginacao.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { notificar } from "../notificacoes/notificar.js";
import { exigirPessoa } from "../operacao/comum.js";
import { lerConfig, mensagensDaConversa, paginar, q } from "./bre.servico.js";
import { criarProvedorIaBre, IaIndisponivel, type ProvedorIaBre } from "./ia.js";

const LIMITE_COACHING = 70;
const ORIGEM_SISTEMA = (empresaId: string): Origem => ({ empresaId, atorId: null, ip: null, dispositivo: "motor-bre" });

type LinhaSq = {
  id: string;
  conversa_id: string;
  avaliado_id: string;
  avaliado_nome: string;
  contato_nome: string | null;
  provedor: string;
  previa: NotasSq;
  nota_previa: number;
  confirmada: NotasSq | null;
  nota: number | null;
  feedback: string | null;
  criado_em: Date;
};

const dtoSq = (l: LinhaSq): SqBreDto => ({
  id: l.id,
  conversaId: l.conversa_id,
  avaliadoId: l.avaliado_id,
  avaliadoNome: l.avaliado_nome,
  contatoNome: l.contato_nome,
  provedor: l.provedor,
  previa: l.previa,
  notaPrevia: l.nota_previa,
  confirmada: l.confirmada,
  nota: l.nota,
  faixa: l.nota === null ? null : faixaSq(l.nota),
  feedback: l.feedback,
  status: l.nota === null ? "previa" : "confirmada",
  criadoEm: new Date(l.criado_em).toISOString(),
});

const SELECT_SQ = `SELECT s.id, s.conversa_id, s.avaliado_id, u.nome AS avaliado_nome, c.nome AS contato_nome, s.provedor, s.previa,
    s.nota_previa, s.confirmada, s.nota, s.feedback, s.criado_em
  FROM sq_bre s JOIN usuario u ON u.id = s.avaliado_id JOIN conversa v ON v.id = s.conversa_id LEFT JOIN contato c ON c.id = v.contato_id`;

/**
 * Notas dos 5 pilares do BPI para cada pessoa no período [inicio, fim) — datas no fuso da empresa.
 * Pilar sem dados no período fica null (sai do BPI, ETR 6.2). A meta mensal de receita vale proporcional aos dias.
 */
export async function notasBpi(tx: Tx, usuarioIds: string[], inicio: string, fim: string, metaReceitaCentavos: number | null): Promise<Map<string, NotasBpi>> {
  const dia = (col: string) => `(${col} AT TIME ZONE (SELECT fuso FROM empresa WHERE id = $1))::date`;
  const p = [tx.empresaId, usuarioIds, inicio, fim];
  const [receita, pipeline, inteligencia, qualidade, relacionamento] = await Promise.all([
    q<{ u: string; total: string }>(
      tx,
      `SELECT vendedor_id AS u, sum(valor_centavos) AS total FROM venda
       WHERE empresa_id = $1 AND vendedor_id = ANY($2) AND status = 'confirmada' AND data_venda >= $3::date AND data_venda < $4::date GROUP BY 1`,
      p,
    ),
    // D-13: avançaram ≥ 1 etapa no período ÷ abertas no início do período.
    q<{ u: string; abertas: number; avancaram: number }>(
      tx,
      `SELECT o.responsavel_id AS u, count(*)::int AS abertas,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM evento ev JOIN etapa na ON na.id = (ev.dados->>'etapaNovaId')::uuid JOIN etapa ant ON ant.id = (ev.dados->>'etapaAnteriorId')::uuid
           WHERE ev.empresa_id = $1 AND ev.tipo = 'oportunidade.etapa_alterada' AND ev.entidade_id = o.id
             AND ${dia("ev.criado_em")} >= $3::date AND ${dia("ev.criado_em")} < $4::date AND na.ordem > ant.ordem))::int AS avancaram
       FROM oportunidade o
       WHERE o.empresa_id = $1 AND o.responsavel_id = ANY($2) AND ${dia("o.criado_em")} < $3::date
         AND (o.fechada_em IS NULL OR ${dia("o.fechada_em")} >= $3::date) AND o.arquivado_em IS NULL
       GROUP BY 1`,
      p,
    ),
    // Completude = campos opcionais preenchidos ÷ 4; enriquecimento = registros que trouxeram algum dado novo.
    q<{ u: string; n: number; completude: string; enriquecidos: number }>(
      tx,
      `SELECT r.autor_id AS u, count(*)::int AS n,
         avg(((r.estado_emocional IS NOT NULL)::int + (r.interesse_oferta_id IS NOT NULL)::int + (r.produto_oferta_id IS NOT NULL)::int
              + (jsonb_array_length(r.sins) > 0)::int) / 4.0) AS completude,
         count(*) FILTER (WHERE r.interesse_oferta_id IS NOT NULL OR r.produto_oferta_id IS NOT NULL OR r.estado_emocional IS NOT NULL
                            OR EXISTS (SELECT 1 FROM break_bre b WHERE b.registro_id = r.id))::int AS enriquecidos
       FROM registro_bre r
       WHERE r.empresa_id = $1 AND r.autor_id = ANY($2) AND ${dia("r.criado_em")} >= $3::date AND ${dia("r.criado_em")} < $4::date GROUP BY 1`,
      p,
    ),
    q<{ u: string; media: string }>(
      tx,
      `SELECT avaliado_id AS u, avg(nota) AS media FROM sq_bre
       WHERE empresa_id = $1 AND avaliado_id = ANY($2) AND nota IS NOT NULL AND ${dia("confirmada_em")} >= $3::date AND ${dia("confirmada_em")} < $4::date GROUP BY 1`,
      p,
    ),
    // Follow-ups do motor que venceram no período (até agora): feitos até o dia do vencimento ÷ total.
    q<{ u: string; total: number; no_prazo: number }>(
      tx,
      `SELECT responsavel_id AS u, count(*)::int AS total,
         count(*) FILTER (WHERE concluida_em IS NOT NULL AND ${dia("concluida_em")} <= ${dia("vence_em")})::int AS no_prazo
       FROM tarefa
       WHERE empresa_id = $1 AND responsavel_id = ANY($2) AND origem_bre IS NOT NULL AND arquivado_em IS NULL
         AND ${dia("vence_em")} >= $3::date AND ${dia("vence_em")} < $4::date AND vence_em < now() GROUP BY 1`,
      p,
    ),
  ]);
  // A meta é mensal: num período menor (a semana do coaching), vale a fração dos dias.
  const dias = (Date.parse(fim) - Date.parse(inicio)) / 864e5;
  const diasDoMes = new Date(Date.UTC(Number(inicio.slice(0, 4)), Number(inicio.slice(5, 7)), 0)).getUTCDate();
  const metaDoPeriodo = metaReceitaCentavos ? (metaReceitaCentavos * Math.min(dias, diasDoMes)) / diasDoMes : null;
  // Com campos de inteligência configurados, a completude é sobre eles: média, por cliente atendido no período,
  // dos campos preenchidos ÷ campos de inteligência (D-13).
  const chaves = (await q<{ chave: string }>(tx, "SELECT chave FROM campo_personalizado WHERE empresa_id = $1 AND entidade = 'contato' AND inteligencia_bre AND arquivado_em IS NULL", [tx.empresaId])).map((c) => c.chave);
  const completudeCampos = chaves.length
    ? new Map(
        (
          await q<{ u: string; completude: string }>(
            tx,
            `SELECT r.autor_id AS u, avg(x.preenchidos::numeric / $5) AS completude
             FROM (SELECT DISTINCT autor_id, contato_id FROM registro_bre
                   WHERE empresa_id = $1 AND autor_id = ANY($2) AND ${dia("criado_em")} >= $3::date AND ${dia("criado_em")} < $4::date) r
             JOIN contato c ON c.id = r.contato_id
             CROSS JOIN LATERAL (SELECT count(*) FILTER (WHERE coalesce(c.campos->>k, '') <> '') AS preenchidos FROM unnest($6::text[]) k) x
             GROUP BY 1`,
            [...p, chaves.length, chaves],
          )
        ).map((x) => [x.u, Number(x.completude)]),
      )
    : null;
  const de = <T extends { u: string }>(l: T[]) => new Map(l.map((x) => [x.u, x]));
  const [mR, mP, mI, mQ, mRel] = [de(receita), de(pipeline), de(inteligencia), de(qualidade), de(relacionamento)];
  const arred = (n: number) => Math.round(n * 10) / 10;
  return new Map(
    usuarioIds.map((u) => {
      const r = mR.get(u);
      const pi = mP.get(u);
      const i = mI.get(u);
      const qu = mQ.get(u);
      const rel = mRel.get(u);
      const notas: NotasBpi = {
        receita: null,
        pipeline: pi && pi.abertas > 0 ? arred((pi.avancaram / pi.abertas) * 100) : null,
        inteligencia: i && i.n > 0 ? arred((contraMeta((completudeCampos?.get(u) ?? Number(i.completude)) * 100, 80) + contraMeta((i.enriquecidos / i.n) * 100, 70)) / 2) : null,
        qualidade: qu ? arred(Number(qu.media)) : null,
        relacionamento: rel && rel.total > 0 ? arred((rel.no_prazo / rel.total) * 100) : null,
      };
      // Receita zero só conta para quem atendeu no período (quem não atende — dono, financeiro — fica fora do BPI).
      const atendeu = r !== undefined || Object.values(notas).some((n) => n !== null);
      if (metaDoPeriodo && atendeu) notas.receita = arred(contraMeta(Number(r?.total ?? 0), metaDoPeriodo));
      return [u, notas];
    }),
  );
}

/** As duas últimas semanas completas (segunda a domingo) no fuso da empresa, da mais antiga para a mais recente. */
async function ultimasSemanas(tx: Tx): Promise<[string, string, string]> {
  const [l] = await q<{ a: string; b: string; c: string }>(
    tx,
    `SELECT to_char(s - 14, 'YYYY-MM-DD') AS a, to_char(s - 7, 'YYYY-MM-DD') AS b, to_char(s, 'YYYY-MM-DD') AS c
     FROM (SELECT date_trunc('week', now() AT TIME ZONE fuso)::date AS s FROM empresa WHERE id = $1) x`,
    [tx.empresaId],
  );
  return [l!.a, l!.b, l!.c];
}

/** BR-022: pilares abaixo de 70 nas duas semanas (pilar sem dados não conta). */
function pilaresEmCoaching(a: NotasBpi, b: NotasBpi): PilarBpi[] {
  return PILARES_BPI.map((p) => p.codigo).filter((p) => a[p] !== null && b[p] !== null && a[p]! < LIMITE_COACHING && b[p]! < LIMITE_COACHING);
}

export function criarServicoDesempenho(s: Servicos, ia?: ProvedorIaBre) {
  const { banco } = s;
  let provedor = ia;

  // SQ-BRE --------------------------------------------------------------------------------------------

  /** Prévia da IA para a conversa (uma prévia aberta por conversa: pedir de novo devolve a mesma). */
  async function previa(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, conversaId: string): Promise<SqBreDto> {
    if (escopo === "proprio") throw semPermissao();
    const dados = await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [c] = await q<{ atribuida_a: string | null; nao_contatar: boolean | null; anonimizado: boolean | null }>(
        tx,
        `SELECT v.atribuida_a, ct.nao_contatar, ct.anonimizado_em IS NOT NULL AS anonimizado
         FROM conversa v LEFT JOIN contato ct ON ct.id = v.contato_id WHERE v.id = $1 AND v.empresa_id = $2`,
        [conversaId, ctx.empresaId],
      );
      if (!c) throw naoEncontrado("Conversa");
      if (!c.atribuida_a) throw invalido("Esta conversa não tem responsável para avaliar.");
      if (c.atribuida_a === ctx.usuarioId) throw invalido("Ninguém avalia o próprio atendimento. Peça a outro gestor.");
      await exigirPessoa(tx, ctx, escopo, c.atribuida_a);
      const [aberta] = await q<LinhaSq>(tx, `${SELECT_SQ} WHERE s.empresa_id = $1 AND s.conversa_id = $2 AND s.nota IS NULL`, [ctx.empresaId, conversaId]);
      if (aberta) return { aberta, avaliadoId: c.atribuida_a, mensagens: [] };
      if (c.nao_contatar || c.anonimizado) throw invalido("{Este contato} pediu para não ser contatad{o|a:contato} ou foi anonimizad{o|a:contato}: a conversa não vai para a IA.");
      return { aberta: null, avaliadoId: c.atribuida_a, mensagens: await mensagensDaConversa(tx, conversaId) };
    });
    if (dados.aberta) return dtoSq(dados.aberta);

    provedor ??= criarProvedorIaBre(s.config);
    let notas: NotasSq;
    try {
      notas = (await provedor.analisar(dados.mensagens)).sqBre;
    } catch (err) {
      throw invalido(err instanceof IaIndisponivel ? err.message : "Não foi possível gerar a prévia agora. Tente de novo em instantes.");
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [l] = await q<{ id: string }>(
        tx,
        `INSERT INTO sq_bre (empresa_id, conversa_id, avaliado_id, provedor, previa, nota_previa, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (empresa_id, conversa_id) WHERE confirmada_em IS NULL DO UPDATE SET provedor = sq_bre.provedor RETURNING id`,
        [ctx.empresaId, conversaId, dados.avaliadoId, provedor!.nome, JSON.stringify(notas), somaSq(notas), ctx.usuarioId],
      );
      await registrar(tx, origem, { acao: "qualidade.sq_bre_previa", entidade: "conversa", entidadeId: conversaId, responsavelId: dados.avaliadoId, depois: { notas, provedor: provedor!.nome } });
      const [linha] = await q<LinhaSq>(tx, `${SELECT_SQ} WHERE s.id = $1`, [l!.id]);
      return dtoSq(linha!);
    });
  }

  /** O supervisor confirma (ajustando ou não); a prévia continua guardada ao lado (D-05, AT-019). */
  async function confirmar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, notas: NotasSq, feedback: string | null): Promise<SqBreDto> {
    if (escopo === "proprio") throw semPermissao();
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [l] = await q<LinhaSq>(tx, `${SELECT_SQ} WHERE s.id = $1 AND s.empresa_id = $2`, [id, ctx.empresaId]);
      if (!l) throw naoEncontrado("Avaliação SQ-BRE");
      if (l.nota !== null) throw invalido("Esta avaliação já foi confirmada.");
      if (l.avaliado_id === ctx.usuarioId) throw invalido("Ninguém avalia o próprio atendimento. Peça a outro gestor.");
      await exigirPessoa(tx, ctx, escopo, l.avaliado_id);
      const nota = somaSq(notas);
      await q(tx, "UPDATE sq_bre SET confirmada = $2, nota = $3, feedback = $4, confirmada_por = $5, confirmada_em = now() WHERE id = $1", [
        id,
        JSON.stringify(notas),
        nota,
        feedback,
        ctx.usuarioId,
      ]);
      await registrar(tx, origem, {
        acao: "qualidade.sq_bre_confirmado",
        entidade: "conversa",
        entidadeId: l.conversa_id,
        responsavelId: l.avaliado_id,
        antes: { notas: l.previa, nota: l.nota_previa, provedor: l.provedor },
        depois: { notas, nota },
        dados: { nota },
      });
      await notificar(tx, origem, { usuarioId: l.avaliado_id, titulo: `Você recebeu uma nota SQ-BRE: ${nota} (${faixaSq(nota)})`, texto: feedback ?? undefined, link: "/qualidade" });
      const [linha] = await q<LinhaSq>(tx, `${SELECT_SQ} WHERE s.id = $1`, [id]);
      return dtoSq(linha!);
    });
  }

  async function listarSq(ctx: ContextoEmpresa, escopo: Escopo, f: { status?: "previa" | "confirmada"; cursor?: string; limite: number }): Promise<Pagina<SqBreDto>> {
    const cursor = lerCursor(f.cursor);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .execute<LinhaSq>(sql`
          ${sql.raw(SELECT_SQ)}
          WHERE s.empresa_id = ${ctx.empresaId}
            ${f.status === "previa" ? sql`AND s.nota IS NULL` : f.status === "confirmada" ? sql`AND s.nota IS NOT NULL` : sql``}
            AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("s.avaliado_id"))})
            ${cursor ? sql`AND (s.criado_em, s.id) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : sql``}
          ORDER BY s.criado_em DESC, s.id DESC LIMIT ${f.limite + 1}`)
        .then((r) => r.rows.map((x) => ({ ...x, criado_em: new Date(x.criado_em) })));
      return paginar(linhas, f.limite, dtoSq);
    });
  }

  // BPI e coaching --------------------------------------------------------------------------------------

  /** Ranking do mês pelo BPI (D-14), com os pilares em coaching nas duas últimas semanas. */
  async function bpi(ctx: ContextoEmpresa, escopo: Escopo, mes?: string): Promise<{ mes: string; itens: BpiDto[] }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [m] = await q<{ mes: string; inicio: string; fim: string }>(
        tx,
        `SELECT to_char(i, 'YYYY-MM') AS mes, to_char(i, 'YYYY-MM-DD') AS inicio, to_char(i + interval '1 month', 'YYYY-MM-DD') AS fim
         FROM (SELECT coalesce(to_date($2, 'YYYY-MM'), date_trunc('month', now() AT TIME ZONE fuso)::date) AS i FROM empresa WHERE id = $1) x`,
        [ctx.empresaId, mes ?? null],
      );
      const pessoas = await tx.db
        .execute<{ id: string; nome: string }>(sql`
          SELECT u.id, u.nome FROM vinculo v JOIN usuario u ON u.id = v.usuario_id
          WHERE v.empresa_id = ${ctx.empresaId} AND v.status = 'ativo' AND v.arquivado_em IS NULL
            AND (${escopo === "empresa"} OR ${filtroUsuariosVisiveis(ctx, escopo, sql.raw("v.usuario_id"))})
          ORDER BY u.nome LIMIT 500`)
        .then((r) => r.rows);
      const ids = pessoas.map((p) => p.id);
      const cfg = await lerConfig(tx);
      const [a, b, c] = await ultimasSemanas(tx);
      const [doMes, semanaA, semanaB] = await Promise.all([
        notasBpi(tx, ids, m!.inicio, m!.fim, cfg.metaReceitaCentavos),
        notasBpi(tx, ids, a, b, cfg.metaReceitaCentavos),
        notasBpi(tx, ids, b, c, cfg.metaReceitaCentavos),
      ]);
      const nomePilar = (p: PilarBpi) => PILARES_BPI.find((x) => x.codigo === p)!.nome;
      const itens = pessoas
        .map((p) => {
          const pilares = doMes.get(p.id)!;
          const valor = calcularBpi(pilares);
          return {
            usuarioId: p.id,
            nome: p.nome,
            posicao: 0,
            pilares,
            bpi: valor,
            faixa: valor === null ? null : faixaBpi(valor),
            coaching: pilaresEmCoaching(semanaA.get(p.id)!, semanaB.get(p.id)!).map(nomePilar),
          };
        })
        .sort((x, y) => (y.bpi ?? -1) - (x.bpi ?? -1) || x.nome.localeCompare(y.nome, "pt-BR"))
        .map((x, i) => ({ ...x, posicao: i + 1 }));
      return { mes: m!.mes, itens };
    });
  }

  /** Job semanal (BR-022): pilar abaixo de 70 por 2 semanas seguidas avisa o gestor da equipe (uma vez por semana). */
  async function alertarCoaching(empresaId: string): Promise<number> {
    return comEmpresa(banco, empresaId, async (tx) => {
      const pessoas = await q<{ id: string; nome: string; gestor_id: string | null }>(
        tx,
        `SELECT u.id, u.nome, eq.gestor_id FROM vinculo v JOIN usuario u ON u.id = v.usuario_id LEFT JOIN equipe eq ON eq.id = v.equipe_id AND eq.arquivado_em IS NULL
         WHERE v.empresa_id = $1 AND v.status = 'ativo' AND v.arquivado_em IS NULL`,
        [empresaId],
      );
      const cfg = await lerConfig(tx);
      const [a, b, c] = await ultimasSemanas(tx);
      const ids = pessoas.map((p) => p.id);
      const [semanaA, semanaB] = await Promise.all([notasBpi(tx, ids, a, b, cfg.metaReceitaCentavos), notasBpi(tx, ids, b, c, cfg.metaReceitaCentavos)]);
      let alertas = 0;
      for (const p of pessoas) {
        const na = semanaA.get(p.id)!;
        const nb = semanaB.get(p.id)!;
        for (const pilar of pilaresEmCoaching(na, nb)) {
          const [novo] = await q<{ id: string }>(
            tx,
            `INSERT INTO coaching_alerta (empresa_id, usuario_id, pilar, semana, notas) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (empresa_id, usuario_id, pilar, semana) DO NOTHING RETURNING id`,
            [empresaId, p.id, pilar, b, JSON.stringify({ [a]: na[pilar], [b]: nb[pilar] })],
          );
          if (!novo) continue;
          alertas++;
          const nome = PILARES_BPI.find((x) => x.codigo === pilar)!.nome;
          if (p.gestor_id && p.gestor_id !== p.id) {
            await notificar(tx, ORIGEM_SISTEMA(empresaId), {
              usuarioId: p.gestor_id,
              titulo: `Coaching: ${p.nome} está abaixo de ${LIMITE_COACHING} em ${nome} há 2 semanas`,
              texto: `Semana de ${a}: ${na[pilar]} · semana de ${b}: ${nb[pilar]}`,
              link: "/bre",
            });
          }
          await registrar(tx, ORIGEM_SISTEMA(empresaId), { acao: "bre.coaching_alerta", entidade: "usuario", entidadeId: p.id, responsavelId: p.id, depois: { pilar, semanas: [a, b] } });
        }
      }
      return alertas;
    });
  }

  async function rotinaSemanal() {
    const empresas = await comoSistema(banco, (tx) => q<{ id: string }>(tx, "SELECT id FROM empresa WHERE modulos ? 'bre'"));
    for (const e of empresas) await alertarCoaching(e.id);
  }

  return { previa, confirmar, listarSq, bpi, alertarCoaching, rotinaSemanal };
}
