// Configuração do CRM por empresa: funis e etapas, motivos de perda, etiquetas e campos personalizados.
// Nada disso é código: cada empresa monta o seu (princípio 004). Ler é crm:ver; alterar é crm:administrar.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type {
  CampoPersonalizadoDto,
  ConfiguracaoCrmDto,
  EtapaDto,
  EtiquetaDto,
  FunilDto,
  MotivoPerdaDto,
  TipoCampo,
} from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { campoPersonalizado, etapa, etiqueta, funil, motivoPerda, usuario, vinculo } from "../../infra/esquema.js";
import { codigoPg, conflito, invalido, naoEncontrado } from "../../infra/erros.js";
import { iso } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import type { DefinicaoCampo } from "./campos.js";

type LinhaEtapa = typeof etapa.$inferSelect;
type LinhaFunil = typeof funil.$inferSelect;

export const etapaDto = (e: LinhaEtapa): EtapaDto => ({
  id: e.id,
  funilId: e.funilId,
  nome: e.nome,
  cor: e.cor,
  ordem: e.ordem,
  probabilidade: e.probabilidade,
  tipo: e.tipo,
  camposObrigatorios: e.camposObrigatorios,
  arquivadoEm: iso(e.arquivadoEm),
});
const funilDto = (f: LinhaFunil, etapas: LinhaEtapa[]): FunilDto => ({
  id: f.id,
  nome: f.nome,
  ordem: f.ordem,
  arquivadoEm: iso(f.arquivadoEm),
  etapas: etapas.filter((e) => e.funilId === f.id).map(etapaDto),
});
const etiquetaDto = (e: typeof etiqueta.$inferSelect): EtiquetaDto => ({ id: e.id, nome: e.nome, cor: e.cor, arquivadoEm: iso(e.arquivadoEm) });
const motivoDto = (m: typeof motivoPerda.$inferSelect): MotivoPerdaDto => ({ id: m.id, nome: m.nome, ordem: m.ordem, arquivadoEm: iso(m.arquivadoEm) });
const campoDto = (c: typeof campoPersonalizado.$inferSelect): CampoPersonalizadoDto => ({
  id: c.id,
  entidade: c.entidade,
  chave: c.chave,
  rotulo: c.rotulo,
  tipo: c.tipo,
  opcoes: c.opcoes,
  obrigatorio: c.obrigatorio,
  ordem: c.ordem,
  arquivadoEm: iso(c.arquivadoEm),
});

/** Funil genérico para empresa nova (o mesmo que a migração 0003 deu às existentes). */
export async function criarFunilPadrao(tx: Tx, empresaId: string): Promise<void> {
  const funilId = randomUUID();
  await tx.db.insert(funil).values({ id: funilId, empresaId, nome: "Vendas", ordem: 0 });
  const etapas: [string, string, number, "aberta" | "ganha" | "perdida"][] = [
    ["Novo contato", "#5b6470", 10, "aberta"],
    ["Em conversa", "#1f5fbf", 30, "aberta"],
    ["Proposta", "#7a3fbf", 60, "aberta"],
    ["Negociação", "#e07a1f", 80, "aberta"],
    ["Ganho", "#1e6b34", 100, "ganha"],
    ["Perdido", "#b3261e", 0, "perdida"],
  ];
  await tx.db.insert(etapa).values(
    etapas.map(([nome, cor, probabilidade, tipo], ordem) => ({ empresaId, funilId, nome, cor, ordem, probabilidade, tipo })),
  );
  await tx.db
    .insert(motivoPerda)
    .values(["Preço", "Sem interesse", "Escolheu a concorrência", "Não respondeu"].map((nome, ordem) => ({ empresaId, nome, ordem })));
}

/** Definições ativas dos campos personalizados de uma entidade. */
export async function definicoesDeCampos(tx: Tx, empresaId: string, entidade: "contato" | "oportunidade"): Promise<DefinicaoCampo[]> {
  return tx.db
    .select({
      chave: campoPersonalizado.chave,
      rotulo: campoPersonalizado.rotulo,
      tipo: campoPersonalizado.tipo,
      opcoes: campoPersonalizado.opcoes,
      obrigatorio: campoPersonalizado.obrigatorio,
    })
    .from(campoPersonalizado)
    .where(and(eq(campoPersonalizado.empresaId, empresaId), eq(campoPersonalizado.entidade, entidade), isNull(campoPersonalizado.arquivadoEm)))
    .orderBy(asc(campoPersonalizado.ordem)) as Promise<DefinicaoCampo[]>;
}

