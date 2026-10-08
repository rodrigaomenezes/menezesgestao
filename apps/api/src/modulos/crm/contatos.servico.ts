// Contatos: cadastro com telefone normalizado (chave de deduplicação), carteira com responsável,
// etiquetas, campos personalizados, arquivar/restaurar, ações em massa e histórico único.
import { and, eq } from "drizzle-orm";
import { normalizarTelefone, temPermissao, type ContatoDto, type Escopo, type HistoricoDto, type Pagina } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { contato } from "../../infra/esquema.js";
import { ErroApp, codigoPg, invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { iso, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { validarCampos } from "./campos.js";
import { validarResponsavel } from "./carteira.js";
import { definicoesDeCampos } from "./configuracao.servico.js";
import * as repo from "./contatos.repositorio.js";

export interface DadosContato {
  tipo?: "pessoa" | "empresa";
  nome?: string;
  telefone?: string | null;
  email?: string | null;
  organizacaoId?: string | null;
  responsavelId?: string | null;
  origem?: string | null;
  campos?: Record<string, unknown>;
  naoContatar?: boolean;
  consentimentoEm?: string | null;
}

const dto = (c: repo.LinhaContato, etiquetas: ContatoDto["etiquetas"]): ContatoDto => ({
  ...c,
  campos: c.campos ?? {},
  consentimentoEm: iso(c.consentimentoEm),
  criadoEm: iso(c.criadoEm),
  atualizadoEm: iso(c.atualizadoEm),
  arquivadoEm: iso(c.arquivadoEm),
  etiquetas,
});

/** Telefone digitado → E.164; vazio vira null; inválido é erro com orientação. */
export function telefoneOuErro(entrada: string | null | undefined): string | null {
  if (!entrada?.trim()) return null;
  const e164 = normalizarTelefone(entrada);
  if (!e164) throw invalido("Telefone inválido. Use DDD + número, por exemplo (11) 98765-4321, ou +código do país.", { campo: "telefone" });
  return e164;
}

export function criarServicoContatos(s: Servicos) {
  const { banco } = s;

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const c = await repo.buscarVisivel(tx, ctx.empresaId, ctx, escopo, id);
    if (!c) throw naoEncontrado("Contato");
    return c;
  }

  async function comEtiquetas(tx: Tx, c: repo.LinhaContato) {
    return dto(c, (await repo.etiquetasDe(tx, [c.id])).get(c.id) ?? []);
  }

  /** Telefone repetido: explica e, se a pessoa pode ver o contato existente, aponta para ele. */
  async function erroTelefoneRepetido(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, telefone: string): Promise<ErroApp> {
    const existente = await repo.buscarPorTelefone(tx, ctx.empresaId, telefone);
    const visivel = existente ? await repo.buscarVisivel(tx, ctx.empresaId, ctx, escopo, existente.id) : null;
    return new ErroApp(
      409,
      "CONFLITO",
      visivel
        ? `Já existe um contato com este telefone: ${visivel.nome}${visivel.arquivadoEm ? " (arquivado — restaure em vez de cadastrar de novo)" : ""}.`
        : "Já existe um contato com este telefone na empresa, na carteira de outra pessoa. Peça ao gestor para transferir.",
      visivel ? { contatoId: visivel.id } : undefined,
    );
  }

  async function validarOrganizacao(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, organizacaoId: string | null | undefined, proprioId?: string) {
    if (!organizacaoId) return;
    if (organizacaoId === proprioId) throw invalido("Um contato não pode ser a própria empresa.");
    const org = await repo.buscarVisivel(tx, ctx.empresaId, ctx, escopo, organizacaoId);
    if (!org || org.tipo !== "empresa") throw invalido("Escolha um contato do tipo empresa como organização.");
  }

  async function listar(ctx: ContextoEmpresa, escopo: Escopo, f: repo.FiltroContatos): Promise<Pagina<ContatoDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await repo.listar(tx, ctx.empresaId, ctx, escopo, f);
      const etiquetas = await repo.etiquetasDe(tx, linhas.slice(0, f.limite).map((l) => l.id));
      return montarPagina(linhas, f.limite, (l) => dto(l, etiquetas.get(l.id) ?? []));
    });
  }

  async function obter(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<ContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => comEtiquetas(tx, await carregar(tx, ctx, escopo, id)));
  }

  async function criar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, dados: DadosContato & { nome: string; etiquetaIds?: string[] }): Promise<ContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const telefone = telefoneOuErro(dados.telefone);
      const responsavelId = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      await validarOrganizacao(tx, ctx, escopo, dados.organizacaoId);
      const campos = validarCampos(await definicoesDeCampos(tx, ctx.empresaId, "contato"), dados.campos ?? {}, { exigirObrigatorios: true });
      const etiquetaIds = (await repo.etiquetasValidas(tx, ctx.empresaId, dados.etiquetaIds ?? [])).map((e) => e.id);
      let id: string;
      try {
        await tx.cliente.query("SAVEPOINT novo_contato");
        [{ id }] = await tx.db
          .insert(contato)
          .values({
            empresaId: ctx.empresaId,
            tipo: dados.tipo ?? "pessoa",
            nome: dados.nome,
            telefone,
            email: dados.email ?? null,
            organizacaoId: dados.organizacaoId ?? null,
            responsavelId,
            origem: dados.origem ?? null,
            campos,
            naoContatar: dados.naoContatar ?? false,
            consentimentoEm: dados.consentimentoEm ? new Date(dados.consentimentoEm) : null,
            criadoPor: ctx.usuarioId,
          })
          .returning({ id: contato.id });
      } catch (err) {
        if (codigoPg(err) === "23505" && telefone) {
          await tx.cliente.query("ROLLBACK TO SAVEPOINT novo_contato");
          throw await erroTelefoneRepetido(tx, ctx, escopo, telefone);
        }
        throw err;
      }
      await repo.trocarEtiquetas(tx, ctx.empresaId, id, etiquetaIds);
      const criado = await carregar(tx, ctx, "empresa", id);
      await registrar(tx, origem, {
        acao: "contato.criado",
        entidade: "contato",
        entidadeId: id,
        contatoId: id,
        responsavelId,
        depois: { nome: criado.nome, telefone, email: criado.email, origem: criado.origem },
      });
      return comEtiquetas(tx, criado);
    });
  }

  async function atualizar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, dados: DadosContato): Promise<ContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await carregar(tx, ctx, escopo, id);
      const mudancas: Partial<typeof contato.$inferInsert> = {};
      if (dados.nome !== undefined) mudancas.nome = dados.nome;
      if (dados.tipo !== undefined) mudancas.tipo = dados.tipo;
      if (dados.email !== undefined) mudancas.email = dados.email;
      if (dados.origem !== undefined) mudancas.origem = dados.origem;
      if (dados.naoContatar !== undefined) mudancas.naoContatar = dados.naoContatar;
      if (dados.consentimentoEm !== undefined) mudancas.consentimentoEm = dados.consentimentoEm ? new Date(dados.consentimentoEm) : null;
      if (dados.telefone !== undefined) mudancas.telefone = telefoneOuErro(dados.telefone);
      if (dados.organizacaoId !== undefined) {
        await validarOrganizacao(tx, ctx, escopo, dados.organizacaoId, id);
        mudancas.organizacaoId = dados.organizacaoId;
      }
      if (dados.responsavelId !== undefined && dados.responsavelId !== antes.responsavelId) {
        mudancas.responsavelId = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      }
      if (dados.campos !== undefined) {
        mudancas.campos = validarCampos(await definicoesDeCampos(tx, ctx.empresaId, "contato"), dados.campos, {
          exigirObrigatorios: true,
          atuais: antes.campos,
        });
      }
      try {
        await tx.cliente.query("SAVEPOINT altera_contato");
        await tx.db
          .update(contato)
          .set({ ...mudancas, atualizadoEm: new Date() })
          .where(and(eq(contato.id, id), eq(contato.empresaId, ctx.empresaId)));
      } catch (err) {
        if (codigoPg(err) === "23505" && mudancas.telefone) {
          await tx.cliente.query("ROLLBACK TO SAVEPOINT altera_contato");
          throw await erroTelefoneRepetido(tx, ctx, escopo, mudancas.telefone);
        }
        throw err;
      }
      const depois = await carregar(tx, ctx, "empresa", id);
      await registrar(tx, origem, {
        acao: "contato.atualizado",
        entidade: "contato",
        entidadeId: id,
        contatoId: id,
        responsavelId: depois.responsavelId,
        antes: { ...antes, responsavelNome: undefined, organizacaoNome: undefined },
        depois: { ...depois, responsavelNome: undefined, organizacaoNome: undefined },
      });
      if (mudancas.responsavelId !== undefined) {
        // Transferência de carteira: ação explícita, com evento próprio (alimenta histórico e metas).
        await registrar(tx, origem, {
          acao: "contato.responsavel_alterado",
          entidade: "contato",
          entidadeId: id,
          contatoId: id,
          responsavelId: depois.responsavelId,
          antes: { responsavelId: antes.responsavelId, responsavelNome: antes.responsavelNome },
          depois: { responsavelId: depois.responsavelId, responsavelNome: depois.responsavelNome },
          dados: { de: antes.responsavelNome, para: depois.responsavelNome },
        });
      }
      return comEtiquetas(tx, depois);
    });
  }

  async function definirEtiquetas(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, etiquetaIds: string[]): Promise<ContatoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await carregar(tx, ctx, escopo, id);
      const antes = (await repo.etiquetasDe(tx, [id])).get(id) ?? [];
      const validas = (await repo.etiquetasValidas(tx, ctx.empresaId, etiquetaIds)).map((e) => e.id);
      await repo.trocarEtiquetas(tx, ctx.empresaId, id, validas);
      const depois = (await repo.etiquetasDe(tx, [id])).get(id) ?? [];
      await registrar(tx, origem, {
        acao: "contato.etiquetas_alteradas",
        entidade: "contato",
        entidadeId: id,
        contatoId: id,
        responsavelId: c.responsavelId,
        antes: antes.map((e) => e.nome),
        depois: depois.map((e) => e.nome),
        dados: { etiquetas: depois.map((e) => e.nome) },
      });
      return dto(c, depois);
    });
  }

  async function alternarArquivo(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, arquivar: boolean): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await carregar(tx, ctx, escopo, id);
      // Arquivar não mexe em oportunidades, tarefas, notas nem histórico: restaurar devolve tudo como estava.
      await tx.db
        .update(contato)
        .set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() })
        .where(and(eq(contato.id, id), eq(contato.empresaId, ctx.empresaId)));
      await registrar(tx, origem, {
        acao: arquivar ? "contato.arquivado" : "contato.restaurado",
        entidade: "contato",
        entidadeId: id,
        contatoId: id,
        responsavelId: c.responsavelId,
      });
    });
  }

  async function acaoEmMassa(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    dados: { ids: string[]; acao: "transferir" | "arquivar" | "restaurar" | "etiquetar" | "desetiquetar"; responsavelId?: string | null; etiquetaId?: string | null },
  ): Promise<{ afetados: number; ignorados: number }> {
    // Arquivar e restaurar em massa exigem a permissão de arquivar (e valem no escopo dela).
    if (dados.acao === "arquivar" || dados.acao === "restaurar") {
      const escopoArquivar = temPermissao(ctx.permissoes, "crm", "arquivar");
      if (!escopoArquivar) throw semPermissao();
      escopo = escopoArquivar;
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const alvos = await repo.idsVisiveis(tx, ctx.empresaId, ctx, escopo, [...new Set(dados.ids)]);
      let novoResponsavel: string | null = null;
      if (dados.acao === "transferir") novoResponsavel = await validarResponsavel(tx, ctx, escopo, dados.responsavelId);
      if ((dados.acao === "etiquetar" || dados.acao === "desetiquetar") && !dados.etiquetaId) throw invalido("Escolha a etiqueta.");
      if (dados.etiquetaId && !(await repo.etiquetasValidas(tx, ctx.empresaId, [dados.etiquetaId])).length) throw invalido("Etiqueta não encontrada.");

      let afetados = 0;
      for (const alvo of alvos) {
        const etiquetasAntes = (await repo.etiquetasDe(tx, [alvo.id])).get(alvo.id)?.map((e) => e.id) ?? [];
        switch (dados.acao) {
          case "transferir":
            if (alvo.responsavelId === novoResponsavel) continue;
            await tx.db.update(contato).set({ responsavelId: novoResponsavel, atualizadoEm: new Date() }).where(eq(contato.id, alvo.id));
            await registrar(tx, origem, {
              acao: "contato.responsavel_alterado",
              entidade: "contato",
              entidadeId: alvo.id,
              contatoId: alvo.id,
              responsavelId: novoResponsavel,
              antes: { responsavelId: alvo.responsavelId },
              depois: { responsavelId: novoResponsavel },
              dados: { emMassa: true },
            });
            break;
          case "arquivar":
          case "restaurar": {
            const arquivar = dados.acao === "arquivar";
            if (Boolean(alvo.arquivadoEm) === arquivar) continue;
            await tx.db.update(contato).set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() }).where(eq(contato.id, alvo.id));
            await registrar(tx, origem, {
              acao: arquivar ? "contato.arquivado" : "contato.restaurado",
              entidade: "contato",
              entidadeId: alvo.id,
              contatoId: alvo.id,
              responsavelId: alvo.responsavelId,
              dados: { emMassa: true },
            });
            break;
          }
          case "etiquetar":
          case "desetiquetar": {
            const tem = etiquetasAntes.includes(dados.etiquetaId!);
            if ((dados.acao === "etiquetar") === tem) continue;
            const novas = dados.acao === "etiquetar" ? [...etiquetasAntes, dados.etiquetaId!] : etiquetasAntes.filter((e) => e !== dados.etiquetaId);
            await repo.trocarEtiquetas(tx, ctx.empresaId, alvo.id, novas);
            await registrar(tx, origem, {
              acao: "contato.etiquetas_alteradas",
              entidade: "contato",
              entidadeId: alvo.id,
              contatoId: alvo.id,
              responsavelId: alvo.responsavelId,
              antes: etiquetasAntes,
              depois: novas,
              dados: { emMassa: true },
            });
            break;
          }
        }
        afetados++;
      }
      return { afetados, ignorados: dados.ids.length - afetados };
    });
  }

  async function historico(ctx: ContextoEmpresa, escopo: Escopo, id: string, cursor: string | undefined, limite: number): Promise<Pagina<HistoricoDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await carregar(tx, ctx, escopo, id);
      const linhas = await repo.historico(tx, ctx.empresaId, id, cursor, limite);
      return montarPagina(linhas, limite, (l) => ({ ...l, dados: (l.dados ?? {}) as Record<string, unknown>, criadoEm: iso(l.criadoEm) }));
    });
  }

  return { listar, obter, criar, atualizar, definirEtiquetas, alternarArquivo, acaoEmMassa, historico };
}
