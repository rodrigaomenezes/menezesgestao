// Marca da empresa (nome do produto, cores com contraste verificado, logo claro/escuro), domínio próprio e
// vocabulário. A tela de entrada e o manifesto do app usam a marca do endereço (subdomínio ou domínio próprio).
import { eq } from "drizzle-orm";
import { MARCA_PADRAO, corDoTextoSobre, lerMarca, type ConfigMarcaDto, type Marca, type MarcaPublicaDto } from "@mg/shared";
import { comEmpresa, comoSistema } from "../../infra/banco.js";
import { empresa } from "../../infra/esquema.js";
import { codigoPg, conflito, invalido, naoEncontrado } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import type { Contexto, ContextoEmpresa } from "../acesso/acesso.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { limparHost, resolvedorDominio } from "./dominio.js";

export const TIPOS_LOGO = ["claro", "escuro"] as const;
export type TipoLogo = (typeof TIPOS_LOGO)[number];
export const MIMES_LOGO = new Set(["image/png", "image/jpeg", "image/webp"]);
export const LIMITE_LOGO = 512 * 1024;

const urlLogo = (slug: string, tipo: TipoLogo, id: string | undefined) => (id ? `/api/publico/logo/${slug}/${tipo}?v=${id.slice(0, 8)}` : null);

