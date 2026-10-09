// LGPD: exportar tudo o que a empresa guarda sobre um contato e anonimizar (pedido do titular ou prazo de
// retenção). Anonimizar não apaga registros: tira os dados pessoais e mantém os fatos (datas, valores, tipos),
// para metas, comissões e auditoria continuarem fechando. Venda guarda o vínculo (obrigação fiscal).
import type { DadosTitularDto, Escopo, RetencaoDto } from "@mg/shared";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { naoEncontrado } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { auditar, registrar, type Origem } from "../auditoria/registro.js";
import { criarServicoContatos } from "../crm/contatos.servico.js";

/** Limite por lista na exportação: o arquivo continua pequeno o bastante para abrir no celular. */
const LIMITE_EXPORTACAO = 5000;
export const NOME_ANONIMO = "Contato anonimizado";
/** Ligação exige número (E.164): o anonimizado vira um número que não existe. */
export const NUMERO_ANONIMO = "+10000000000";
const TEXTO_ANONIMO = "[anonimizado]";
export const FILA_RETENCAO = "lgpd.retencao";

type Linha = Record<string, unknown>;

export function criarServicoLgpd(s: Servicos) {
  const { banco } = s;
  const contatos = criarServicoContatos(s);

  async function linhas(tx: Tx, sql: string, valores: unknown[]): Promise<Linha[]> {
    return (await tx.cliente.query<Linha>(sql, valores)).rows;
  }

  async function exportar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string): Promise<DadosTitularDto> {
    // Mesma regra de visibilidade da ficha: quem não vê o contato não exporta.
    const c = await contatos.obter(ctx, escopo, contatoId);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const p = [ctx.empresaId, contatoId, LIMITE_EXPORTACAO];
      const [empresaNome] = await linhas(tx, "SELECT nome FROM empresa WHERE id = $1", [ctx.empresaId]);
      const oportunidades = await linhas(
        tx,
        `SELECT o.titulo, o.valor_centavos AS "valorCentavos", o.oferta, o.status, o.campos, o.criado_em AS "criadoEm", o.fechada_em AS "fechadaEm"
           FROM oportunidade o WHERE o.empresa_id = $1 AND o.contato_id = $2 ORDER BY o.criado_em LIMIT $3`,
        p,
      );
      const tarefas = await linhas(
        tx,
        `SELECT titulo, descricao, vence_em AS "venceEm", concluida_em AS "concluidaEm", criado_em AS "criadoEm"
           FROM tarefa WHERE empresa_id = $1 AND contato_id = $2 ORDER BY criado_em LIMIT $3`,
        p,
      );
      const notas = await linhas(tx, `SELECT texto, criado_em AS "criadoEm" FROM nota WHERE empresa_id = $1 AND contato_id = $2 ORDER BY criado_em LIMIT $3`, p);
      const mensagens = await linhas(
        tx,
        `SELECT m.direcao, m.tipo, m.texto, m.midia_nome AS "arquivo", m.criado_em AS "criadoEm"
           FROM mensagem m JOIN conversa cv ON cv.id = m.conversa_id
          WHERE m.empresa_id = $1 AND cv.contato_id = $2 ORDER BY m.criado_em LIMIT $3`,
        p,
      );
      const ligacoes = await linhas(
        tx,
        `SELECT l.direcao, l.numero, l.estado, l.iniciada_em AS "iniciadaEm", l.duracao_segundos AS "duracaoSegundos", l.observacao,
                (l.gravacao_arquivo_id IS NOT NULL) AS "temGravacao"
           FROM ligacao l WHERE l.empresa_id = $1 AND l.contato_id = $2 ORDER BY l.criado_em LIMIT $3`,
        p,
      );
      const compromissos = await linhas(
        tx,
        `SELECT titulo, descricao, local, inicio, fim FROM compromisso WHERE empresa_id = $1 AND contato_id = $2 ORDER BY inicio LIMIT $3`,
        p,
      );
      const vendas = await linhas(
        tx,
        `SELECT o.nome AS oferta, v.valor_centavos AS "valorCentavos", v.forma_pagamento AS "formaPagamento", v.status, v.data_venda AS "dataVenda", v.observacao
           FROM venda v LEFT JOIN oferta o ON o.id = v.oferta_id WHERE v.empresa_id = $1 AND v.contato_id = $2 ORDER BY v.criado_em LIMIT $3`,
        p,
      );
      const historico = await linhas(
        tx,
        `SELECT tipo, criado_em AS "criadoEm" FROM evento WHERE empresa_id = $1 AND contato_id = $2 ORDER BY criado_em LIMIT $3`,
        p,
      );
      const listas = { oportunidades, tarefas, notas, mensagens, ligacoes, compromissos, vendas, historico };
      // O pedido de exportação fica na auditoria (quem tirou os dados e quando), sem o conteúdo.
      await auditar(tx, origem, { acao: "contato.dados_exportados", entidade: "contato", entidadeId: contatoId });
      return {
        geradoEm: new Date().toISOString(),
        empresa: String(empresaNome?.nome ?? ""),
        contato: {
          tipo: c.tipo,
          nome: c.nome,
          telefone: c.telefone,
          email: c.email,
          organizacao: c.organizacaoNome,
          origem: c.origem,
          campos: c.campos,
          naoContatar: c.naoContatar,
          consentimentoEm: c.consentimentoEm,
          etiquetas: c.etiquetas.map((e) => e.nome),
          criadoEm: c.criadoEm,
        },
        ...listas,
        limitado: Object.values(listas).some((l) => l.length >= LIMITE_EXPORTACAO),
      };
    });
  }

  /**
   * Anonimiza dentro de uma transação do sistema (precisa apagar o conteúdo do histórico, que a empresa não
   * consegue alterar). Toda consulta filtra pela empresa.
   */
  async function anonimizarNaTransacao(tx: Tx, empresaId: string, contatoId: string): Promise<void> {
    const q = (sql: string, valores: unknown[] = [empresaId, contatoId]) => tx.cliente.query(sql, valores);
    await q(
      `UPDATE contato SET nome = '${NOME_ANONIMO}', telefone = NULL, email = NULL, campos = '{}', origem = NULL, organizacao_id = NULL,
              consentimento_em = NULL, nao_contatar = true, anonimizado_em = now(), arquivado_em = coalesce(arquivado_em, now()), atualizado_em = now()
        WHERE empresa_id = $1 AND id = $2`,
    );
    const { rows: ops } = await q(
      `UPDATE oportunidade SET titulo = 'Oportunidade anonimizada', campos = '{}', atualizado_em = now()
        WHERE empresa_id = $1 AND contato_id = $2 RETURNING id`,
    );
    const { rows: tarefas } = await q(
      `UPDATE tarefa SET titulo = 'Tarefa anonimizada', descricao = NULL, atualizado_em = now()
        WHERE empresa_id = $1 AND (contato_id = $2 OR oportunidade_id IN (SELECT id FROM oportunidade WHERE empresa_id = $1 AND contato_id = $2)) RETURNING id`,
    );
    const { rows: notas } = await q(
      `UPDATE nota SET texto = '${TEXTO_ANONIMO}', atualizado_em = now()
        WHERE empresa_id = $1 AND (contato_id = $2 OR oportunidade_id IN (SELECT id FROM oportunidade WHERE empresa_id = $1 AND contato_id = $2)) RETURNING id`,
    );
    const { rows: conversas } = await q(
      `UPDATE conversa SET telefone = NULL, ids_externos = '{}', ultima_mensagem = NULL, atualizado_em = now()
        WHERE empresa_id = $1 AND contato_id = $2 RETURNING id`,
    );
    const idsConversas = conversas.map((r) => r.id as string);
    // Mídias e gravação: o conteúdo some (arquivo vazio); a linha fica para o histórico não quebrar.
    await q(
      `UPDATE arquivo SET conteudo = '', tamanho = 0, nome = 'anonimizado', arquivado_em = coalesce(arquivado_em, now())
        WHERE empresa_id = $1 AND (
          id IN (SELECT arquivo_id FROM mensagem WHERE empresa_id = $1 AND conversa_id = ANY($2::uuid[]) AND arquivo_id IS NOT NULL)
          OR id IN (SELECT gravacao_arquivo_id FROM ligacao WHERE empresa_id = $1 AND contato_id = $3 AND gravacao_arquivo_id IS NOT NULL))`,
      [empresaId, idsConversas, contatoId],
    );
    await q(
      `UPDATE mensagem SET texto = CASE WHEN texto IS NULL THEN NULL ELSE '${TEXTO_ANONIMO}' END, midia_nome = NULL, midia_pendente = NULL, erro = NULL, atualizado_em = now()
        WHERE empresa_id = $1 AND conversa_id = ANY($2::uuid[])`,
      [empresaId, idsConversas],
    );
    const { rows: ligacoes } = await q(
      `UPDATE ligacao SET numero = '${NUMERO_ANONIMO}', observacao = NULL, id_externo = NULL, atualizado_em = now()
        WHERE empresa_id = $1 AND contato_id = $2 RETURNING id`,
    );
    await q(`UPDATE ligacao_evento SET detalhe = NULL WHERE empresa_id = $1 AND ligacao_id = ANY($2::uuid[])`, [empresaId, ligacoes.map((r) => r.id)]);
    const { rows: compromissos } = await q(
      `UPDATE compromisso SET titulo = 'Compromisso anonimizado', descricao = NULL, local = NULL, atualizado_em = now()
        WHERE empresa_id = $1 AND contato_id = $2 RETURNING id`,
    );

    // Histórico: o fato fica (tipo, data, quem fez); o conteúdo sai. Exceção controlada do gatilho (ADR-027).
    const entidades = [contatoId, ...[ops, tarefas, notas, conversas, ligacoes, compromissos].flatMap((r) => r.map((x) => x.id as string))];
    await q("SELECT set_config('app.lgpd_redacao', 'on', true)", []);
    await q(
      `UPDATE evento SET dados = '{"anonimizado": true}'
        WHERE empresa_id = $1 AND (contato_id = $2 OR entidade_id = ANY($3::uuid[])) AND dados <> '{"anonimizado": true}'`,
      [empresaId, contatoId, entidades],
    );
    await q(
      `UPDATE auditoria SET antes = CASE WHEN antes IS NULL THEN NULL ELSE '{"anonimizado": true}'::jsonb END,
                            depois = CASE WHEN depois IS NULL THEN NULL ELSE '{"anonimizado": true}'::jsonb END
        WHERE empresa_id = $1 AND entidade_id = ANY($2::uuid[]) AND (antes IS NOT NULL OR depois IS NOT NULL)
          AND coalesce(depois, antes) <> '{"anonimizado": true}'::jsonb`,
      [empresaId, entidades],
    );
    await q("SELECT set_config('app.lgpd_redacao', 'off', true)", []);
  }

  async function anonimizar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, contatoId: string): Promise<void> {
    await contatos.obter(ctx, escopo, contatoId);
    await comoSistema(banco, async (tx) => {
      const { rows } = await tx.cliente.query("SELECT anonimizado_em FROM contato WHERE empresa_id = $1 AND id = $2 FOR UPDATE", [ctx.empresaId, contatoId]);
      if (!rows[0]) throw naoEncontrado("Contato");
      if (rows[0].anonimizado_em) return;
      await anonimizarNaTransacao(tx, ctx.empresaId, contatoId);
      await registrar(tx, origem, { acao: "contato.anonimizado", entidade: "contato", entidadeId: contatoId, contatoId });
    });
  }

  // Retenção ------------------------------------------------------------------------------------------------

  async function lerRetencao(ctx: ContextoEmpresa): Promise<RetencaoDto> {
    const [l] = await comEmpresa(banco, ctx.empresaId, (tx) => linhas(tx, "SELECT retencao FROM empresa WHERE id = $1", [ctx.empresaId]));
    const r = (l?.retencao ?? {}) as Partial<RetencaoDto>;
    return { mensagensMeses: r.mensagensMeses ?? null, arquivadosMeses: r.arquivadosMeses ?? null };
  }

  async function definirRetencao(ctx: ContextoEmpresa, origem: Origem, r: RetencaoDto): Promise<RetencaoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await linhas(tx, "SELECT retencao FROM empresa WHERE id = $1", [ctx.empresaId]);
      await tx.cliente.query("UPDATE empresa SET retencao = $2, atualizado_em = now() WHERE id = $1", [ctx.empresaId, JSON.stringify(r)]);
      await registrar(tx, origem, { acao: "empresa.retencao_alterada", entidade: "empresa", entidadeId: ctx.empresaId, antes: antes[0]?.retencao, depois: r });
      return r;
    });
  }

  /**
   * Job diário: aplica os prazos de cada empresa e limpa o que o sistema guarda só por um tempo.
   * Em lotes: uma empresa grande não segura o job.
   */
  async function aplicarRetencao(agora = new Date()): Promise<{ mensagens: number; contatos: number }> {
    let mensagens = 0;
    let contatos = 0;
    const empresas = await comoSistema(banco, (tx) => linhas(tx, "SELECT id, retencao FROM empresa WHERE arquivado_em IS NULL AND retencao <> '{}'", []));
    for (const e of empresas) {
      const r = e.retencao as Partial<RetencaoDto>;
      const empresaId = e.id as string;
      const sistema: Origem = { empresaId, atorId: null, ip: null, dispositivo: "retenção" };
      if (r.mensagensMeses) {
        await comoSistema(banco, async (tx) => {
          const limite = new Date(agora);
          limite.setMonth(limite.getMonth() - r.mensagensMeses!);
          await tx.cliente.query(
            `UPDATE arquivo SET conteudo = '', tamanho = 0, arquivado_em = coalesce(arquivado_em, now())
              WHERE empresa_id = $1 AND id IN (SELECT arquivo_id FROM mensagem WHERE empresa_id = $1 AND criado_em < $2 AND arquivo_id IS NOT NULL AND midia_nome IS NOT NULL LIMIT 2000)`,
            [empresaId, limite],
          );
          const { rowCount } = await tx.cliente.query(
            `UPDATE mensagem SET texto = CASE WHEN texto IS NULL THEN NULL ELSE '[removida pelo prazo de retenção]' END, midia_nome = NULL, midia_pendente = NULL, atualizado_em = now()
              WHERE id IN (SELECT id FROM mensagem WHERE empresa_id = $1 AND criado_em < $2
                             AND (midia_nome IS NOT NULL OR (texto IS NOT NULL AND texto NOT IN ('[removida pelo prazo de retenção]', '${TEXTO_ANONIMO}'))) LIMIT 2000)`,
            [empresaId, limite],
          );
          mensagens += rowCount ?? 0;
          if (rowCount) await auditar(tx, sistema, { acao: "retencao.mensagens", entidade: "empresa", entidadeId: empresaId, depois: { quantidade: rowCount } });
        });
      }
      if (r.arquivadosMeses) {
        const limite = new Date(agora);
        limite.setMonth(limite.getMonth() - r.arquivadosMeses);
        const alvos = await comoSistema(banco, (tx) =>
          linhas(tx, "SELECT id FROM contato WHERE empresa_id = $1 AND arquivado_em < $2 AND anonimizado_em IS NULL LIMIT 500", [empresaId, limite]),
        );
        for (const a of alvos) {
          await comoSistema(banco, async (tx) => {
            await anonimizarNaTransacao(tx, empresaId, a.id as string);
            await registrar(tx, sistema, { acao: "contato.anonimizado", entidade: "contato", entidadeId: a.id as string, contatoId: a.id as string, depois: { motivo: "retencao" } });
          });
          contatos++;
        }
      }
    }
    // Do sistema (todas as empresas): o que só serve por pouco tempo.
    await comoSistema(banco, async (tx) => {
      // Caixa de saída de demonstração (e-mails com links): 7 dias.
      await tx.cliente.query("DELETE FROM aviso_saida WHERE criado_em < now() - interval '7 days'");
      // Desafios de login vencidos: 30 dias.
      await tx.cliente.query("DELETE FROM desafio_login WHERE expira_em < now() - interval '30 days'");
      // Planilhas importadas: o conteúdo e a amostra saem 30 dias depois de a importação terminar.
      await tx.cliente.query(
        `UPDATE arquivo SET conteudo = '', tamanho = 0, arquivado_em = coalesce(arquivado_em, now())
          WHERE id IN (SELECT arquivo_id FROM importacao WHERE status NOT IN ('PENDENTE', 'PROCESSANDO') AND atualizado_em < now() - interval '30 days')
            AND tamanho > 0`,
      );
      await tx.cliente.query(
        `UPDATE importacao SET amostra = '[]', erros = '[]' WHERE status NOT IN ('PENDENTE', 'PROCESSANDO') AND atualizado_em < now() - interval '30 days' AND amostra <> '[]'`,
      );
    });
    return { mensagens, contatos };
  }

  return { exportar, anonimizar, lerRetencao, definirRetencao, aplicarRetencao };
}
