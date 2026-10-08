// Importação de contatos por planilha: envio → pré-visualização → mapeamento → processamento em fila → relatório.
// Idempotente pelo telefone normalizado: importar a mesma planilha duas vezes não duplica ninguém.
import { and, desc, eq, sql } from "drizzle-orm";
import { normalizarTelefone, type Escopo, type ImportacaoDto, type Pagina } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { contato, contatoEtiqueta, importacao } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { usuariosVisiveis } from "../acesso/escopo.js";
import { auditar, registrar, type Origem } from "../auditoria/registro.js";
import { notificar } from "../notificacoes/notificar.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { converterCampoImportado } from "./campos.js";
import { validarResponsavel } from "./carteira.js";
import { definicoesDeCampos } from "./configuracao.servico.js";
import { lerPlanilha } from "./planilha.js";
import * as contatos from "./contatos.repositorio.js";

export const FILA_IMPORTACAO = "crm.importacao";
const TAMANHO_LOTE = 500;
const MAX_ERROS = 200;

interface OpcoesImportacao {
  responsavelId: string;
  etiquetaIds: string[];
  origem: string | null;
  atualizarExistentes: boolean;
  atorId: string;
  /** Equipe e unidade de quem importou: definem a carteira que a importação pode atualizar. */
  unidadeId: string | null;
  equipeId: string | null;
  escopo: Escopo;
  ip: string | null;
  dispositivo: string | null;
}

type LinhaImportacao = typeof importacao.$inferSelect;

const dto = (i: LinhaImportacao): ImportacaoDto => ({
  id: i.id,
  nomeArquivo: i.nomeArquivo,
  status: i.status,
  colunas: i.colunas,
  totalLinhas: i.totalLinhas,
  amostra: i.amostra,
  novos: i.novos,
  atualizados: i.atualizados,
  inalterados: i.inalterados,
  ignorados: i.ignorados,
  erros: i.erros,
  criadoEm: iso(i.criadoEm),
  concluidaEm: iso(i.concluidaEm),
});

