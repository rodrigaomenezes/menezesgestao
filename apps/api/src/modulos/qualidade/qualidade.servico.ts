// Monitoramento de qualidade: critérios com peso, avaliação de conversa ou ligação com nota por critério e
// feedback para quem foi avaliado (aviso no sino).
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AvaliacaoDto, CriterioDto, Escopo, Pagina } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { avaliacao, contato, conversa, criterioQualidade, ligacao, usuario, type NotaCriterio } from "../../infra/esquema.js";
import { invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { notificar } from "../notificacoes/notificar.js";
import { exigirPessoa } from "../operacao/comum.js";

const avaliado = alias(usuario, "avaliado");
const avaliador = alias(usuario, "avaliador");
const contatoConversa = alias(contato, "contato_conversa");
const contatoLigacao = alias(contato, "contato_ligacao");

/** Média ponderada pelos pesos, com duas casas. */
export function notaFinal(notas: { peso: number; nota: number }[]): number {
  const pesos = notas.reduce((t, n) => t + n.peso, 0);
  return pesos ? Math.round((notas.reduce((t, n) => t + n.nota * n.peso, 0) / pesos) * 100) / 100 : 0;
}

export function criarServicoQualidade(s: Servicos) {
  const { banco } = s;

  // Critérios ---------------------------------------------------------------------------------------

  async function criterios(ctx: ContextoEmpresa): Promise<{ itens: CriterioDto[] }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => ({
      itens: await tx.db
        .select({ id: criterioQualidade.id, nome: criterioQualidade.nome, descricao: criterioQualidade.descricao, peso: criterioQualidade.peso, ordem: criterioQualidade.ordem })
        .from(criterioQualidade)
        .where(and(eq(criterioQualidade.empresaId, ctx.empresaId), isNull(criterioQualidade.arquivadoEm)))
        .orderBy(asc(criterioQualidade.ordem), asc(criterioQualidade.criadoEm))
        .limit(100),
    }));
  }

  async function salvarCriterio(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string | null,
    d: { nome?: string; descricao?: string | null; peso?: number; ordem?: number; arquivar?: boolean },
  ): Promise<{ ok: true }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      let criterioId = id;
      if (!criterioId) {
        const [n] = await tx.db
          .insert(criterioQualidade)
          .values({ empresaId: ctx.empresaId, nome: d.nome!, descricao: d.descricao ?? null, peso: d.peso ?? 1, ordem: d.ordem ?? 0 })
          .returning({ id: criterioQualidade.id });
        criterioId = n.id;
      } else {
        const [r] = await tx.db
          .update(criterioQualidade)
          .set({
            ...(d.nome !== undefined ? { nome: d.nome } : {}),
            ...(d.descricao !== undefined ? { descricao: d.descricao } : {}),
            ...(d.peso !== undefined ? { peso: d.peso } : {}),
            ...(d.ordem !== undefined ? { ordem: d.ordem } : {}),
            ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
            atualizadoEm: new Date(),
          })
          .where(and(eq(criterioQualidade.id, criterioId), eq(criterioQualidade.empresaId, ctx.empresaId)))
          .returning({ id: criterioQualidade.id });
        if (!r) throw naoEncontrado("Critério");
      }
      await registrar(tx, origem, {
        acao: !id ? "criterio_qualidade.criado" : d.arquivar ? "criterio_qualidade.arquivado" : "criterio_qualidade.atualizado",
        entidade: "criterio_qualidade",
        entidadeId: criterioId,
        depois: d,
      });
      return { ok: true as const };
    });
  }

  // Avaliações --------------------------------------------------------------------------------------

  function consulta(tx: Tx) {
    return tx.db
      .select({
        id: avaliacao.id,
        avaliadoId: avaliacao.avaliadoId,
        avaliadoNome: avaliado.nome,
        avaliadorNome: avaliador.nome,
        conversaId: avaliacao.conversaId,
        ligacaoId: avaliacao.ligacaoId,
        contatoConversa: contatoConversa.nome,
        contatoLigacao: contatoLigacao.nome,
        notas: avaliacao.notas,
        notaFinal: avaliacao.notaFinal,
        feedback: avaliacao.feedback,
        lidaEm: avaliacao.lidaEm,
        criadoEm: avaliacao.criadoEm,
      })
      .from(avaliacao)
      .leftJoin(avaliado, eq(avaliado.id, avaliacao.avaliadoId))
      .leftJoin(avaliador, eq(avaliador.id, avaliacao.avaliadorId))
      .leftJoin(conversa, eq(conversa.id, avaliacao.conversaId))
      .leftJoin(contatoConversa, eq(contatoConversa.id, conversa.contatoId))
      .leftJoin(ligacao, eq(ligacao.id, avaliacao.ligacaoId))
      .leftJoin(contatoLigacao, eq(contatoLigacao.id, ligacao.contatoId));
  }
  type Linha = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];
  const dto = ({ contatoConversa: cc, contatoLigacao: cl, ...l }: Linha): AvaliacaoDto => ({
    ...l,
    contatoNome: cc ?? cl ?? null,
    notaFinal: Number(l.notaFinal),
    lidaEm: iso(l.lidaEm),
    criadoEm: iso(l.criadoEm),
  });

  async function listar(ctx: ContextoEmpresa, escopo: Escopo, f: { avaliadoId?: string; cursor?: string; limite: number }): Promise<Pagina<AvaliacaoDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await consulta(tx)
        .where(
          and(
            eq(avaliacao.empresaId, ctx.empresaId),
            isNull(avaliacao.arquivadoEm),
            filtroUsuariosVisiveis(ctx, escopo, avaliacao.avaliadoId),
            f.avaliadoId ? eq(avaliacao.avaliadoId, f.avaliadoId) : undefined,
            condicaoCursor(avaliacao.criadoEm, avaliacao.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(avaliacao.criadoEm), desc(avaliacao.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, dto);
    });
  }

  /** Avaliar é de quem gerencia: a pessoa avaliada é quem atendeu a conversa ou fez a ligação. */
  async function avaliar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    d: { conversaId?: string | null; ligacaoId?: string | null; notas: { criterioId: string; nota: number }[]; feedback: string | null },
  ): Promise<AvaliacaoDto> {
    if (escopo === "proprio") throw semPermissao();
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      let avaliadoId: string | null = null;
      let contatoId: string | null = null;
      if (d.conversaId) {
        const [c] = await tx.db.select({ atribuidaA: conversa.atribuidaA, contatoId: conversa.contatoId }).from(conversa).where(and(eq(conversa.id, d.conversaId), eq(conversa.empresaId, ctx.empresaId)));
        if (!c) throw invalido("Conversa não encontrada.");
        if (!c.atribuidaA) throw invalido("Esta conversa não tem responsável para avaliar.");
        [avaliadoId, contatoId] = [c.atribuidaA, c.contatoId];
      } else {
        const [l] = await tx.db.select({ usuarioId: ligacao.usuarioId, contatoId: ligacao.contatoId }).from(ligacao).where(and(eq(ligacao.id, d.ligacaoId!), eq(ligacao.empresaId, ctx.empresaId)));
        if (!l) throw invalido("Ligação não encontrada.");
        [avaliadoId, contatoId] = [l.usuarioId, l.contatoId];
      }
      if (avaliadoId === ctx.usuarioId) throw invalido("Ninguém avalia o próprio atendimento. Peça a outro gestor.");
      await exigirPessoa(tx, ctx, escopo, avaliadoId);
      const ativos = (await criterios(ctx)).itens;
      const notas: NotaCriterio[] = d.notas.map((n) => {
        const c = ativos.find((x) => x.id === n.criterioId);
        if (!c) throw invalido("Um dos critérios não existe mais. Atualize a página.");
        return { criterioId: c.id, nome: c.nome, peso: c.peso, nota: n.nota };
      });
      if (new Set(notas.map((n) => n.criterioId)).size !== notas.length) throw invalido("Cada critério recebe uma nota só.");
      const final = notaFinal(notas);
      const [{ id }] = await tx.db
        .insert(avaliacao)
        .values({
          empresaId: ctx.empresaId,
          avaliadoId,
          avaliadorId: ctx.usuarioId,
          conversaId: d.conversaId ?? null,
          ligacaoId: d.ligacaoId ?? null,
          notas,
          notaFinal: String(final),
          feedback: d.feedback,
        })
        .returning({ id: avaliacao.id });
      await registrar(tx, origem, {
        acao: "avaliacao.registrada",
        entidade: "avaliacao",
        entidadeId: id,
        contatoId,
        responsavelId: avaliadoId,
        depois: { notas, notaFinal: final },
        dados: { notaFinal: final },
      });
      await notificar(tx, origem, { usuarioId: avaliadoId, titulo: `Você recebeu uma avaliação: nota ${final.toLocaleString("pt-BR")}`, texto: d.feedback ?? undefined, link: "/qualidade" });
      const [l] = await consulta(tx).where(eq(avaliacao.id, id));
      return dto(l);
    });
  }

  /** A pessoa avaliada marca que leu o feedback. */
  async function marcarLida(ctx: ContextoEmpresa, origem: Origem, id: string): Promise<{ ok: true }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [a] = await tx.db
        .update(avaliacao)
        .set({ lidaEm: new Date() })
        .where(and(eq(avaliacao.id, id), eq(avaliacao.empresaId, ctx.empresaId), eq(avaliacao.avaliadoId, ctx.usuarioId), isNull(avaliacao.lidaEm)))
        .returning({ id: avaliacao.id });
      if (!a) throw naoEncontrado("Avaliação");
      await registrar(tx, origem, { acao: "avaliacao.lida", entidade: "avaliacao", entidadeId: id, responsavelId: ctx.usuarioId });
      return { ok: true as const };
    });
  }

  return { criterios, salvarCriterio, listar, avaliar, marcarLida };
}