export function criarServicoMarca(s: Servicos, arquivos: ProvedorArquivos) {
  const { banco, config } = s;
  const dominios = resolvedorDominio(s);

  /** Marca da empresa ativa (logado) ou do endereço; senão, a do produto. */
  async function publica(ctx: Contexto | null, host: string | undefined): Promise<MarcaPublicaDto> {
    let alvo: { slug: string; nome: string; marca: Marca } | null = null;
    if (ctx?.empresaId && ctx.marca && ctx.empresaSlug) alvo = { slug: ctx.empresaSlug, nome: ctx.empresaNome ?? "", marca: ctx.marca };
    else alvo = await dominios.porHost(host);
    const marca = alvo?.marca ?? MARCA_PADRAO;
    return {
      nomeProduto: marca.nomeProduto ?? config.produtoNome,
      corPrimaria: marca.corPrimaria,
      corDestaque: marca.corDestaque,
      empresa: alvo?.nome ?? null,
      logoClaro: alvo ? urlLogo(alvo.slug, "claro", marca.logoClaroId) : null,
      logoEscuro: alvo ? urlLogo(alvo.slug, "escuro", marca.logoEscuroId) : null,
      cadastroAberto: config.cadastroAberto,
    };
  }

  async function carregar(empresaId: string) {
    return comEmpresa(banco, empresaId, async (tx) => {
      const [e] = await tx.db.select().from(empresa).where(eq(empresa.id, empresaId));
      if (!e) throw naoEncontrado("Empresa");
      return e;
    });
  }

  async function configuracao(ctx: ContextoEmpresa): Promise<ConfigMarcaDto> {
    const e = await carregar(ctx.empresaId);
    const m = lerMarca(e.marca);
    const vocab = Object.fromEntries(Object.entries((e.vocabulario ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    return {
      nomeProduto: m.nomeProduto ?? null,
      corPrimaria: m.corPrimaria,
      corDestaque: m.corDestaque,
      logoClaro: urlLogo(e.slug, "claro", m.logoClaroId),
      logoEscuro: urlLogo(e.slug, "escuro", m.logoEscuroId),
      dominio: e.dominio,
      subdominio: config.dominioBase ? `${e.slug}.${config.dominioBase}` : null,
      vocabulario: vocab,
    };
  }

  async function gravarMarca(ctx: ContextoEmpresa, origem: Origem, mudar: (m: Marca) => Marca, acao: string): Promise<ConfigMarcaDto> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ marca: empresa.marca }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      const antes = lerMarca(e?.marca);
      const depois = mudar(antes);
      await tx.db.update(empresa).set({ marca: depois, atualizadoEm: new Date() }).where(eq(empresa.id, ctx.empresaId));
      await registrar(tx, origem, { acao, entidade: "empresa", entidadeId: ctx.empresaId, antes, depois });
    });
    dominios.esquecer();
    return configuracao(ctx);
  }

  const salvarCores = (ctx: ContextoEmpresa, origem: Origem, d: { nomeProduto?: string; corPrimaria: string; corDestaque: string }) =>
    gravarMarca(ctx, origem, (m) => ({ ...m, nomeProduto: d.nomeProduto || undefined, corPrimaria: d.corPrimaria, corDestaque: d.corDestaque }), "empresa.marca_alterada");

  async function salvarLogo(ctx: ContextoEmpresa, origem: Origem, tipo: TipoLogo, a: { nome: string; mime: string; conteudo: Buffer }): Promise<ConfigMarcaDto> {
    if (!MIMES_LOGO.has(a.mime)) throw invalido("Use uma imagem PNG, JPG ou WebP.");
    if (a.conteudo.length > LIMITE_LOGO) throw invalido("O logo pode ter no máximo 512 KB.");
    const { id } = await arquivos.gravar(ctx.empresaId, { nome: a.nome, tipoMime: a.mime, conteudo: a.conteudo, criadoPor: ctx.usuarioId });
    return gravarMarca(ctx, origem, (m) => ({ ...m, [tipo === "claro" ? "logoClaroId" : "logoEscuroId"]: id }), "empresa.logo_alterado");
  }

  const removerLogo = (ctx: ContextoEmpresa, origem: Origem, tipo: TipoLogo) =>
    gravarMarca(ctx, origem, (m) => ({ ...m, [tipo === "claro" ? "logoClaroId" : "logoEscuroId"]: undefined }), "empresa.logo_removido");

  /** Logo público pelo identificador da empresa (é a marca dela: aparece na tela de entrada). */
  async function logo(slug: string, tipo: TipoLogo) {
    const [e] = await comoSistema(banco, (tx) => tx.db.select({ id: empresa.id, marca: empresa.marca }).from(empresa).where(eq(empresa.slug, slug)));
    const m = e ? lerMarca(e.marca) : null;
    const arquivoId = tipo === "claro" ? m?.logoClaroId : m?.logoEscuroId;
    if (!e || !arquivoId) throw naoEncontrado("Logo");
    return arquivos.ler(e.id, arquivoId);
  }

  /** Ícone do app gerado da marca: inicial do nome sobre a cor principal. */
  async function icone(slug: string): Promise<string> {
    const [e] = await comoSistema(banco, (tx) => tx.db.select({ nome: empresa.nome, marca: empresa.marca }).from(empresa).where(eq(empresa.slug, slug)));
    if (!e) throw naoEncontrado("Empresa");
    const m = lerMarca(e.marca);
    const nome = m.nomeProduto ?? e.nome;
    const inicial = (nome.trim()[0] ?? "M").toUpperCase().replace(/[<>&"']/g, "");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="${m.corPrimaria}"/><text x="256" y="256" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="300" font-weight="700" fill="${corDoTextoSobre(m.corPrimaria)}">${inicial}</text></svg>`;
  }

  async function salvarDominio(ctx: ContextoEmpresa, origem: Origem, dominio: string | null): Promise<ConfigMarcaDto> {
    if (dominio) {
      const app = limparHost(new URL(config.appUrl).host);
      if (dominio === app || (config.dominioBase && (dominio === config.dominioBase || dominio.endsWith(`.${config.dominioBase}`)))) {
        throw invalido("Esse endereço é do próprio sistema. Use um domínio da sua empresa (ex.: app.suaempresa.com.br).");
      }
    }
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ dominio: empresa.dominio }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      try {
        await tx.db.update(empresa).set({ dominio, atualizadoEm: new Date() }).where(eq(empresa.id, ctx.empresaId));
      } catch (err) {
        if (codigoPg(err) === "23505") throw conflito("Esse domínio já está em uso por outra empresa.");
        throw err;
      }
      await registrar(tx, origem, { acao: "empresa.dominio_alterado", entidade: "empresa", entidadeId: ctx.empresaId, antes: { dominio: e?.dominio }, depois: { dominio } });
    });
    dominios.esquecer();
    return configuracao(ctx);
  }

  async function salvarVocabulario(ctx: ContextoEmpresa, origem: Origem, vocabulario: Record<string, string>): Promise<ConfigMarcaDto> {
    const limpo = Object.fromEntries(Object.entries(vocabulario).map(([k, v]) => [k, v.trim().toLowerCase()]));
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ vocabulario: empresa.vocabulario }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      await tx.db.update(empresa).set({ vocabulario: limpo, atualizadoEm: new Date() }).where(eq(empresa.id, ctx.empresaId));
      await registrar(tx, origem, { acao: "empresa.vocabulario_alterado", entidade: "empresa", entidadeId: ctx.empresaId, antes: e?.vocabulario, depois: limpo });
    });
    return configuracao(ctx);
  }

  return { publica, configuracao, salvarCores, salvarLogo, removerLogo, logo, icone, salvarDominio, salvarVocabulario };
}
