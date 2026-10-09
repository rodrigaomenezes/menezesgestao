// Escala semanal, registro de horas (ponto ou lançamento), validação do gestor e fechamento do mês.
// Mês fechado não aceita mudança: o serviço recusa com mensagem clara e o gatilho do banco garante.
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { EscalaDto, Escopo, FechamentoDto, Pagina, RegistroHorasDto, ResumoHorasDto, StatusHorasId } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { escala, fechamentoHoras, registroHoras, usuario } from "../../infra/esquema.js";
import { ErroApp, codigoPg, conflito, invalido, naoEncontrado, periodoFechado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { exigirGestao, exigirPessoa, fusoDe, hojeNoFuso, limitesPeriodo, pessoasVisiveis, somarDias } from "./comum.js";

const validador = alias(usuario, "validador");
const quemFechou = alias(usuario, "quem_fechou");
const quemReabriu = alias(usuario, "quem_reabriu");
const DIA_MS = 86_400_000;

const minutosEntre = (a: Date, b: Date | null) => (b ? Math.round((b.getTime() - a.getTime()) / 60_000) : null);
const hhmm = (t: string) => t.slice(0, 5);
const minutosDoDia = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function criarServicoHoras(s: Servicos) {
  const { banco } = s;

  function consulta(tx: Tx) {
    return tx.db
      .select({
        id: registroHoras.id,
        usuarioId: registroHoras.usuarioId,
        usuarioNome: usuario.nome,
        data: registroHoras.data,
        entrada: registroHoras.entrada,
        saida: registroHoras.saida,
        observacao: registroHoras.observacao,
        status: registroHoras.status,
        validadoPorNome: validador.nome,
        validadoEm: registroHoras.validadoEm,
        motivo: registroHoras.motivo,
        criadoEm: registroHoras.criadoEm,
        arquivadoEm: registroHoras.arquivadoEm,
        fechado: sql<boolean>`EXISTS (SELECT 1 FROM fechamento_horas f WHERE f.empresa_id = ${registroHoras.empresaId}
          AND f.reaberto_em IS NULL AND f.mes = date_trunc('month', ${registroHoras.data})::date)`,
      })
      .from(registroHoras)
      .leftJoin(usuario, eq(usuario.id, registroHoras.usuarioId))
      .leftJoin(validador, eq(validador.id, registroHoras.validadoPor));
  }
  type Linha = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];
  const dto = (l: Linha): RegistroHorasDto => ({
    id: l.id,
    usuarioId: l.usuarioId,
    usuarioNome: l.usuarioNome,
    data: l.data,
    entrada: iso(l.entrada),
    saida: iso(l.saida),
    minutos: minutosEntre(l.entrada, l.saida),
    observacao: l.observacao,
    status: l.status,
    validadoPorNome: l.validadoPorNome,
    validadoEm: iso(l.validadoEm),
    motivo: l.motivo,
    fechado: Boolean(l.fechado),
  });

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const [l] = await consulta(tx).where(
      and(eq(registroHoras.id, id), eq(registroHoras.empresaId, ctx.empresaId), isNull(registroHoras.arquivadoEm), filtroUsuariosVisiveis(ctx, escopo, registroHoras.usuarioId)),
    );
    if (!l) throw naoEncontrado("Registro de horas");
    return l;
  }

  async function mesFechado(tx: Tx, empresaId: string, dia: string): Promise<boolean> {
    const [f] = await tx.db
      .select({ id: fechamentoHoras.id })
      .from(fechamentoHoras)
      .where(and(eq(fechamentoHoras.empresaId, empresaId), isNull(fechamentoHoras.reabertoEm), eq(fechamentoHoras.mes, `${dia.slice(0, 7)}-01`)));
    return Boolean(f);
  }

  const diaLocal = (ctx: ContextoEmpresa, instante: Date) => hojeNoFuso(fusoDe(ctx), instante);

  /** Não pode haver dois períodos que se cruzam para a mesma pessoa. */
  async function semSobreposicao(tx: Tx, empresaId: string, usuarioId: string, entrada: Date, saida: Date | null, ignorar?: string) {
    const fim = saida ?? new Date(entrada.getTime() + 1);
    const [l] = await tx.db
      .select({ id: registroHoras.id })
      .from(registroHoras)
      .where(
        and(
          eq(registroHoras.empresaId, empresaId),
          eq(registroHoras.usuarioId, usuarioId),
          isNull(registroHoras.arquivadoEm),
          ne(registroHoras.status, "recusado"),
          ignorar ? ne(registroHoras.id, ignorar) : undefined,
          sql`${registroHoras.entrada} < ${fim} AND coalesce(${registroHoras.saida}, now()) > ${entrada}`,
        ),
      )
      .limit(1);
    if (l) throw conflito("Já existe um registro de horas nesse horário. Corrija o registro existente em vez de lançar outro.");
  }

  function validarPeriodo(entrada: Date, saida: Date) {
    if (saida <= entrada) throw invalido("A saída precisa ser depois da entrada.");
    if (saida.getTime() - entrada.getTime() > DIA_MS) throw invalido("Um registro pode ter no máximo 24 horas.");
    if (saida.getTime() > Date.now() + 5 * 60_000) throw invalido("Não dá para lançar horas no futuro.");
  }

  // Ponto e lançamentos ------------------------------------------------------------------------------

  async function ponto(ctx: ContextoEmpresa, origem: Origem): Promise<RegistroHorasDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [aberto] = await tx.db
        .select()
        .from(registroHoras)
        .where(and(eq(registroHoras.empresaId, ctx.empresaId), eq(registroHoras.usuarioId, ctx.usuarioId), eq(registroHoras.status, "aberto"), isNull(registroHoras.arquivadoEm)))
        .for("update");
      const agora = new Date();
      if (aberto) {
        if (agora.getTime() - aberto.entrada.getTime() > DIA_MS) {
          throw invalido("Esse ponto ficou aberto por mais de 24 horas. Corrija a entrada e a saída no registro.");
        }
        if (await mesFechado(tx, ctx.empresaId, aberto.data)) throw periodoFechado();
        await tx.db.update(registroHoras).set({ saida: agora, status: "pendente", atualizadoEm: agora }).where(eq(registroHoras.id, aberto.id));
        await registrar(tx, origem, { acao: "horas.saida", entidade: "registro_horas", entidadeId: aberto.id, responsavelId: ctx.usuarioId, dados: { minutos: minutosEntre(aberto.entrada, agora) } });
        return dto(await carregar(tx, ctx, "empresa", aberto.id));
      }
      const data = diaLocal(ctx, agora);
      if (await mesFechado(tx, ctx.empresaId, data)) throw periodoFechado();
      await semSobreposicao(tx, ctx.empresaId, ctx.usuarioId, agora, null);
      let id: string;
      try {
        [{ id }] = await tx.db
          .insert(registroHoras)
          .values({ empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, data, entrada: agora, status: "aberto", criadoPor: ctx.usuarioId })
          .returning({ id: registroHoras.id });
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Você já tem um ponto aberto. Atualize a página.");
        throw err;
      }
      await registrar(tx, origem, { acao: "horas.entrada", entidade: "registro_horas", entidadeId: id, responsavelId: ctx.usuarioId });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function criar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    d: { usuarioId?: string | null; entrada: string; saida: string; observacao: string | null },
  ): Promise<RegistroHorasDto> {
    const entrada = new Date(d.entrada);
    const saida = new Date(d.saida);
    validarPeriodo(entrada, saida);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const usuarioId = await exigirPessoa(tx, ctx, escopo, d.usuarioId);
      const data = diaLocal(ctx, entrada);
      if (await mesFechado(tx, ctx.empresaId, data)) throw periodoFechado();
      await semSobreposicao(tx, ctx.empresaId, usuarioId, entrada, saida);
      const [{ id }] = await tx.db
        .insert(registroHoras)
        .values({ empresaId: ctx.empresaId, usuarioId, data, entrada, saida, observacao: d.observacao, status: "pendente", criadoPor: ctx.usuarioId })
        .returning({ id: registroHoras.id });
      await registrar(tx, origem, {
        acao: "horas.lancadas",
        entidade: "registro_horas",
        entidadeId: id,
        responsavelId: usuarioId,
        depois: d,
        dados: { data, minutos: minutosEntre(entrada, saida) },
      });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  /** Corrigir: a própria pessoa (se ainda não foi validado) ou quem a gerencia. Toda correção volta para validação. */
  async function atualizar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    d: { entrada?: string; saida?: string; observacao?: string | null; arquivar?: boolean },
  ): Promise<RegistroHorasDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      if (antes.fechado) throw periodoFechado();
      if (antes.usuarioId === ctx.usuarioId) {
        if (antes.status === "validado") throw conflito("Este registro já foi validado. Peça ao gestor para corrigir.");
      } else {
        await exigirGestao(tx, ctx, escopo, antes.usuarioId);
      }
      if (d.arquivar) {
        await tx.db.update(registroHoras).set({ arquivadoEm: new Date(), atualizadoEm: new Date() }).where(eq(registroHoras.id, id));
        await registrar(tx, origem, { acao: "horas.arquivadas", entidade: "registro_horas", entidadeId: id, responsavelId: antes.usuarioId, antes: dto(antes) });
        return dto(antes);
      }
      const entrada = d.entrada ? new Date(d.entrada) : antes.entrada;
      const saida = d.saida ? new Date(d.saida) : antes.saida;
      if (!saida) throw invalido("Informe a saída para corrigir um ponto aberto.");
      validarPeriodo(entrada, saida);
      const data = diaLocal(ctx, entrada);
      if (data !== antes.data && (await mesFechado(tx, ctx.empresaId, data))) throw periodoFechado();
      await semSobreposicao(tx, ctx.empresaId, antes.usuarioId, entrada, saida, id);
      await tx.db
        .update(registroHoras)
        .set({
          entrada,
          saida,
          data,
          ...(d.observacao !== undefined ? { observacao: d.observacao } : {}),
          status: "pendente",
          validadoPor: null,
          validadoEm: null,
          motivo: null,
          atualizadoEm: new Date(),
        })
        .where(eq(registroHoras.id, id));
      await registrar(tx, origem, {
        acao: "horas.corrigidas",
        entidade: "registro_horas",
        entidadeId: id,
        responsavelId: antes.usuarioId,
        antes: { entrada: antes.entrada, saida: antes.saida, status: antes.status },
        depois: { entrada, saida },
      });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function validar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, d: { aprovar: boolean; motivo: string | null }): Promise<RegistroHorasDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      if (antes.usuarioId === ctx.usuarioId) throw invalido("Ninguém valida as próprias horas. Peça ao seu gestor.");
      await exigirGestao(tx, ctx, escopo, antes.usuarioId);
      if (antes.fechado) throw periodoFechado();
      if (antes.status !== "pendente") throw conflito("Só registros aguardando validação podem ser validados ou recusados.");
      if (!d.aprovar && !d.motivo) throw invalido("Diga o motivo da recusa para a pessoa poder corrigir.");
      await tx.db
        .update(registroHoras)
        .set({ status: d.aprovar ? "validado" : "recusado", validadoPor: ctx.usuarioId, validadoEm: new Date(), motivo: d.motivo, atualizadoEm: new Date() })
        .where(eq(registroHoras.id, id));
      await registrar(tx, origem, {
        acao: d.aprovar ? "horas.validadas" : "horas.recusadas",
        entidade: "registro_horas",
        entidadeId: id,
        responsavelId: antes.usuarioId,
        paraUsuarioId: antes.usuarioId,
        dados: { data: antes.data, motivo: d.motivo },
      });
      return dto(await carregar(tx, ctx, "empresa", id));
    });
  }

  async function listar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { mes: string; usuarioId?: string; status?: StatusHorasId; cursor?: string; limite: number },
  ): Promise<Pagina<RegistroHorasDto>> {
    const { inicio, fim } = limitesPeriodo("mes", `${f.mes}-01`);
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await consulta(tx)
        .where(
          and(
            eq(registroHoras.empresaId, ctx.empresaId),
            isNull(registroHoras.arquivadoEm),
            filtroUsuariosVisiveis(ctx, escopo, registroHoras.usuarioId),
            sql`${registroHoras.data} BETWEEN ${inicio}::date AND ${fim}::date`,
            f.usuarioId ? eq(registroHoras.usuarioId, f.usuarioId) : undefined,
            f.status ? eq(registroHoras.status, f.status) : undefined,
            condicaoCursor(registroHoras.criadoEm, registroHoras.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(registroHoras.criadoEm), desc(registroHoras.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, dto);
    });
  }

  /** Ponto aberto da própria pessoa (para o botão "Entrar/Sair"). */
  async function meuPonto(ctx: ContextoEmpresa): Promise<RegistroHorasDto | null> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [l] = await consulta(tx).where(
        and(eq(registroHoras.empresaId, ctx.empresaId), eq(registroHoras.usuarioId, ctx.usuarioId), eq(registroHoras.status, "aberto"), isNull(registroHoras.arquivadoEm)),
      );
      return l ? dto(l) : null;
    });
  }

  // Escala --------------------------------------------------------------------------------------------

  async function lerEscala(tx: Tx, empresaId: string, usuarioId: string): Promise<EscalaDto> {
    const linhas = await tx.db
      .select({ diaSemana: escala.diaSemana, inicio: escala.inicio, fim: escala.fim })
      .from(escala)
      .where(and(eq(escala.empresaId, empresaId), eq(escala.usuarioId, usuarioId), isNull(escala.arquivadoEm)))
      .orderBy(escala.diaSemana, escala.inicio);
    const intervalos = linhas.map((l) => ({ diaSemana: l.diaSemana, inicio: hhmm(l.inicio), fim: hhmm(l.fim) }));
    return { usuarioId, intervalos, minutosSemana: intervalos.reduce((t, i) => t + minutosDoDia(i.fim) - minutosDoDia(i.inicio), 0) };
  }

  async function obterEscala(ctx: ContextoEmpresa, escopo: Escopo, usuarioId: string): Promise<EscalaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await exigirPessoa(tx, ctx, escopo, usuarioId);
      return lerEscala(tx, ctx.empresaId, usuarioId);
    });
  }

  async function salvarEscala(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    usuarioId: string,
    intervalos: { diaSemana: number; inicio: string; fim: string }[],
  ): Promise<EscalaDto> {
    // Intervalos do mesmo dia não podem se cruzar.
    const ordenados = [...intervalos].sort((a, b) => a.diaSemana - b.diaSemana || a.inicio.localeCompare(b.inicio));
    for (let i = 1; i < ordenados.length; i++) {
      if (ordenados[i].diaSemana === ordenados[i - 1].diaSemana && ordenados[i].inicio < ordenados[i - 1].fim) {
        throw invalido("Há horários que se cruzam no mesmo dia. Ajuste a escala.");
      }
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await exigirGestao(tx, ctx, escopo, usuarioId);
      const antes = await lerEscala(tx, ctx.empresaId, usuarioId);
      await tx.db
        .update(escala)
        .set({ arquivadoEm: new Date() })
        .where(and(eq(escala.empresaId, ctx.empresaId), eq(escala.usuarioId, usuarioId), isNull(escala.arquivadoEm)));
      if (ordenados.length) {
        await tx.db.insert(escala).values(ordenados.map((i) => ({ empresaId: ctx.empresaId, usuarioId, ...i, criadoPor: ctx.usuarioId })));
      }
      const depois = await lerEscala(tx, ctx.empresaId, usuarioId);
      await registrar(tx, origem, {
        acao: "escala.alterada",
        entidade: "escala",
        entidadeId: usuarioId,
        responsavelId: usuarioId,
        antes: antes.intervalos,
        depois: depois.intervalos,
        dados: { minutosSemana: depois.minutosSemana },
      });
      return depois;
    });
  }

  // Resumo e fechamento -------------------------------------------------------------------------------

  async function resumo(ctx: ContextoEmpresa, escopo: Escopo, f: { mes: string; cursor?: string; limite: number }): Promise<Pagina<ResumoHorasDto>> {
    const { inicio, fim } = limitesPeriodo("mes", `${f.mes}-01`);
    // Quantas vezes cada dia da semana aparece no mês.
    const ocorrencias = [0, 0, 0, 0, 0, 0, 0];
    for (let d = inicio; d <= fim; d = somarDias(d, 1)) ocorrencias[new Date(`${d}T00:00:00Z`).getUTCDay()]++;
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { pessoas, proximoCursor } = await pessoasVisiveis(tx, ctx, escopo, f);
      const ids = pessoas.map((p) => p.id);
      if (!ids.length) return { itens: [], proximoCursor };
      const escalas = await tx.db
        .select({ usuarioId: escala.usuarioId, diaSemana: escala.diaSemana, inicio: escala.inicio, fim: escala.fim })
        .from(escala)
        .where(and(eq(escala.empresaId, ctx.empresaId), inArray(escala.usuarioId, ids), isNull(escala.arquivadoEm)));
      const previsto = new Map<string, number>();
      for (const e of escalas) {
        previsto.set(e.usuarioId, (previsto.get(e.usuarioId) ?? 0) + (minutosDoDia(e.fim) - minutosDoDia(e.inicio)) * ocorrencias[e.diaSemana]);
      }
      const totais = await tx.db
        .select({
          usuarioId: registroHoras.usuarioId,
          registrado: sql<string>`coalesce(sum(extract(epoch FROM ${registroHoras.saida} - ${registroHoras.entrada}) / 60) FILTER (WHERE ${registroHoras.status} IN ('pendente', 'validado')), 0)`,
          validado: sql<string>`coalesce(sum(extract(epoch FROM ${registroHoras.saida} - ${registroHoras.entrada}) / 60) FILTER (WHERE ${registroHoras.status} = 'validado'), 0)`,
          pendentes: sql<string>`count(*) FILTER (WHERE ${registroHoras.status} = 'pendente')`,
          abertos: sql<string>`count(*) FILTER (WHERE ${registroHoras.status} = 'aberto')`,
        })
        .from(registroHoras)
        .where(
          and(
            eq(registroHoras.empresaId, ctx.empresaId),
            inArray(registroHoras.usuarioId, ids),
            isNull(registroHoras.arquivadoEm),
            sql`${registroHoras.data} BETWEEN ${inicio}::date AND ${fim}::date`,
          ),
        )
        .groupBy(registroHoras.usuarioId);
      const porPessoa = new Map(totais.map((t) => [t.usuarioId, t]));
      return {
        itens: pessoas.map((p) => {
          const t = porPessoa.get(p.id);
          return {
            usuarioId: p.id,
            nome: p.nome,
            previstoMinutos: previsto.get(p.id) ?? 0,
            registradoMinutos: Math.round(Number(t?.registrado ?? 0)),
            validadoMinutos: Math.round(Number(t?.validado ?? 0)),
            pendentes: Number(t?.pendentes ?? 0),
            emAndamento: Number(t?.abertos ?? 0) > 0,
          };
        }),
        proximoCursor,
      };
    });
  }

  function consultaFechamentos(tx: Tx) {
    return tx.db
      .select({
        id: fechamentoHoras.id,
        mes: fechamentoHoras.mes,
        fechadoEm: fechamentoHoras.fechadoEm,
        criadoEm: fechamentoHoras.fechadoEm,
        fechadoPorNome: quemFechou.nome,
        reabertoEm: fechamentoHoras.reabertoEm,
        reabertoPorNome: quemReabriu.nome,
        motivoReabertura: fechamentoHoras.motivoReabertura,
      })
      .from(fechamentoHoras)
      .leftJoin(quemFechou, eq(quemFechou.id, fechamentoHoras.fechadoPor))
      .leftJoin(quemReabriu, eq(quemReabriu.id, fechamentoHoras.reabertoPor));
  }
  type LinhaFechamento = Awaited<ReturnType<ReturnType<typeof consultaFechamentos>["execute"]>>[number];
  const fechamentoDto = (l: LinhaFechamento): FechamentoDto => ({
    id: l.id,
    mes: l.mes.slice(0, 7),
    fechadoEm: iso(l.fechadoEm),
    fechadoPorNome: l.fechadoPorNome,
    reabertoEm: iso(l.reabertoEm),
    reabertoPorNome: l.reabertoPorNome,
    motivoReabertura: l.motivoReabertura,
  });

  async function fechamentos(ctx: ContextoEmpresa, f: { cursor?: string; limite: number }): Promise<Pagina<FechamentoDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await consultaFechamentos(tx)
        .where(and(eq(fechamentoHoras.empresaId, ctx.empresaId), condicaoCursor(fechamentoHoras.fechadoEm, fechamentoHoras.id, lerCursor(f.cursor))))
        .orderBy(desc(fechamentoHoras.fechadoEm), desc(fechamentoHoras.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, fechamentoDto);
    });
  }

  async function fecharMes(ctx: ContextoEmpresa, origem: Origem, mes: string): Promise<FechamentoDto> {
    const { inicio, fim } = limitesPeriodo("mes", `${mes}-01`);
    if (inicio > hojeNoFuso(fusoDe(ctx))) throw invalido("Não dá para fechar um mês que ainda não começou.");
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [p] = await tx.db
        .select({ n: sql<string>`count(*)` })
        .from(registroHoras)
        .where(
          and(
            eq(registroHoras.empresaId, ctx.empresaId),
            isNull(registroHoras.arquivadoEm),
            inArray(registroHoras.status, ["aberto", "pendente"]),
            sql`${registroHoras.data} BETWEEN ${inicio}::date AND ${fim}::date`,
          ),
        );
      const pendentes = Number(p?.n ?? 0);
      if (pendentes) {
        throw new ErroApp(
          409,
          "CONFLITO",
          `Ainda há ${pendentes} registro(s) em andamento ou aguardando validação neste mês. Valide ou recuse antes de fechar.`,
          { pendentes },
        );
      }
      let id: string;
      try {
        [{ id }] = await tx.db.insert(fechamentoHoras).values({ empresaId: ctx.empresaId, mes: inicio, fechadoPor: ctx.usuarioId }).returning({ id: fechamentoHoras.id });
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Este mês já está fechado.");
        throw err;
      }
      await registrar(tx, origem, { acao: "horas.mes_fechado", entidade: "fechamento_horas", entidadeId: id, depois: { mes }, dados: { mes } });
      const [l] = await consultaFechamentos(tx).where(eq(fechamentoHoras.id, id));
      return fechamentoDto(l);
    });
  }

  async function reabrirMes(ctx: ContextoEmpresa, origem: Origem, id: string, motivo: string): Promise<FechamentoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [f] = await tx.db.select().from(fechamentoHoras).where(and(eq(fechamentoHoras.id, id), eq(fechamentoHoras.empresaId, ctx.empresaId)));
      if (!f) throw naoEncontrado("Fechamento");
      if (f.reabertoEm) throw conflito("Este fechamento já foi reaberto.");
      await tx.db.update(fechamentoHoras).set({ reabertoEm: new Date(), reabertoPor: ctx.usuarioId, motivoReabertura: motivo }).where(eq(fechamentoHoras.id, id));
      await registrar(tx, origem, { acao: "horas.mes_reaberto", entidade: "fechamento_horas", entidadeId: id, depois: { motivo }, dados: { mes: f.mes.slice(0, 7), motivo } });
      const [l] = await consultaFechamentos(tx).where(eq(fechamentoHoras.id, id));
      return fechamentoDto(l);
    });
  }

  return { ponto, meuPonto, criar, atualizar, validar, listar, obterEscala, salvarEscala, resumo, fechamentos, fecharMes, reabrirMes };
}

