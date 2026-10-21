// Automação do método BRE (fase 8.4, Fase 4 da ETR): só o que o livro diz que é automatizável — pós-venda,
// aniversário e a reentrada combinada do dia — por modelo de texto da empresa. Liga só com a concordância IA × equipe
// liberada (DEC-010) e respeita as mesmas travas do registro: "não contatar", escalonamento aberto, 48 h entre
// tentativas e intervalo entre ciclos sem resposta. Cada envio ou pulo é registrado uma vez por referência.
import { and, eq, isNull } from "drizzle-orm";
import { preencherVariaveis, texto as noVocabulario, type AutomacaoBreDto, type ExecucaoAutomacaoBreDto, type Pagina, type TipoAutomacaoBre } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { canal, conversa } from "../../infra/esquema.js";
import { erroSeguro, registrarLog } from "../../infra/log.js";
import { lerCursor } from "../../infra/paginacao.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import type { ServicoEnvio } from "../conversas/envio.servico.js";
import { vocabularioDa } from "../marca/vocabulario.js";
import { bloqueioDeTentativa, criarServicoBre, lerConfig, paginar, q } from "./bre.servico.js";

type LinhaAutomacao = {
  id: string;
  tipo: TipoAutomacaoBre;
  nome: string;
  canal_id: string;
  texto: string;
  dias: number | null;
  campo_chave: string | null;
  limite_estoque: number | null;
  modelo_nome: string | null;
  modelo_idioma: string;
  modelo_parametros: string[];
  ativa: boolean;
  arquivado_em: Date | null;
};
type Alvo = { contato_id: string; ref: string; produto?: string | null };
type Modelo = { nome: string; idioma: string; parametros: string[] };

const dto = (a: LinhaAutomacao): AutomacaoBreDto => ({
  id: a.id,
  tipo: a.tipo,
  nome: a.nome,
  canalId: a.canal_id,
  texto: a.texto,
  dias: a.dias,
  campoChave: a.campo_chave,
  limiteEstoque: a.limite_estoque,
  modelo: a.modelo_nome ? { nome: a.modelo_nome, idioma: a.modelo_idioma, parametros: a.modelo_parametros } : null,
  ativa: a.ativa,
  arquivadoEm: a.arquivado_em ? new Date(a.arquivado_em).toISOString() : null,
});

const ORIGEM_AUTOMACAO = (empresaId: string): Origem => ({ empresaId, atorId: null, ip: null, dispositivo: "automacao-bre" });

