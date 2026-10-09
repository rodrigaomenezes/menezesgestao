// Vendas (contato × oferta × vendedor) e comissões: regras, prévia do mês, fechamento (retrato) e reabertura.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  temPermissao,
  type ComissoesDoMesDto,
  type Escopo,
  type Pagina,
  type RegraComissaoDto,
  type StatusVendaId,
  type VendaDto,
} from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { comissao, contato, entrega, entregaParticipante, fechamentoComissao, oferta, oportunidade, regraComissao, usuario, venda } from "../../infra/esquema.js";
import { ErroApp, codigoPg, conflito, invalido, naoEncontrado, periodoFechado, semPermissao } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis, usuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import * as contatos from "../crm/contatos.repositorio.js";
import { exigirPessoa, fusoDe, hojeNoFuso, limitesPeriodo } from "../operacao/comum.js";
import { calcularComissoes, type RegraParaComissao } from "./calculo-comissao.js";
import { ocuparVaga } from "./ofertas.servico.js";

const vendedor = alias(usuario, "vendedor");
const quemFechou = alias(usuario, "quem_fechou");

type DadosVenda = {
  contatoId: string;
  ofertaId: string;
  vendedorId?: string | null;
  oportunidadeId?: string | null;
  entregaId?: string | null;
  valorCentavos: number;
  formaPagamento: string;
  parcelas: number;
  dataVenda?: string;
  status: "pendente" | "confirmada";
  observacao: string | null;
};