const EMAIL_SIMPLES = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function criarServicoImportacao(s: Servicos, arquivos: ProvedorArquivos) {
  const { banco } = s;

  async function carregar(tx: Tx, ctx: ContextoEmpresa, id: string) {
    const [i] = await tx.db.select().from(importacao).where(and(eq(importacao.id, id), eq(importacao.empresaId, ctx.empresaId)));
    // Cada um acompanha as próprias importações; quem administra o CRM vê todas.
    if (!i || (i.criadoPor !== ctx.usuarioId && !ctx.permissoes.crm?.administrar)) throw naoEncontrado("Importação");
    return i;
  }

  /** 1. Recebe o arquivo, lê o cabeçalho e devolve a pré-visualização. */
  async function receber(ctx: ContextoEmpresa, origem: Origem, nome: string, tipoMime: string, conteudo: Buffer): Promise<ImportacaoDto> {
    const planilha = await lerPlanilha(nome, conteudo);
    const { id: arquivoId } = await arquivos.gravar(ctx.empresaId, { nome, tipoMime, conteudo, criadoPor: ctx.usuarioId });
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [i] = await tx.db
        .insert(importacao)
        .values({
          empresaId: ctx.empresaId,
          arquivoId,
          nomeArquivo: nome.slice(0, 200),
          status: "PRONTA",
          colunas: planilha.colunas,
          amostra: planilha.linhas.slice(0, 5),
          totalLinhas: planilha.linhas.length,
          criadoPor: ctx.usuarioId,
        })
        .returning();
      await auditar(tx, origem, { acao: "importacao.recebida", entidade: "importacao", entidadeId: i.id, depois: { arquivo: nome, linhas: planilha.linhas.length } });
      return dto(i);
    });
  }

  /** 2. Confirma o mapeamento e manda processar em segundo plano. */
  async function confirmar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    dados: { mapeamento: Record<string, string>; responsavelId?: string | null; etiquetaIds: string[]; origem?: string | null; atualizarExistentes: boolean },
  ): Promise<ImportacaoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const i = await carregar(tx, ctx, id);
      if (i.status !== "PRONTA") throw invalido("Esta importação já foi confirmada. Envie o arquivo de novo para importar outra vez.");
      const colunas = new Set(i.colunas);
      const desconhecida = Object.values(dados.mapeamento).find((c) => !colunas.has(c));
      if (desconhecida) throw invalido(`A coluna "${desconhecida}" não existe na planilha.`);
      const campos = new Set((await definicoesDeCampos(tx, ctx.empresaId, "contato")).map((d) => `campo:${d.chave}`));
      const destinoInvalido = Object.keys(dados.mapeamento).find((d) => !["nome", "telefone", "email", "origem", "organizacao"].includes(d) && !campos.has(d));
      if (destinoInvalido) throw invalido(`Destino desconhecido no mapeamento: ${destinoInvalido}.`);
      const responsavelId = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      const etiquetaIds = (await contatos.etiquetasValidas(tx, ctx.empresaId, dados.etiquetaIds)).map((e) => e.id);
      const opcoes: OpcoesImportacao = {
        responsavelId,
        etiquetaIds,
        origem: dados.origem ?? null,
        atualizarExistentes: dados.atualizarExistentes,
        atorId: ctx.usuarioId,
        unidadeId: ctx.unidadeId,
        equipeId: ctx.equipeId,
        escopo,
        ip: origem.ip,
        dispositivo: origem.dispositivo,
      };
      const [atualizada] = await tx.db
        .update(importacao)
        .set({ status: "PENDENTE", mapeamento: dados.mapeamento, opcoes: opcoes as unknown as Record<string, unknown>, atualizadoEm: new Date() })
        .where(eq(importacao.id, id))
        .returning();
      await s.jobs.enfileirar(tx, FILA_IMPORTACAO, { empresaId: ctx.empresaId, importacaoId: id });
      await auditar(tx, origem, { acao: "importacao.confirmada", entidade: "importacao", entidadeId: id, depois: { mapeamento: dados.mapeamento, atualizarExistentes: dados.atualizarExistentes } });
      return dto(atualizada);
    });
  }

  /** 3. Processa (no job). Pode rodar de novo com segurança: tudo é decidido pelo telefone. */
  async function processar(empresaId: string, importacaoId: string): Promise<void> {
    const i = await comEmpresa(banco, empresaId, async (tx) => {
      const [linha] = await tx.db.select().from(importacao).where(eq(importacao.id, importacaoId));
      if (!linha || !["PENDENTE", "PROCESSANDO", "FALHOU"].includes(linha.status)) return null;
      await tx.db.update(importacao).set({ status: "PROCESSANDO", atualizadoEm: new Date() }).where(eq(importacao.id, importacaoId));
      return linha;
    });
    if (!i?.mapeamento || !i.opcoes) return;
    const opcoes = i.opcoes as unknown as OpcoesImportacao;
    const mapa = i.mapeamento;
    const indice = (destino: string) => (mapa[destino] ? i.colunas.indexOf(mapa[destino]) : -1);
    const contagem = { novos: 0, atualizados: 0, inalterados: 0, ignorados: 0 };
    const erros: { linha: number; motivo: string }[] = [];
    const ignorar = (linha: number, motivo: string) => {
      contagem.ignorados++;
      if (erros.length < MAX_ERROS) erros.push({ linha, motivo });
    };

    try {
      const { nome: nomeArquivo, conteudo } = await arquivos.ler(empresaId, i.arquivoId);
      const planilha = await lerPlanilha(nomeArquivo, conteudo);
      const origemAtor: Origem = { empresaId, atorId: opcoes.atorId, ip: opcoes.ip, dispositivo: opcoes.dispositivo };

      for (let inicio = 0; inicio < planilha.linhas.length; inicio += TAMANHO_LOTE) {
        const lote = planilha.linhas.slice(inicio, inicio + TAMANHO_LOTE);
        await comEmpresa(banco, empresaId, async (tx) => {
          const definicoes = await definicoesDeCampos(tx, empresaId, "contato");
          const visiveis = await usuariosVisiveis(tx, { usuarioId: opcoes.atorId, unidadeId: opcoes.unidadeId ?? null, equipeId: opcoes.equipeId ?? null }, opcoes.escopo);
          const valor = (l: string[], destino: string) => {
            const idx = indice(destino);
            return idx >= 0 ? (l[idx] ?? "").trim() : "";
          };

          for (const [pos, l] of lote.entries()) {
            const numero = inicio + pos + 2; // linha 1 é o cabeçalho
            const nome = valor(l, "nome");
            if (!nome) {
              ignorar(numero, "Sem nome.");
              continue;
            }
            const telefone = normalizarTelefone(valor(l, "telefone"));
            if (!telefone) {
              ignorar(numero, `Telefone inválido ou vazio: "${valor(l, "telefone")}".`);
              continue;
            }
            const emailBruto = valor(l, "email");
            const email = emailBruto && EMAIL_SIMPLES.test(emailBruto) ? emailBruto.toLowerCase() : null;
            const campos: Record<string, unknown> = {};
            let problemaCampo: string | null = null;
            for (const def of definicoes) {
              const bruto = valor(l, `campo:${def.chave}`);
              if (!bruto) continue;
              const r = converterCampoImportado(def, bruto);
              if (!r.ok) problemaCampo = r.motivo;
              else if (r.valor !== null) campos[def.chave] = r.valor;
            }
            if (problemaCampo) {
              ignorar(numero, problemaCampo);
              continue;
            }
            const origemContato = valor(l, "origem") || opcoes.origem;

            const existente = await tx.db
              .select({ id: contato.id, nome: contato.nome, email: contato.email, origem: contato.origem, campos: contato.campos, responsavelId: contato.responsavelId, arquivadoEm: contato.arquivadoEm })
              .from(contato)
              .where(and(eq(contato.empresaId, empresaId), eq(contato.telefone, telefone)))
              .then((r) => r[0]);

            if (!existente) {
              const organizacaoId = await organizacaoPorNome(tx, empresaId, valor(l, "organizacao"), opcoes.atorId, opcoes.responsavelId);
              const [{ id }] = await tx.db
                .insert(contato)
                .values({
                  empresaId,
                  nome,
                  telefone,
                  email,
                  origem: origemContato,
                  campos,
                  organizacaoId,
                  responsavelId: opcoes.responsavelId,
                  criadoPor: opcoes.atorId,
                })
                .returning({ id: contato.id });
              await etiquetar(tx, empresaId, id, opcoes.etiquetaIds);
              await registrar(tx, origemAtor, {
                acao: "contato.criado",
                entidade: "contato",
                entidadeId: id,
                contatoId: id,
                responsavelId: opcoes.responsavelId,
                silencioso: true,
                depois: { nome, telefone, email, origem: origemContato },
                dados: { importacaoId },
              });
              contagem.novos++;
              continue;
            }

            if (existente.arquivadoEm) {
              ignorar(numero, "Já existe um contato com este telefone na lixeira. Restaure-o para atualizar.");
              continue;
            }
            if (visiveis !== "todos" && (!existente.responsavelId || !visiveis.has(existente.responsavelId))) {
              ignorar(numero, "Este telefone já é de um contato na carteira de outra pessoa.");
              continue;
            }
            const novosCampos = { ...(existente.campos ?? {}), ...campos };
            const mudou =
              existente.nome !== nome ||
              (email !== null && existente.email !== email) ||
              (!existente.origem && Boolean(origemContato)) ||
              JSON.stringify(novosCampos) !== JSON.stringify(existente.campos ?? {});
            if (!opcoes.atualizarExistentes || !mudou) {
              await etiquetar(tx, empresaId, existente.id, opcoes.etiquetaIds);
              contagem.inalterados++;
              continue;
            }
            await tx.db
              .update(contato)
              .set({
                nome,
                email: email ?? existente.email,
                origem: existente.origem ?? origemContato,
                campos: novosCampos,
                atualizadoEm: new Date(),
              })
              .where(eq(contato.id, existente.id));
            await etiquetar(tx, empresaId, existente.id, opcoes.etiquetaIds);
            await registrar(tx, origemAtor, {
              acao: "contato.atualizado",
              entidade: "contato",
              entidadeId: existente.id,
              contatoId: existente.id,
              responsavelId: existente.responsavelId,
              silencioso: true,
              antes: { nome: existente.nome, email: existente.email, campos: existente.campos },
              depois: { nome, email: email ?? existente.email, campos: novosCampos },
              dados: { importacaoId },
            });
            contagem.atualizados++;
          }
        });
      }

      await comEmpresa(banco, empresaId, async (tx) => {
        const status = contagem.ignorados ? "CONCLUIDA_COM_ERROS" : "CONCLUIDA";
        await tx.db
          .update(importacao)
          .set({ status, ...contagem, erros, concluidaEm: new Date(), atualizadoEm: new Date() })
          .where(eq(importacao.id, importacaoId));
        await registrar(tx, origemAtor, {
          acao: "importacao.concluida",
          entidade: "importacao",
          entidadeId: importacaoId,
          responsavelId: opcoes.atorId,
          depois: contagem,
          dados: contagem,
        });
        await notificar(tx, origemAtor, {
          usuarioId: opcoes.atorId,
          titulo: `Importação concluída: ${contagem.novos} novos, ${contagem.atualizados} atualizados`,
          texto: contagem.ignorados ? `${contagem.ignorados} linha(s) ignorada(s). Veja o relatório.` : "Nenhuma linha ignorada.",
          link: `/importar?id=${importacaoId}`,
        });
      });
    } catch (err) {
      await comEmpresa(banco, empresaId, (tx) =>
        tx.db
          .update(importacao)
          .set({ status: "FALHOU", erros: [{ linha: 0, motivo: "Não foi possível terminar a importação. Ela será tentada de novo automaticamente." }], atualizadoEm: new Date() })
          .where(eq(importacao.id, importacaoId)),
      );
      throw err;
    }
  }

  async function obter(ctx: ContextoEmpresa, id: string): Promise<ImportacaoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => dto(await carregar(tx, ctx, id)));
  }

  async function listar(ctx: ContextoEmpresa, cursor: string | undefined, limite: number): Promise<Pagina<ImportacaoDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .select()
        .from(importacao)
        .where(
          and(
            eq(importacao.empresaId, ctx.empresaId),
            ctx.permissoes.crm?.administrar ? undefined : eq(importacao.criadoPor, ctx.usuarioId),
            condicaoCursor(importacao.criadoEm, importacao.id, lerCursor(cursor)),
          ),
        )
        .orderBy(desc(importacao.criadoEm), desc(importacao.id))
        .limit(limite + 1);
      return montarPagina(linhas, limite, dto);
    });
  }

  return { receber, confirmar, processar, obter, listar };
}

async function etiquetar(tx: Tx, empresaId: string, contatoId: string, etiquetaIds: string[]) {
  if (!etiquetaIds.length) return;
  await tx.db
    .insert(contatoEtiqueta)
    .values(etiquetaIds.map((etiquetaId) => ({ empresaId, contatoId, etiquetaId })))
    .onConflictDoNothing();
}

/** Coluna "empresa" da planilha: reaproveita o contato-empresa de mesmo nome ou cria um. */
async function organizacaoPorNome(tx: Tx, empresaId: string, nome: string, atorId: string, responsavelId: string): Promise<string | null> {
  if (!nome) return null;
  const [existente] = await tx.db
    .select({ id: contato.id })
    .from(contato)
    .where(and(eq(contato.empresaId, empresaId), eq(contato.tipo, "empresa"), sql`lower(${contato.nome}) = lower(${nome})`))
    .limit(1);
  if (existente) return existente.id;
  const [criada] = await tx.db
    .insert(contato)
    .values({ empresaId, tipo: "empresa", nome, responsavelId, criadoPor: atorId })
    .returning({ id: contato.id });
  return criada.id;
}