export function criarServicoAutomacaoBre(s: Servicos, envio: ServicoEnvio | null) {
  const { banco } = s;
  const bre = criarServicoBre(s);

  async function listar(ctx: ContextoEmpresa): Promise<{ itens: AutomacaoBreDto[] }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => ({
      itens: (await q<LinhaAutomacao>(tx, "SELECT * FROM bre_automacao WHERE empresa_id = $1 ORDER BY arquivado_em NULLS FIRST, criado_em LIMIT 100", [ctx.empresaId])).map(dto),
    }));
  }

  async function validarCanal(tx: Tx, empresaId: string, canalId: string) {
    const [c] = await tx.db.select({ id: canal.id }).from(canal).where(and(eq(canal.id, canalId), eq(canal.empresaId, empresaId), isNull(canal.arquivadoEm)));
    if (!c) throw invalido("Escolha um canal ativo da empresa.");
  }

  async function criar(
    ctx: ContextoEmpresa,
    origem: Origem,
    e: {
      tipo: TipoAutomacaoBre;
      nome: string;
      canalId: string;
      texto: string;
      dias?: number | null;
      campoChave?: string | null;
      limiteEstoque?: number | null;
      modelo?: Modelo | null;
    },
  ): Promise<AutomacaoBreDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await validarCanal(tx, ctx.empresaId, e.canalId);
      if (e.tipo === "ANIVERSARIO") {
        const [campo] = await q(tx, "SELECT 1 FROM campo_personalizado WHERE empresa_id = $1 AND entidade = 'contato' AND chave = $2 AND tipo = 'data' AND arquivado_em IS NULL", [
          ctx.empresaId,
          e.campoChave,
        ]);
        if (!campo) throw invalido("Escolha um campo de data do cadastro (ex.: data de nascimento).");
      }
      const [a] = await q<LinhaAutomacao>(
        tx,
        `INSERT INTO bre_automacao (empresa_id, tipo, nome, canal_id, texto, dias, campo_chave, limite_estoque, modelo_nome, modelo_idioma, modelo_parametros, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10, 'pt_BR'), coalesce($11, '{}'::text[]), $12) RETURNING *`,
        [
          ctx.empresaId,
          e.tipo,
          e.nome,
          e.canalId,
          e.texto,
          e.tipo === "POS_VENDA" ? e.dias : null,
          e.tipo === "ANIVERSARIO" ? e.campoChave : null,
          e.tipo === "ESTOQUE" ? e.limiteEstoque : null,
          e.modelo?.nome ?? null,
          e.modelo?.idioma ?? null,
          e.modelo?.parametros ?? null,
          ctx.usuarioId,
        ],
      );
      await registrar(tx, origem, { acao: "bre.automacao_criada", entidade: "bre_automacao", entidadeId: a!.id, depois: dto(a!) });
      return dto(a!);
    });
  }

  /** Ligar exige a concordância IA × equipe liberada (DEC-010); desligar e editar, não. */
  async function atualizar(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string,
    d: { nome?: string; texto?: string; modelo?: Modelo | null; ativa?: boolean; arquivado?: boolean },
  ): Promise<AutomacaoBreDto> {
    if (d.ativa === true) {
      const c = await bre.concordancia(ctx);
      if (!c.liberado) throw invalido(`Para ligar uma automação, o painel IA × equipe precisa estar liberado. ${c.motivo}`);
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [antes] = await q<LinhaAutomacao>(tx, "SELECT * FROM bre_automacao WHERE id = $1 AND empresa_id = $2", [id, ctx.empresaId]);
      if (!antes) throw naoEncontrado("Automação");
      if (d.ativa === true && antes.arquivado_em) throw invalido("Restaure a automação antes de ligá-la.");
      const [depois] = await q<LinhaAutomacao>(
        tx,
        `UPDATE bre_automacao SET nome = coalesce($3, nome), texto = coalesce($4, texto),
           ativa = CASE WHEN $6::boolean THEN false ELSE coalesce($5, ativa) END,
           arquivado_em = CASE WHEN $6::boolean IS NULL THEN arquivado_em WHEN $6 THEN coalesce(arquivado_em, now()) ELSE NULL END,
           modelo_nome = CASE WHEN $7::boolean THEN $8 ELSE modelo_nome END,
           modelo_idioma = CASE WHEN $7::boolean THEN coalesce($9, 'pt_BR') ELSE modelo_idioma END,
           modelo_parametros = CASE WHEN $7::boolean THEN coalesce($10, '{}'::text[]) ELSE modelo_parametros END,
           atualizado_em = now()
         WHERE id = $1 AND empresa_id = $2 RETURNING *`,
        [
          id,
          ctx.empresaId,
          d.nome ?? null,
          d.texto ?? null,
          d.ativa ?? null,
          d.arquivado ?? null,
          d.modelo !== undefined,
          d.modelo?.nome ?? null,
          d.modelo?.idioma ?? null,
          d.modelo?.parametros ?? null,
        ],
      );
      await registrar(tx, origem, { acao: "bre.automacao_alterada", entidade: "bre_automacao", entidadeId: id, antes: dto(antes), depois: dto(depois!) });
      return dto(depois!);
    });
  }

  async function execucoes(ctx: ContextoEmpresa, f: { cursor?: string; limite: number }): Promise<Pagina<ExecucaoAutomacaoBreDto>> {
    const cursor = lerCursor(f.cursor);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = (
        await q<{ id: string; automacao_nome: string; contato_id: string; contato_nome: string; status: "enviada" | "ignorada"; detalhe: string | null; criado_em: Date }>(
          tx,
          `SELECT x.id, a.nome AS automacao_nome, x.contato_id, c.nome AS contato_nome, x.status, x.detalhe, x.criado_em
           FROM bre_automacao_execucao x JOIN bre_automacao a ON a.id = x.automacao_id JOIN contato c ON c.id = x.contato_id
           WHERE x.empresa_id = $1 ${cursor ? "AND (x.criado_em, x.id) < ($3::timestamptz, $4::uuid)" : ""}
           ORDER BY x.criado_em DESC, x.id DESC LIMIT $2`,
          cursor ? [ctx.empresaId, f.limite + 1, cursor.criadoEm, cursor.id] : [ctx.empresaId, f.limite + 1],
        )
      ).map((l) => ({ ...l, criado_em: new Date(l.criado_em) }));
      return paginar(linhas, f.limite, (l) => ({
        id: l.id,
        automacaoNome: l.automacao_nome,
        contatoId: l.contato_id,
        contatoNome: l.contato_nome,
        status: l.status,
        detalhe: l.detalhe,
        criadoEm: l.criado_em.toISOString(),
      }));
    });
  }

  /** Quem a automação alcança hoje (contato + referência que impede repetir). */
  async function candidatos(tx: Tx, a: LinhaAutomacao): Promise<Alvo[]> {
    const hoje = "(SELECT (now() AT TIME ZONE fuso)::date FROM empresa WHERE id = $1)";
    switch (a.tipo) {
      case "POS_VENDA":
        return q(
          tx,
          `SELECT DISTINCT ON (v.contato_id) v.contato_id, v.id::text AS ref, o.nome AS produto FROM venda v JOIN oferta o ON o.id = v.oferta_id
           WHERE v.empresa_id = $1 AND v.status = 'confirmada' AND v.data_venda = ${hoje} - $2::int ORDER BY v.contato_id, v.criado_em LIMIT 500`,
          [tx.empresaId, a.dias],
        );
      case "ANIVERSARIO":
        return q(
          tx,
          `SELECT id AS contato_id, to_char(${hoje}, 'YYYY') AS ref FROM contato
           WHERE empresa_id = $1 AND arquivado_em IS NULL AND campos->>$2 ~ '^\\d{4}-\\d{2}-\\d{2}$'
             AND to_char((campos->>$2)::date, 'MM-DD') = to_char(${hoje}, 'MM-DD') LIMIT 500`,
          [tx.empresaId, a.campo_chave],
        );
      case "REENTRADA":
        return q(
          tx,
          `SELECT contato_id, id::text AS ref FROM reentrada
           WHERE empresa_id = $1 AND status = 'pendente' AND tipo = 'TIME' AND prevista_para = ${hoje} LIMIT 500`,
          [tx.empresaId],
        );
      case "LANCAMENTO":
      case "ESTOQUE": {
        // Compatível = já comprou (venda não cancelada) outro item da mesma categoria. A referência é o item: cada
        // pessoa recebe o aviso de um lançamento (ou de um estoque baixo) uma vez só.
        const gatilho =
          a.tipo === "LANCAMENTO"
            ? `o.lancamento_em BETWEEN ${hoje} - 7 AND ${hoje}`
            : "o.estoque IS NOT NULL AND o.estoque BETWEEN 1 AND $2::int";
        return q(
          tx,
          `SELECT DISTINCT ON (o.id, v.contato_id) v.contato_id, 'oferta:' || o.id AS ref, o.nome AS produto
           FROM oferta o
           JOIN oferta irma ON irma.empresa_id = o.empresa_id AND irma.id <> o.id AND lower(irma.categoria) = lower(o.categoria)
           JOIN venda v ON v.empresa_id = o.empresa_id AND v.oferta_id = irma.id AND v.status <> 'cancelada'
           WHERE o.empresa_id = $1 AND o.arquivado_em IS NULL AND o.categoria IS NOT NULL AND ${gatilho}
           ORDER BY o.id, v.contato_id LIMIT 500`,
          a.tipo === "LANCAMENTO" ? [tx.empresaId] : [tx.empresaId, a.limite_estoque],
        );
      }
    }
  }

  /** Um cliente: envia ou registra por que pulou. Transação própria: um erro não derruba os outros. */
  async function processar(empresaId: string, a: LinhaAutomacao, alvo: Alvo): Promise<"enviada" | "ignorada" | "repetida"> {
    return comEmpresa(banco, empresaId, async (tx) => {
      const [ja] = await q(tx, "SELECT 1 FROM bre_automacao_execucao WHERE automacao_id = $1 AND contato_id = $2 AND referencia = $3", [a.id, alvo.contato_id, alvo.ref]);
      if (ja) return "repetida";
      const cfg = await lerConfig(tx);
      const [c] = await q<{
        id: string;
        nome: string;
        telefone: string | null;
        nao_contatar: boolean;
        estado_bre: string | null;
        ultima_entrega_em: string | null;
        responsavel_id: string | null;
        responsavel_nome: string | null;
        empresa_nome: string;
        anonimizado: boolean;
        arquivado: boolean;
        escalado: boolean;
      }>(
        tx,
        `SELECT c.id, c.nome, c.telefone, c.nao_contatar, c.estado_bre, to_char(c.ultima_entrega_em, 'YYYY-MM-DD') AS ultima_entrega_em,
                c.responsavel_id, u.nome AS responsavel_nome, e.nome AS empresa_nome, c.anonimizado_em IS NOT NULL AS anonimizado,
                c.arquivado_em IS NOT NULL AS arquivado,
                EXISTS (SELECT 1 FROM escalonamento x WHERE x.empresa_id = c.empresa_id AND x.contato_id = c.id AND x.status = 'aberto') AS escalado
         FROM contato c JOIN empresa e ON e.id = c.empresa_id LEFT JOIN usuario u ON u.id = c.responsavel_id
         WHERE c.id = $1 AND c.empresa_id = $2`,
        [alvo.contato_id, empresaId],
      );
      let motivo: string | null = null;
      if (!c || c.arquivado || c.anonimizado) motivo = "Cadastro arquivado ou anonimizado.";
      else if (!c.telefone) motivo = "Sem telefone.";
      else if (c.escalado) motivo = "Está com uma pessoa (escalonamento aberto).";
      else motivo = await bloqueioDeTentativa(tx, c, cfg);
      // O motivo aparece na tela de execuções: sai no vocabulário da empresa ("O aluno pediu…").
      if (motivo?.includes("{")) motivo = noVocabulario(motivo, await vocabularioDa(tx, empresaId));

      let mensagemId: string | null = null;
      if (!motivo && c) {
        if (!envio) throw new Error("Envio de mensagens indisponível");
        let [conv] = await tx.db
          .select()
          .from(conversa)
          .where(and(eq(conversa.canalId, a.canal_id), eq(conversa.contatoId, c.id), isNull(conversa.mescladaEmId)))
          .limit(1);
        if (!conv) {
          [conv] = await tx.db
            .insert(conversa)
            .values({ empresaId, canalId: a.canal_id, contatoId: c.id, telefone: c.telefone, atribuidaA: c.responsavel_id, ultimaMensagemEm: new Date() })
            .returning();
        }
        const primeiroNome = c.nome.split(" ")[0] ?? c.nome;
        const valores: Record<string, string> = { nome: primeiroNome, vendedor: c.responsavel_nome ?? "", produto: alvo.produto ?? "", empresa: c.empresa_nome };
        const texto = preencherVariaveis(a.texto, valores);
        // Com modelo aprovado na Meta, sai como modelo (alcança quem está fora da janela de 24 h); o texto vira a prévia.
        const modelo = a.modelo_nome ? { nome: a.modelo_nome, idioma: a.modelo_idioma, parametros: a.modelo_parametros.map((p) => valores[p] ?? "") } : null;
        const m = await envio.criarSaida(tx, ORIGEM_AUTOMACAO(empresaId), conv!, { tipo: "texto", texto, autorId: null, modelo });
        mensagemId = m.id;
      }
      const status = motivo ? "ignorada" : "enviada";
      await q(
        tx,
        `INSERT INTO bre_automacao_execucao (empresa_id, automacao_id, contato_id, referencia, status, detalhe, mensagem_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (automacao_id, contato_id, referencia) DO NOTHING`,
        [empresaId, a.id, alvo.contato_id, alvo.ref, status, motivo, mensagemId],
      );
      await registrar(tx, ORIGEM_AUTOMACAO(empresaId), {
        acao: status === "enviada" ? "bre.automacao_enviada" : "bre.automacao_ignorada",
        entidade: "contato",
        entidadeId: alvo.contato_id,
        contatoId: alvo.contato_id,
        depois: { automacao: a.nome, motivo },
      });
      return status;
    });
  }

  /**
   * Roda as automações ligadas da empresa. Se a concordância caiu e deixou de estar liberada, nada sai (a liberação
   * vale na hora do envio, não só na hora de ligar).
   */
  async function executar(empresaId: string): Promise<{ enviadas: number; ignoradas: number; pausada: string | null }> {
    const ctxSistema = { empresaId } as ContextoEmpresa;
    const c = await bre.concordancia(ctxSistema);
    const ativas = await comEmpresa(banco, empresaId, (tx) => q<LinhaAutomacao>(tx, "SELECT * FROM bre_automacao WHERE empresa_id = $1 AND ativa AND arquivado_em IS NULL", [empresaId]));
    if (!ativas.length) return { enviadas: 0, ignoradas: 0, pausada: null };
    if (!c.liberado) {
      registrarLog({ level: "warn", event: "bre.automacao_pausada", empresaId, motivo: c.motivo });
      return { enviadas: 0, ignoradas: 0, pausada: c.motivo };
    }
    let enviadas = 0;
    let ignoradas = 0;
    for (const a of ativas) {
      const alvos = await comEmpresa(banco, empresaId, (tx) => candidatos(tx, a));
      for (const alvo of alvos) {
        try {
          const r = await processar(empresaId, a, alvo);
          if (r === "enviada") enviadas++;
          if (r === "ignorada") ignoradas++;
        } catch (err) {
          registrarLog({ level: "error", event: "bre.automacao_falhou", empresaId, automacaoId: a.id, contatoId: alvo.contato_id, erro: erroSeguro(err) });
        }
      }
    }
    return { enviadas, ignoradas, pausada: null };
  }

  async function rotinaDiaria() {
    const empresas = await comoSistema(banco, (tx) => q<{ id: string }>(tx, "SELECT DISTINCT empresa_id AS id FROM bre_automacao WHERE ativa AND arquivado_em IS NULL"));
    for (const e of empresas) await executar(e.id);
  }

  return { listar, criar, atualizar, execucoes, executar, rotinaDiaria };
}
