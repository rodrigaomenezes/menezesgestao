// Dados da empresa (nome, slug, fuso, marca) e unidades.
import { and, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { lerMarca, type EmpresaDto, type Pagina, type UnidadeDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { empresa, unidade } from "../../infra/esquema.js";
import { codigoPg, conflito, invalido, naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";

const FUSOS = new Set(Intl.supportedValuesOf("timeZone"));

const colunasUnidade = {
  id: unidade.id,
  nome: unidade.nome,
  endereco: unidade.endereco,
  criadoEm: unidade.criadoEm,
  arquivadoEm: unidade.arquivadoEm,
};
type LinhaUnidade = { id: string; nome: string; endereco: string | null; criadoEm: Date; arquivadoEm: Date | null };
const unidadeDto = (u: LinhaUnidade): UnidadeDto => ({ ...u, criadoEm: iso(u.criadoEm), arquivadoEm: iso(u.arquivadoEm) });

async function buscarEmpresa(tx: Tx, id: string) {
  const [e] = await tx.db.select().from(empresa).where(eq(empresa.id, id));
  if (!e) throw naoEncontrado("Empresa");
  return e;
}

export function criarServicoEmpresas(s: Servicos) {
  const { banco } = s;

  async function obter(ctx: ContextoEmpresa): Promise<EmpresaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const e = await buscarEmpresa(tx, ctx.empresaId);
      return { id: e.id, nome: e.nome, slug: e.slug, fuso: e.fuso, plano: e.plano, modulos: e.modulos, marca: lerMarca(e.marca) };
    });
  }

  async function atualizar(
    ctx: ContextoEmpresa,
    origem: Origem,
    dados: { nome?: string; slug?: string; fuso?: string; marca?: { nomeProduto?: string; corPrimaria: string; corDestaque: string } },
  ): Promise<EmpresaDto> {
    if (dados.fuso && !FUSOS.has(dados.fuso)) throw invalido("Fuso horário desconhecido.");
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await buscarEmpresa(tx, ctx.empresaId);
      try {
        // A marca é mesclada: o logo (enviado em outra tela) não se perde ao trocar as cores.
        const marca = dados.marca ? { ...lerMarca(antes.marca), ...dados.marca } : undefined;
        await tx.db.update(empresa).set({ ...dados, ...(marca ? { marca } : {}), atualizadoEm: new Date() }).where(eq(empresa.id, ctx.empresaId));
      } catch (err) {
        // O RLS não deixa ver os slugs das outras empresas: quem garante a unicidade é o índice único do banco.
        if (codigoPg(err) === "23505") throw conflito("Este identificador já está em uso. Escolha outro.");
        throw err;
      }
      await registrar(tx, origem, {
        acao: "empresa.atualizada",
        entidade: "empresa",
        entidadeId: ctx.empresaId,
        antes: { nome: antes.nome, slug: antes.slug, fuso: antes.fuso, marca: antes.marca },
        depois: dados,
      });
    });
    return obter(ctx);
  }

  async function listarUnidades(
    ctx: ContextoEmpresa,
    f: { arquivados: "sim" | "nao"; busca?: string; cursor?: string; limite: number },
  ): Promise<Pagina<UnidadeDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .select(colunasUnidade)
        .from(unidade)
        .where(
          and(
            eq(unidade.empresaId, ctx.empresaId),
            f.arquivados === "sim" ? isNotNull(unidade.arquivadoEm) : isNull(unidade.arquivadoEm),
            f.busca ? ilike(unidade.nome, `%${f.busca}%`) : undefined,
            condicaoCursor(unidade.criadoEm, unidade.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(unidade.criadoEm), desc(unidade.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, unidadeDto);
    });
  }

  async function criarUnidade(ctx: ContextoEmpresa, origem: Origem, dados: { nome: string; endereco?: string | null }): Promise<UnidadeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [u] = await tx.db
        .insert(unidade)
        .values({ empresaId: ctx.empresaId, nome: dados.nome, endereco: dados.endereco ?? null, criadoPor: ctx.usuarioId })
        .returning(colunasUnidade);
      await registrar(tx, origem, { acao: "unidade.criada", entidade: "unidade", entidadeId: u.id, depois: u });
      return unidadeDto(u);
    });
  }

  async function atualizarUnidade(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string,
    dados: { nome?: string; endereco?: string | null },
  ): Promise<UnidadeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const condicao = and(eq(unidade.id, id), eq(unidade.empresaId, ctx.empresaId));
      const [antes] = await tx.db.select(colunasUnidade).from(unidade).where(condicao);
      if (!antes) throw naoEncontrado("Unidade");
      const [depois] = await tx.db.update(unidade).set({ ...dados, atualizadoEm: new Date() }).where(condicao).returning(colunasUnidade);
      await registrar(tx, origem, { acao: "unidade.atualizada", entidade: "unidade", entidadeId: id, antes, depois });
      return unidadeDto(depois);
    });
  }

  async function alternarArquivoUnidade(ctx: ContextoEmpresa, origem: Origem, id: string, arquivar: boolean): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [u] = await tx.db
        .update(unidade)
        .set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() })
        .where(and(eq(unidade.id, id), eq(unidade.empresaId, ctx.empresaId)))
        .returning({ id: unidade.id });
      if (!u) throw naoEncontrado("Unidade");
      await registrar(tx, origem, {
        acao: arquivar ? "unidade.arquivada" : "unidade.restaurada",
        entidade: "unidade",
        entidadeId: id,
      });
    });
  }

  return { obter, atualizar, listarUnidades, criarUnidade, atualizarUnidade, alternarArquivoUnidade };
}