export async function buscarEtapa(tx: Tx, empresaId: string, id: string) {
  const [e] = await tx.db.select().from(etapa).where(and(eq(etapa.id, id), eq(etapa.empresaId, empresaId)));
  return e ?? null;
}

const CHAVES_FIXAS_OBRIGATORIAS = new Set(["valor", "oferta"]);

export function criarServicoConfiguracaoCrm(s: Servicos) {
  const { banco } = s;

  async function obter(ctx: ContextoEmpresa): Promise<ConfiguracaoCrmDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const funis = await tx.db.select().from(funil).where(and(eq(funil.empresaId, ctx.empresaId), isNull(funil.arquivadoEm))).orderBy(asc(funil.ordem), asc(funil.nome)).limit(50);
      const etapas = funis.length
        ? await tx.db.select().from(etapa).where(and(inArray(etapa.funilId, funis.map((f) => f.id)), isNull(etapa.arquivadoEm))).orderBy(asc(etapa.ordem))
        : [];
      const motivos = await tx.db.select().from(motivoPerda).where(and(eq(motivoPerda.empresaId, ctx.empresaId), isNull(motivoPerda.arquivadoEm))).orderBy(asc(motivoPerda.ordem)).limit(100);
      const etiquetas = await tx.db.select().from(etiqueta).where(and(eq(etiqueta.empresaId, ctx.empresaId), isNull(etiqueta.arquivadoEm))).orderBy(asc(etiqueta.nome)).limit(200);
      const campos = await tx.db
        .select()
        .from(campoPersonalizado)
        .where(and(eq(campoPersonalizado.empresaId, ctx.empresaId), isNull(campoPersonalizado.arquivadoEm)))
        .orderBy(asc(campoPersonalizado.entidade), asc(campoPersonalizado.ordem))
        .limit(200);
      const responsaveis = await tx.db
        .select({ id: usuario.id, nome: usuario.nome })
        .from(vinculo)
        .innerJoin(usuario, eq(usuario.id, vinculo.usuarioId))
        .where(and(eq(vinculo.empresaId, ctx.empresaId), eq(vinculo.status, "ativo"), isNull(vinculo.arquivadoEm)))
        .orderBy(asc(usuario.nome))
        .limit(500);
      return {
        funis: funis.map((f) => funilDto(f, etapas)),
        motivosPerda: motivos.map(motivoDto),
        etiquetas: etiquetas.map(etiquetaDto),
        campos: campos.map(campoDto),
        responsaveis,
      };
    });
  }

  /** Lista para a tela de configuração (inclui arquivados, para restaurar). */
  async function listarFunis(ctx: ContextoEmpresa): Promise<FunilDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const funis = await tx.db.select().from(funil).where(eq(funil.empresaId, ctx.empresaId)).orderBy(asc(funil.ordem), asc(funil.nome)).limit(100);
      const etapas = funis.length
        ? await tx.db.select().from(etapa).where(inArray(etapa.funilId, funis.map((f) => f.id))).orderBy(asc(etapa.ordem))
        : [];
      return funis.map((f) => funilDto(f, etapas));
    });
  }

  // Funis --------------------------------------------------------------------------------------------

  async function criarFunil(ctx: ContextoEmpresa, origem: Origem, dados: { nome: string; ordem: number }): Promise<FunilDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [f] = await tx.db.insert(funil).values({ empresaId: ctx.empresaId, ...dados, criadoPor: ctx.usuarioId }).returning();
      await registrar(tx, origem, { acao: "funil.criado", entidade: "funil", entidadeId: f.id, depois: dados });
      return funilDto(f, []);
    });
  }

  async function atualizarFunil(ctx: ContextoEmpresa, origem: Origem, id: string, dados: { nome?: string; ordem?: number; arquivado?: boolean }) {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const condicao = and(eq(funil.id, id), eq(funil.empresaId, ctx.empresaId));
      const [antes] = await tx.db.select().from(funil).where(condicao);
      if (!antes) throw naoEncontrado("Funil");
      const { arquivado, ...resto } = dados;
      await tx.db
        .update(funil)
        .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
        .where(condicao);
      const acao = arquivado === true ? "funil.arquivado" : arquivado === false ? "funil.restaurado" : "funil.atualizado";
      await registrar(tx, origem, { acao, entidade: "funil", entidadeId: id, antes: { nome: antes.nome, ordem: antes.ordem }, depois: resto });
    });
  }

  // Etapas -------------------------------------------------------------------------------------------

  async function validarCamposObrigatorios(tx: Tx, empresaId: string, chaves: string[]) {
    const definidas = new Set((await definicoesDeCampos(tx, empresaId, "oportunidade")).map((d) => d.chave));
    const desconhecida = chaves.find((c) => !CHAVES_FIXAS_OBRIGATORIAS.has(c) && !definidas.has(c));
    if (desconhecida) throw invalido(`O campo "${desconhecida}" não existe nas oportunidades. Crie o campo antes de exigi-lo.`);
  }

  async function criarEtapa(
    ctx: ContextoEmpresa,
    origem: Origem,
    dados: { funilId: string; nome: string; cor: string; ordem: number; probabilidade: number; tipo: "aberta" | "ganha" | "perdida"; camposObrigatorios: string[] },
  ): Promise<EtapaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [f] = await tx.db.select({ id: funil.id }).from(funil).where(and(eq(funil.id, dados.funilId), eq(funil.empresaId, ctx.empresaId)));
      if (!f) throw naoEncontrado("Funil");
      await validarCamposObrigatorios(tx, ctx.empresaId, dados.camposObrigatorios);
      const [e] = await tx.db.insert(etapa).values({ empresaId: ctx.empresaId, ...dados }).returning();
      await registrar(tx, origem, { acao: "etapa.criada", entidade: "etapa", entidadeId: e.id, depois: dados });
      return etapaDto(e);
    });
  }

  async function atualizarEtapa(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string,
    dados: Partial<{ nome: string; cor: string; ordem: number; probabilidade: number; tipo: "aberta" | "ganha" | "perdida"; camposObrigatorios: string[]; arquivado: boolean }>,
  ): Promise<EtapaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await buscarEtapa(tx, ctx.empresaId, id);
      if (!antes) throw naoEncontrado("Etapa");
      if (dados.camposObrigatorios) await validarCamposObrigatorios(tx, ctx.empresaId, dados.camposObrigatorios);
      const { arquivado, ...resto } = dados;
      const [depois] = await tx.db
        .update(etapa)
        .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
        .where(and(eq(etapa.id, id), eq(etapa.empresaId, ctx.empresaId)))
        .returning();
      const acao = arquivado === true ? "etapa.arquivada" : arquivado === false ? "etapa.restaurada" : "etapa.atualizada";
      await registrar(tx, origem, { acao, entidade: "etapa", entidadeId: id, antes: etapaDto(antes), depois: etapaDto(depois) });
      return etapaDto(depois);
    });
  }

  // Motivos de perda e etiquetas (listas simples) ----------------------------------------------------

  async function salvarMotivo(ctx: ContextoEmpresa, origem: Origem, id: string | null, dados: { nome?: string; ordem?: number; arquivado?: boolean }) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { arquivado, ...resto } = dados;
      let linha;
      if (id) {
        [linha] = await tx.db
          .update(motivoPerda)
          .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
          .where(and(eq(motivoPerda.id, id), eq(motivoPerda.empresaId, ctx.empresaId)))
          .returning();
        if (!linha) throw naoEncontrado("Motivo");
      } else {
        [linha] = await tx.db.insert(motivoPerda).values({ empresaId: ctx.empresaId, nome: resto.nome!, ordem: resto.ordem ?? 0 }).returning();
      }
      await registrar(tx, origem, { acao: id ? "motivo_perda.atualizado" : "motivo_perda.criado", entidade: "motivo_perda", entidadeId: linha.id, depois: dados });
      return motivoDto(linha);
    });
  }

  async function salvarEtiqueta(ctx: ContextoEmpresa, origem: Origem, id: string | null, dados: { nome?: string; cor?: string; arquivado?: boolean }) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { arquivado, ...resto } = dados;
      try {
        let linha;
        if (id) {
          [linha] = await tx.db
            .update(etiqueta)
            .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
            .where(and(eq(etiqueta.id, id), eq(etiqueta.empresaId, ctx.empresaId)))
            .returning();
          if (!linha) throw naoEncontrado("Etiqueta");
        } else {
          [linha] = await tx.db.insert(etiqueta).values({ empresaId: ctx.empresaId, nome: resto.nome!, cor: resto.cor, criadoPor: ctx.usuarioId }).returning();
        }
        await registrar(tx, origem, { acao: id ? "etiqueta.atualizada" : "etiqueta.criada", entidade: "etiqueta", entidadeId: linha.id, depois: dados });
        return etiquetaDto(linha);
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Já existe uma etiqueta com esse nome.");
        throw err;
      }
    });
  }

  // Campos personalizados ----------------------------------------------------------------------------

  async function criarCampo(
    ctx: ContextoEmpresa,
    origem: Origem,
    dados: { entidade: "contato" | "oportunidade"; chave: string; rotulo: string; tipo: TipoCampo; opcoes: string[]; obrigatorio: boolean; ordem: number },
  ): Promise<CampoPersonalizadoDto> {
    if (dados.tipo === "lista" && !dados.opcoes.length) throw invalido("Campo do tipo lista precisa de pelo menos uma opção.");
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      try {
        const [c] = await tx.db.insert(campoPersonalizado).values({ empresaId: ctx.empresaId, ...dados, criadoPor: ctx.usuarioId }).returning();
        await registrar(tx, origem, { acao: "campo_personalizado.criado", entidade: "campo_personalizado", entidadeId: c.id, depois: dados });
        return campoDto(c);
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Já existe um campo com esse identificador. Escolha outro.");
        throw err;
      }
    });
  }

  async function atualizarCampo(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string,
    dados: Partial<{ rotulo: string; opcoes: string[]; obrigatorio: boolean; ordem: number; arquivado: boolean }>,
  ): Promise<CampoPersonalizadoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const condicao = and(eq(campoPersonalizado.id, id), eq(campoPersonalizado.empresaId, ctx.empresaId));
      const [antes] = await tx.db.select().from(campoPersonalizado).where(condicao);
      if (!antes) throw naoEncontrado("Campo");
      if (antes.tipo === "lista" && dados.opcoes && !dados.opcoes.length) throw invalido("Campo do tipo lista precisa de pelo menos uma opção.");
      const { arquivado, ...resto } = dados;
      const [depois] = await tx.db
        .update(campoPersonalizado)
        .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
        .where(condicao)
        .returning();
      await registrar(tx, origem, { acao: "campo_personalizado.atualizado", entidade: "campo_personalizado", entidadeId: id, antes: campoDto(antes), depois: campoDto(depois) });
      return campoDto(depois);
    });
  }

  async function listarCampos(ctx: ContextoEmpresa): Promise<CampoPersonalizadoDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) =>
      (
        await tx.db
          .select()
          .from(campoPersonalizado)
          .where(eq(campoPersonalizado.empresaId, ctx.empresaId))
          .orderBy(asc(campoPersonalizado.entidade), asc(campoPersonalizado.ordem))
          .limit(300)
      ).map(campoDto),
    );
  }

  async function listarEtiquetasEMotivos(ctx: ContextoEmpresa) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => ({
      etiquetas: (await tx.db.select().from(etiqueta).where(eq(etiqueta.empresaId, ctx.empresaId)).orderBy(asc(etiqueta.nome)).limit(300)).map(etiquetaDto),
      motivosPerda: (await tx.db.select().from(motivoPerda).where(eq(motivoPerda.empresaId, ctx.empresaId)).orderBy(asc(motivoPerda.ordem)).limit(300)).map(motivoDto),
    }));
  }

  return {
    obter,
    listarFunis,
    criarFunil,
    atualizarFunil,
    criarEtapa,
    atualizarEtapa,
    salvarMotivo,
    salvarEtiqueta,
    criarCampo,
    atualizarCampo,
    listarCampos,
    listarEtiquetasEMotivos,
  };
}
