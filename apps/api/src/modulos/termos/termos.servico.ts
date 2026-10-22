// Documentos legais com aceite versionado (fase 9). Termos e privacidade: cada pessoa aceita. Contrato de dados: a
// empresa aceita, por quem administra. Versão nova = aceite de novo no próximo acesso. O aceite nunca muda nem some.
import { DOCUMENTOS_LEGAIS, type DocumentoLegalDto, type DocumentoLegalId } from "@mg/shared";
import type { Config } from "../../config.js";
import { comoSistema, type Banco, type Tx } from "../../infra/banco.js";
import { semPermissao } from "../../infra/erros.js";
import type { Contexto } from "../acesso/acesso.js";
import { auditar } from "../auditoria/registro.js";
import { CONTRATO, PRIVACIDADE, TERMOS } from "./textos.js";

/** Suba a versão quando o texto mudar de sentido (correção de digitação não precisa). */
export const VERSOES_DOCUMENTOS: Record<DocumentoLegalId, { versao: string; vigencia: string }> = {
  termos: { versao: "1.0", vigencia: "2026-10-22" },
  privacidade: { versao: "1.0", vigencia: "2026-10-22" },
  contrato: { versao: "1.0", vigencia: "2026-10-22" },
};
const TEXTOS: Record<DocumentoLegalId, string> = { termos: TERMOS, privacidade: PRIVACIDADE, contrato: CONTRATO };

const daEmpresa = (id: DocumentoLegalId) => DOCUMENTOS_LEGAIS.find((d) => d.id === id)!.aceite === "empresa";
/** Quem aceita o contrato de dados em nome da empresa. */
const administra = (ctx: Contexto) => Boolean(ctx.empresaId && ctx.permissoes.configuracoes?.administrar);

export function documento(config: Config, id: DocumentoLegalId): DocumentoLegalDto {
  const { versao, vigencia } = VERSOES_DOCUMENTOS[id];
  const texto = TEXTOS[id]
    .replaceAll("{plataforma}", config.produtoNome)
    .replaceAll("{versao}", versao)
    .replaceAll("{vigencia}", vigencia.split("-").reverse().join("/"))
    .replaceAll("{encarregado}", config.encarregadoDados ?? "Ainda não indicado. Enquanto isso, fale pelo suporte da central de ajuda.");
  return { id, titulo: DOCUMENTOS_LEGAIS.find((d) => d.id === id)!.titulo, versao, vigencia, texto };
}

/** Grava o aceite (idempotente: aceitar duas vezes a mesma versão não duplica). */
async function gravar(tx: Tx, usuarioId: string, empresaId: string | null, ip: string | null, documentos: DocumentoLegalId[]): Promise<void> {
  for (const d of documentos) {
    const empresa = daEmpresa(d) ? empresaId : null;
    if (daEmpresa(d) && !empresa) continue;
    await tx.cliente.query(
      `INSERT INTO termo_aceite (usuario_id, empresa_id, documento, versao, ip) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [usuarioId, empresa, d, VERSOES_DOCUMENTOS[d].versao, ip],
    );
  }
}

/** Cadastro pelo site: quem cria a empresa aceita os três documentos ali mesmo. */
export async function aceitarNoCadastro(tx: Tx, usuarioId: string, empresaId: string, ip: string | null): Promise<void> {
  await gravar(tx, usuarioId, empresaId, ip, ["termos", "privacidade", "contrato"]);
}

/** Convite aceito com "Li e aceito": termos e privacidade da pessoa (o contrato de dados é da empresa). */
export async function aceitarDocumentosDaPessoa(tx: Tx, usuarioId: string, ip: string | null): Promise<void> {
  await gravar(tx, usuarioId, null, ip, ["termos", "privacidade"]);
}

export function criarServicoTermos(banco: Banco) {
  /** Documentos com versão nova ainda não aceita (uma consulta só, junto com o "eu"). */
  async function pendentes(ctx: Contexto): Promise<DocumentoLegalId[]> {
    const { rows } = await comoSistema(banco, (tx) =>
      tx.cliente.query<{ documento: DocumentoLegalId; versao: string }>(
        `SELECT documento, versao FROM termo_aceite
          WHERE (usuario_id = $1 AND empresa_id IS NULL) OR (empresa_id = $2 AND documento = 'contrato')`,
        [ctx.usuarioId, ctx.empresaId],
      ),
    );
    const aceitos = new Set(rows.map((r) => `${r.documento}:${r.versao}`));
    return DOCUMENTOS_LEGAIS.filter((d) => (d.aceite === "pessoa" || administra(ctx)) && !aceitos.has(`${d.id}:${VERSOES_DOCUMENTOS[d.id].versao}`)).map((d) => d.id);
  }

  async function aceitar(ctx: Contexto, ip: string | null, documentos: DocumentoLegalId[]): Promise<{ ok: true }> {
    if (documentos.some(daEmpresa) && !administra(ctx)) throw semPermissao();
    await comoSistema(banco, async (tx) => {
      await gravar(tx, ctx.usuarioId, ctx.empresaId, ip, documentos);
      await auditar(
        tx,
        { empresaId: ctx.empresaId, atorId: ctx.usuarioId, ip, dispositivo: null },
        { acao: "termos.aceitos", entidade: "usuario", entidadeId: ctx.usuarioId, depois: Object.fromEntries(documentos.map((d) => [d, VERSOES_DOCUMENTOS[d].versao])) },
      );
    });
    return { ok: true };
  }

  return { pendentes, aceitar };
}