export function criarServicoVendas(s: Servicos) {
  const { banco } = s;

  function consulta(tx: Tx) {
    return tx.db
      .select({
        id: venda.id,
        contatoId: venda.contatoId,
        contatoNome: contato.nome,
        ofertaId: venda.ofertaId,
        ofertaNome: oferta.nome,
        vendedorId: venda.vendedorId,
        vendedorNome: vendedor.nome,
        oportunidadeId: venda.oportunidadeId,
        entregaId: venda.entregaId,
        entregaNome: entrega.nome,
        valorCentavos: venda.valorCentavos,
        formaPagamento: venda.formaPagamento,
        parcelas: venda.parcelas,
        status: venda.status,
        dataVenda: venda.dataVenda,
        observacao: venda.observacao,
        motivoCancelamento: venda.motivoCancelamento,
        criadoEm: venda.criadoEm,
        fechada: sql<boolean>`EXISTS (SELECT 1 FROM fechamento_comissao f WHERE f.empresa_id = ${venda.empresaId}
          AND f.reaberto_em IS NULL AND f.mes = date_trunc('month', ${venda.dataVenda})::date)`,
      })
      .from(venda)
      .leftJoin(contato, eq(contato.id, venda.contatoId))
      .leftJoin(oferta, eq(oferta.id, venda.ofertaId))
      .leftJoin(vendedor, eq(vendedor.id, venda.vendedorId))
      .leftJoin(entrega, eq(entrega.id, venda.entregaId));
  }
  type Linha = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];
  const dto = (l: Linha): VendaDto => ({ ...l, formaPagamento: l.formaPagamento as VendaDto["formaPagamento"], fechada: Boolean(l.fechada), criadoEm: iso(l.criadoEm) });

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const [l] = await consulta(tx).where(and(eq(venda.id, id), eq(venda.empresaId, ctx.empresaId), filtroUsuariosVisiveis(ctx, escopo, venda.vendedorId)));
    if (!l) throw naoEncontrado("Venda");
    return l;
  }

  async function mesFechado(tx: Tx, empresaId: string, dia: string): Promise<boolean> {
    const [f] = await tx.db
      .select({ id: fechamentoComissao.id })
      .from(fechamentoComissao)
      .where(and(eq(fechamentoComissao.empresaId, empresaId), isNull(fechamentoComissao.reabertoEm), eq(fechamentoComissao.mes, `${dia.slice(0, 7)}-01`)));
    return Boolean(f);
  }

  /** Confirmar pagamento e mexer em venda alheia é de quem confere (escopo além do próprio). */
  const confere = (escopo: Escopo) => escopo !== "proprio";

  async function listar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { mes?: string; vendedorId?: string; contatoId?: string; status?: StatusVendaId; cursor?: string; limite: number },
  ): Promise<Pagina<VendaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const mes = f.mes ? limitesPeriodo("mes", `${f.mes}-01`) : null;
      const linhas = await consulta(tx)
        .where(
          and(
            eq(venda.empresaId, ctx.empresaId),
            filtroUsuariosVisiveis(ctx, escopo, venda.vendedorId),
            mes ? sql`${venda.dataVenda} BETWEEN ${mes.inicio}::date AND ${mes.fim}::date` : undefined,
            f.vendedorId ? eq(venda.vendedorId, f.vendedorId) : undefined,
            f.contatoId ? eq(venda.contatoId, f.contatoId) : undefined,
            f.status ? eq(venda.status, f.status) : undefined,
            condicaoCursor(venda.criadoEm, venda.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(venda.criadoEm), desc(venda.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, dto);
    });
  }

  async function criar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, d: DadosVenda): Promise<VendaDto> {
    if (d.status === "confirmada" && !confere(escopo)) throw invalido("A venda entra como aguardando pagamento; quem confere o pagamento confirma.");
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const escopoCrm = temPermissao(ctx.permissoes, "crm", "ver");
      if (!escopoCrm || !(await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopoCrm, d.contatoId))) throw invalido("Contato não encontrado na sua carteira.");
      const [o] = await tx.db.select({ nome: oferta.nome }).from(oferta).where(and(eq(oferta.id, d.ofertaId), eq(oferta.empresaId, ctx.empresaId), isNull(oferta.arquivadoEm)));
      if (!o) throw invalido("Oferta não encontrada.");
      const vendedorId = await exigirPessoa(tx, ctx, escopo, d.vendedorId);
      if (d.oportunidadeId) {
        const [op] = await tx.db.select({ contatoId: oportunidade.contatoId }).from(oportunidade).where(and(eq(oportunidade.id, d.oportunidadeId), eq(oportunidade.empresaId, ctx.empresaId)));
        if (!op || op.contatoId !== d.contatoId) throw invalido("A oportunidade é de outro contato.");
      }
      const dataVenda = d.dataVenda ?? hojeNoFuso(fusoDe(ctx));
      if (await mesFechado(tx, ctx.empresaId, dataVenda)) throw periodoFechado();
      // Trava a entrega ANTES de gravar a venda (a chave estrangeira da venda também a trava, em modo
      // compartilhado; pegar a exclusiva depois faria duas vendas simultâneas se bloquearem mutuamente).
      if (d.entregaId) {
        const { rows } = await tx.cliente.query<{ oferta_id: string }>("SELECT oferta_id FROM entrega WHERE id = $1 AND empresa_id = $2 FOR UPDATE", [d.entregaId, ctx.empresaId]);
        if (!rows[0] || rows[0].oferta_id !== d.ofertaId) throw invalido("A entrega escolhida é de outra oferta.");
      }
      let id: string;
      try {
        [{ id }] = await tx.db
          .insert(venda)
          .values({
            empresaId: ctx.empresaId,
            contatoId: d.contatoId,
            ofertaId: d.ofertaId,
            vendedorId,
            oportunidadeId: d.oportunidadeId ?? null,
            entregaId: d.entregaId ?? null,
            valorCentavos: d.valorCentavos,
            formaPagamento: d.formaPagamento,
            parcelas: d.parcelas,
            status: d.status,
            dataVenda,
            observacao: d.observacao,
            criadoPor: ctx.usuarioId,
          })
          .returning({ id: venda.id });
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Esta oportunidade já tem uma venda registrada.");
        throw err;
      }
      // Vaga na entrega (turma/agenda) junto com a venda.
      if (d.entregaId) await ocuparVaga(tx, ctx.empresaId, d.entregaId, d.contatoId, ctx.usuarioId, id);
      const dados = { valorCentavos: d.valorCentavos, oferta: o.nome, titulo: `Venda: ${o.nome}` };
      await registrar(tx, origem, { acao: "venda.registrada", entidade: "venda", entidadeId: id, contatoId: d.contatoId, responsavelId: vendedorId, depois: { ...d, vendedorId, dataVenda }, dados });
      if (d.status === "confirmada") await registrar(tx, origem, { acao: "venda.confirmada", entidade: "venda", entidadeId: id, contatoId: d.contatoId, responsavelId: vendedorId, dados });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function atualizar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    d: { valorCentavos?: number; formaPagamento?: string; parcelas?: number; dataVenda?: string; observacao?: string | null; status?: StatusVendaId; motivoCancelamento?: string | null },
  ): Promise<VendaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      if (antes.fechada || (d.dataVenda && (await mesFechado(tx, ctx.empresaId, d.dataVenda)))) throw periodoFechado();
      if (antes.status === "cancelada") throw conflito("Venda cancelada não muda mais. Registre uma nova venda, se for o caso.");
      // Quem só vê as próprias vendas mexe só nas que aguardam pagamento e não confirma.
      if (!confere(escopo) && (antes.status !== "pendente" || d.status === "confirmada")) throw semPermissao();
      if (d.status === "cancelada" && !d.motivoCancelamento) throw invalido("Diga o motivo do cancelamento.");
      await tx.db
        .update(venda)
        .set({
          ...(d.valorCentavos !== undefined ? { valorCentavos: d.valorCentavos } : {}),
          ...(d.formaPagamento !== undefined ? { formaPagamento: d.formaPagamento } : {}),
          ...(d.parcelas !== undefined ? { parcelas: d.parcelas } : {}),
          ...(d.dataVenda !== undefined ? { dataVenda: d.dataVenda } : {}),
          ...(d.observacao !== undefined ? { observacao: d.observacao } : {}),
          ...(d.status !== undefined ? { status: d.status } : {}),
          ...(d.status === "cancelada" ? { motivoCancelamento: d.motivoCancelamento } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(venda.id, id));
      if (d.status === "cancelada") {
        await tx.db.update(entregaParticipante).set({ status: "cancelado", atualizadoEm: new Date() }).where(and(eq(entregaParticipante.vendaId, id), eq(entregaParticipante.status, "ativo")));
      }
      const mudouStatus = d.status !== undefined && d.status !== antes.status;
      const acao = mudouStatus ? (d.status === "confirmada" ? "venda.confirmada" : d.status === "cancelada" ? "venda.cancelada" : "venda.atualizada") : "venda.atualizada";
      await registrar(tx, origem, {
        acao,
        entidade: "venda",
        entidadeId: id,
        contatoId: antes.contatoId,
        responsavelId: antes.vendedorId,
        antes: { valorCentavos: antes.valorCentavos, status: antes.status, dataVenda: antes.dataVenda },
        depois: d,
        dados: { valorCentavos: d.valorCentavos ?? antes.valorCentavos, oferta: antes.ofertaNome, titulo: `Venda: ${antes.ofertaNome}`, motivo: d.motivoCancelamento ?? null },
      });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  // Regras de comissão ------------------------------------------------------------------------------

  /** Regras e fechamento são de quem confere a empresa toda (financeiro e administrador). */
  const exigirFinanceiro = (escopo: Escopo) => {
    if (escopo !== "empresa") throw semPermissao();
  };

  const regraDto = (r: typeof regraComissao.$inferSelect & { ofertaNome: string | null }): RegraComissaoDto => ({
    id: r.id,
    nome: r.nome,
    ofertaId: r.ofertaId,
    ofertaNome: r.ofertaNome,
    tipo: r.tipo,
    percentual: r.percentual === null ? null : Number(r.percentual),
    faixas: r.faixas,
    arquivadoEm: iso(r.arquivadoEm),
  });

  async function lerRegras(tx: Tx, empresaId: string) {
    const linhas = await tx.db
      .select({ r: regraComissao, ofertaNome: oferta.nome })
      .from(regraComissao)
      .leftJoin(oferta, eq(oferta.id, regraComissao.ofertaId))
      .where(and(eq(regraComissao.empresaId, empresaId), isNull(regraComissao.arquivadoEm)))
      .orderBy(regraComissao.criadoEm)
      .limit(500);
    return linhas.map((l) => regraDto({ ...l.r, ofertaNome: l.ofertaNome }));
  }

  async function regras(ctx: ContextoEmpresa): Promise<{ itens: RegraComissaoDto[] }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => ({ itens: await lerRegras(tx, ctx.empresaId) }));
  }

  async function criarRegra(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    d: { nome: string; ofertaId?: string | null; tipo: "percentual" | "faixa"; percentual?: number | null; faixas?: { ateCentavos: number | null; percentual: number }[] | null },
  ): Promise<RegraComissaoDto> {
    exigirFinanceiro(escopo);
    let faixas: { ateCentavos: number | null; percentual: number }[] | null = null;
    if (d.tipo === "faixa") {
      faixas = [...(d.faixas ?? [])].sort((a, b) => (a.ateCentavos ?? Infinity) - (b.ateCentavos ?? Infinity));
      if (faixas.filter((f) => f.ateCentavos === null).length !== 1) throw invalido("A última faixa precisa ficar sem teto (vale para qualquer valor acima).");
      if (new Set(faixas.map((f) => f.ateCentavos)).size !== faixas.length) throw invalido("Duas faixas têm o mesmo teto.");
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      if (d.ofertaId) {
        const [o] = await tx.db.select({ id: oferta.id }).from(oferta).where(and(eq(oferta.id, d.ofertaId), eq(oferta.empresaId, ctx.empresaId)));
        if (!o) throw invalido("Oferta não encontrada.");
      }
      let id: string;
      try {
        [{ id }] = await tx.db
          .insert(regraComissao)
          .values({
            empresaId: ctx.empresaId,
            nome: d.nome,
            ofertaId: d.ofertaId ?? null,
            tipo: d.tipo,
            percentual: d.tipo === "percentual" ? String(d.percentual) : null,
            faixas,
            criadoPor: ctx.usuarioId,
          })
          .returning({ id: regraComissao.id });
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito(d.ofertaId ? "Esta oferta já tem uma regra ativa. Arquive a antiga antes." : "Já existe uma regra geral ativa. Arquive a antiga antes.");
        throw err;
      }
      await registrar(tx, origem, { acao: "regra_comissao.criada", entidade: "regra_comissao", entidadeId: id, depois: { ...d, faixas } });
      return (await lerRegras(tx, ctx.empresaId)).find((r) => r.id === id)!;
    });
  }

  async function atualizarRegra(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, d: { nome?: string; arquivar?: boolean }): Promise<{ ok: true }> {
    exigirFinanceiro(escopo);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [r] = await tx.db
        .update(regraComissao)
        .set({ ...(d.nome ? { nome: d.nome } : {}), ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}), atualizadoEm: new Date() })
        .where(and(eq(regraComissao.id, id), eq(regraComissao.empresaId, ctx.empresaId)))
        .returning({ id: regraComissao.id })
        .catch((err: unknown) => {
          if (codigoPg(err) === "23505") throw conflito("Já existe outra regra ativa para esta oferta.");
          throw err;
        });
      if (!r) throw naoEncontrado("Regra de comissão");
      await registrar(tx, origem, { acao: d.arquivar ? "regra_comissao.arquivada" : "regra_comissao.atualizada", entidade: "regra_comissao", entidadeId: id, depois: d });
      return { ok: true as const };
    });
  }

  // Comissões do mês --------------------------------------------------------------------------------

  async function calcularMes(tx: Tx, empresaId: string, mes: string) {
    const { inicio, fim } = limitesPeriodo("mes", `${mes}-01`);
    const vendas = await tx.db
      .select({ vendedorId: venda.vendedorId, ofertaId: venda.ofertaId, valorCentavos: venda.valorCentavos })
      .from(venda)
      .where(and(eq(venda.empresaId, empresaId), eq(venda.status, "confirmada"), sql`${venda.dataVenda} BETWEEN ${inicio}::date AND ${fim}::date`));
    const regrasAtivas: RegraParaComissao[] = (await lerRegras(tx, empresaId)).map((r) => ({ ...r }));
    return calcularComissoes(vendas, regrasAtivas);
  }

  async function nomes(tx: Tx, ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const linhas = await tx.db.select({ id: usuario.id, nome: usuario.nome }).from(usuario).where(inArray(usuario.id, ids));
    return new Map(linhas.map((l) => [l.id, l.nome]));
  }

  async function doMes(ctx: ContextoEmpresa, escopo: Escopo, mes: string): Promise<ComissoesDoMesDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [f] = await tx.db
        .select({ id: fechamentoComissao.id, fechadoEm: fechamentoComissao.fechadoEm, fechadoPorNome: quemFechou.nome, totalCentavos: fechamentoComissao.totalCentavos })
        .from(fechamentoComissao)
        .leftJoin(quemFechou, eq(quemFechou.id, fechamentoComissao.fechadoPor))
        .where(and(eq(fechamentoComissao.empresaId, ctx.empresaId), isNull(fechamentoComissao.reabertoEm), eq(fechamentoComissao.mes, `${mes}-01`)));
      let linhas: ComissoesDoMesDto["linhas"];
      let semRegra = 0;
      if (f) {
        // Mês fechado: vale o retrato gravado no fechamento.
        const gravadas = await tx.db.select().from(comissao).where(eq(comissao.fechamentoId, f.id));
        linhas = gravadas.map((c) => ({
          vendedorId: c.vendedorId,
          vendedorNome: null,
          regraId: c.regraId,
          regraNome: c.regraNome,
          vendas: c.vendas,
          baseCentavos: c.baseCentavos,
          percentual: Number(c.percentual),
          valorCentavos: c.valorCentavos,
        }));
      } else {
        const r = await calcularMes(tx, ctx.empresaId, mes);
        semRegra = r.semRegra;
        linhas = r.linhas.map((l) => ({ ...l, vendedorNome: null }));
      }
      // Cada um vê as próprias linhas (ou as da equipe, conforme o escopo).
      if (escopo !== "empresa") {
        const visiveis = await usuariosVisiveis(tx, ctx, escopo);
        if (visiveis !== "todos") linhas = linhas.filter((l) => visiveis.has(l.vendedorId));
      }
      const mapa = await nomes(tx, [...new Set(linhas.map((l) => l.vendedorId))]);
      linhas = linhas.map((l) => ({ ...l, vendedorNome: mapa.get(l.vendedorId) ?? null })).sort((a, b) => (a.vendedorNome ?? "").localeCompare(b.vendedorNome ?? ""));
      return {
        mes,
        fechamento: f ? { id: f.id, fechadoEm: iso(f.fechadoEm), fechadoPorNome: f.fechadoPorNome, totalCentavos: f.totalCentavos } : null,
        semRegra: escopo === "empresa" ? semRegra : 0,
        linhas,
        totalCentavos: linhas.reduce((t, l) => t + l.valorCentavos, 0),
      };
    });
  }

  async function fechar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, mes: string): Promise<ComissoesDoMesDto> {
    exigirFinanceiro(escopo);
    const { inicio, fim } = limitesPeriodo("mes", `${mes}-01`);
    if (inicio > hojeNoFuso(fusoDe(ctx))) throw invalido("Não dá para fechar um mês que ainda não começou.");
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [p] = await tx.db
        .select({ n: sql<string>`count(*)` })
        .from(venda)
        .where(and(eq(venda.empresaId, ctx.empresaId), eq(venda.status, "pendente"), sql`${venda.dataVenda} BETWEEN ${inicio}::date AND ${fim}::date`));
      const pendentes = Number(p?.n ?? 0);
      if (pendentes) {
        throw new ErroApp(409, "CONFLITO", `Ainda há ${pendentes} venda(s) aguardando pagamento neste mês. Confirme ou cancele antes de fechar.`, { pendentes });
      }
      const { linhas } = await calcularMes(tx, ctx.empresaId, mes);
      const total = linhas.reduce((t, l) => t + l.valorCentavos, 0);
      let id: string;
      try {
        [{ id }] = await tx.db.insert(fechamentoComissao).values({ empresaId: ctx.empresaId, mes: inicio, totalCentavos: total, fechadoPor: ctx.usuarioId }).returning({ id: fechamentoComissao.id });
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Este mês já está fechado.");
        throw err;
      }
      if (linhas.length) {
        await tx.db.insert(comissao).values(
          linhas.map((l) => ({
            empresaId: ctx.empresaId,
            fechamentoId: id,
            vendedorId: l.vendedorId,
            regraId: l.regraId,
            regraNome: l.regraNome,
            vendas: l.vendas,
            baseCentavos: l.baseCentavos,
            percentual: String(l.percentual),
            valorCentavos: l.valorCentavos,
          })),
        );
      }
      await registrar(tx, origem, { acao: "comissao.mes_fechado", entidade: "fechamento_comissao", entidadeId: id, depois: { mes, totalCentavos: total }, dados: { mes, totalCentavos: total } });
    });
    return doMes(ctx, escopo, mes);
  }

  async function reabrir(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, motivo: string): Promise<{ ok: true }> {
    exigirFinanceiro(escopo);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [f] = await tx.db
        .update(fechamentoComissao)
        .set({ reabertoEm: new Date(), reabertoPor: ctx.usuarioId, motivoReabertura: motivo })
        .where(and(eq(fechamentoComissao.id, id), eq(fechamentoComissao.empresaId, ctx.empresaId), isNull(fechamentoComissao.reabertoEm)))
        .returning({ mes: fechamentoComissao.mes });
      if (!f) throw naoEncontrado("Fechamento");
      await registrar(tx, origem, { acao: "comissao.mes_reaberto", entidade: "fechamento_comissao", entidadeId: id, depois: { motivo }, dados: { mes: f.mes.slice(0, 7), motivo } });
      return { ok: true as const };
    });
  }

  return { listar, criar, atualizar, regras, criarRegra, atualizarRegra, doMes, fechar, reabrir };
}
