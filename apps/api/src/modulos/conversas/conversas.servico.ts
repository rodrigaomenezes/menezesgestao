// Caixa de entrada: lista por pessoa/equipe, conversa, mensagens, envio (texto, nota, mídia, áudio), atribuição,
// status. Visibilidade: conversa sem dono é da fila de todos que têm o módulo; com dono, segue o escopo do perfil.
import { aliasedTable, and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { formatarTelefone, variantesTelefone, type ConversaDetalheDto, type ConversaDto, type Escopo, type MensagemDto, type Pagina } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { canal, contato, conversa, mensagem, usuario, type StatusConversa, type TipoMensagem } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { validarResponsavel } from "../crm/carteira.js";
import * as contatos from "../crm/contatos.repositorio.js";
import { prepararAudio } from "./audio.js";
import { FILAS_CONVERSAS, variaveisDaConversa, type ServicoEnvio } from "./envio.servico.js";

export const LIMITE_MIDIA_ENVIO = 16 * 1024 * 1024;

const atribuida = aliasedTable(usuario, "atribuida");
const autor = aliasedTable(usuario, "autor");

const visivel = (ctx: ContextoEmpresa, escopo: Escopo): SQL =>
  escopo === "empresa" ? sql`true` : sql`(${conversa.atribuidaA} IS NULL OR ${filtroUsuariosVisiveis(ctx, escopo, conversa.atribuidaA)})`;

function consultaConversas(tx: Tx) {
  return tx.db
    .select({
      c: conversa,
      canalNome: canal.nome,
      provedor: canal.provedor,
      contatoNome: contato.nome,
      atribuidaNome: atribuida.nome,
    })
    .from(conversa)
    .innerJoin(canal, eq(canal.id, conversa.canalId))
    .leftJoin(contato, eq(contato.id, conversa.contatoId))
    .leftJoin(atribuida, eq(atribuida.id, conversa.atribuidaA));
}
type LinhaConsulta = Awaited<ReturnType<ReturnType<typeof consultaConversas>["execute"]>>[number];

const conversaDto = (l: LinhaConsulta): ConversaDto => ({
  id: l.c.id,
  canalId: l.c.canalId,
  canalNome: l.canalNome,
  contatoId: l.c.contatoId,
  contatoNome: l.contatoNome ?? (l.c.telefone ? formatarTelefone(l.c.telefone) : null),
  telefone: l.c.telefone,
  atribuidaA: l.c.atribuidaA,
  atribuidaNome: l.atribuidaNome,
  status: l.c.status,
  naoLidas: l.c.naoLidas,
  ultimaMensagem: l.c.ultimaMensagem,
  ultimaMensagemEm: iso(l.c.ultimaMensagemEm),
  ultimaEntradaEm: iso(l.c.ultimaEntradaEm),
});

function tipoPorMime(mime: string): TipoMensagem {
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "documento";
}

export function criarServicoConversas(s: Servicos, arquivos: ProvedorArquivos, envio: ServicoEnvio) {
  const { banco, jobs } = s;

  async function carregar(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<LinhaConsulta> {
    const [l] = await consultaConversas(tx).where(and(eq(conversa.id, id), eq(conversa.empresaId, ctx.empresaId), isNull(conversa.mescladaEmId), visivel(ctx, escopo)));
    if (!l) throw naoEncontrado("Conversa");
    return l;
  }

  async function listar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    f: { caixa: "minhas" | "nao_atribuidas" | "todas"; status: "abertas" | StatusConversa; canalId?: string; busca?: string; cursor?: string; limite: number },
  ): Promise<Pagina<ConversaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const cursor = lerCursor(f.cursor);
      const condicoes: (SQL | undefined)[] = [
        eq(conversa.empresaId, ctx.empresaId),
        isNull(conversa.mescladaEmId),
        visivel(ctx, escopo),
        f.caixa === "minhas" ? eq(conversa.atribuidaA, ctx.usuarioId) : f.caixa === "nao_atribuidas" ? isNull(conversa.atribuidaA) : undefined,
        f.status === "abertas" ? inArray(conversa.status, ["aberta", "aguardando"]) : eq(conversa.status, f.status),
        f.canalId ? eq(conversa.canalId, f.canalId) : undefined,
        f.busca ? or(ilike(contato.nome, `%${f.busca}%`), ilike(conversa.telefone, `%${f.busca.replace(/\D/g, "") || f.busca}%`)) : undefined,
        cursor ? sql`(coalesce(${conversa.ultimaMensagemEm}, ${conversa.criadoEm}), ${conversa.id}) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : undefined,
      ];
      const linhas = await consultaConversas(tx)
        .where(and(...condicoes))
        .orderBy(desc(sql`coalesce(${conversa.ultimaMensagemEm}, ${conversa.criadoEm})`), desc(conversa.id))
        .limit(f.limite + 1);
      return montarPagina(
        linhas.map((l) => ({ ...l, id: l.c.id, criadoEm: l.c.ultimaMensagemEm ?? l.c.criadoEm })),
        f.limite,
        conversaDto,
      );
    });
  }

  async function obter(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<ConversaDetalheDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const l = await carregar(tx, ctx, escopo, id);
      return { ...conversaDto(l), provedor: l.provedor, variaveis: await variaveisDaConversa(tx, l.c, ctx.usuarioId) };
    });
  }

  async function mensagens(ctx: ContextoEmpresa, escopo: Escopo, id: string, cursorTexto: string | undefined, limite: number): Promise<Pagina<MensagemDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await carregar(tx, ctx, escopo, id);
      const cursor = lerCursor(cursorTexto);
      const linhas = await tx.db
        .select({ m: mensagem, autorNome: autor.nome })
        .from(mensagem)
        .leftJoin(autor, eq(autor.id, mensagem.autorId))
        .where(
          and(
            eq(mensagem.conversaId, id),
            cursor ? sql`(${mensagem.criadoEm}, ${mensagem.id}) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(mensagem.criadoEm), desc(mensagem.id))
        .limit(limite + 1);
      return montarPagina(
        linhas.map((l) => ({ ...l, id: l.m.id, criadoEm: l.m.criadoEm })),
        limite,
        (l): MensagemDto => ({
          id: l.m.id,
          conversaId: l.m.conversaId,
          direcao: l.m.direcao,
          tipo: l.m.tipo,
          texto: l.m.texto,
          temMidia: Boolean(l.m.arquivoId),
          midiaNome: l.m.midiaNome,
          midiaMime: l.m.midiaMime,
          status: l.m.status,
          erro: l.m.erro,
          autorNome: l.autorNome,
          automacao: l.m.automacao,
          criadoEm: iso(l.m.criadoEm) ?? "",
        }),
      );
    });
  }

  /** Quem responde uma conversa sem dono passa a ser o dono dela. */
  async function prepararResposta(tx: Tx, ctx: ContextoEmpresa, origem: Origem, l: LinhaConsulta, nota: boolean) {
    const [cn] = await tx.db.select({ arquivadoEm: canal.arquivadoEm }).from(canal).where(eq(canal.id, l.c.canalId));
    if (!nota && cn?.arquivadoEm) throw invalido("O canal desta conversa foi arquivado. Não é possível enviar.");
    let c = l.c;
    if (!nota && !c.atribuidaA) {
      [c] = await tx.db.update(conversa).set({ atribuidaA: ctx.usuarioId, naoLidas: 0, atualizadoEm: new Date() }).where(eq(conversa.id, c.id)).returning();
      await registrar(tx, origem, { acao: "conversa.atribuida", entidade: "conversa", entidadeId: c.id, contatoId: c.contatoId, responsavelId: ctx.usuarioId, depois: { atribuidaA: ctx.usuarioId } });
    } else if (!nota && c.naoLidas) {
      await tx.db.update(conversa).set({ naoLidas: 0 }).where(eq(conversa.id, c.id));
    }
    return c;
  }

  async function enviarTexto(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, dados: { texto: string; nota: boolean }): Promise<{ id: string }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const l = await carregar(tx, ctx, escopo, id);
      const c = await prepararResposta(tx, ctx, origem, l, dados.nota);
      const m = await envio.criarSaida(tx, origem, c, { tipo: "texto", texto: dados.texto, autorId: ctx.usuarioId }, dados.nota);
      return { id: m.id };
    });
  }

  async function enviarMidia(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    a: { nome: string; mime: string; conteudo: Buffer; legenda: string | null },
  ): Promise<{ id: string }> {
    if (!a.conteudo.length) throw invalido("O arquivo está vazio.");
    if (a.conteudo.length > LIMITE_MIDIA_ENVIO) throw invalido("O arquivo passou de 16 MB, o limite do WhatsApp para mídia.");
    let { nome, mime, conteudo } = a;
    const tipo = tipoPorMime(mime);
    let voz = false;
    if (tipo === "audio") {
      try {
        const p = prepararAudio(conteudo, mime);
        ({ conteudo, mime, voz } = p);
        nome = nome.replace(/\.[^.]+$/, "") + `.${p.extensao}`;
      } catch (e) {
        throw invalido(`Não foi possível preparar o áudio (${(e as Error).message}). Grave de novo ou envie um arquivo .ogg, .mp3 ou .m4a.`);
      }
    }
    // Confere a conversa antes de gravar o arquivo.
    await comEmpresa(banco, ctx.empresaId, (tx) => carregar(tx, ctx, escopo, id));
    const { id: arquivoId } = await arquivos.gravar(ctx.empresaId, { nome, tipoMime: mime, conteudo, criadoPor: ctx.usuarioId });
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const l = await carregar(tx, ctx, escopo, id);
      const c = await prepararResposta(tx, ctx, origem, l, false);
      const m = await envio.criarSaida(tx, origem, c, { tipo, texto: a.legenda, arquivoId, midiaNome: nome, midiaMime: mime, autorId: ctx.usuarioId, voz });
      return { id: m.id };
    });
  }

  async function marcarLida(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      await carregar(tx, ctx, escopo, id);
      await tx.db.update(conversa).set({ naoLidas: 0 }).where(eq(conversa.id, id));
    });
  }

  async function atribuir(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, usuarioId: string | null): Promise<ConversaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const l = await carregar(tx, ctx, escopo, id);
      // Devolver para a fila (sem dono) ou passar para alguém do próprio escopo.
      const alvo = usuarioId === null ? null : await validarResponsavel(tx, ctx, escopo, usuarioId);
      await tx.db.update(conversa).set({ atribuidaA: alvo, atualizadoEm: new Date() }).where(eq(conversa.id, id));
      await registrar(tx, origem, {
        acao: "conversa.atribuida",
        entidade: "conversa",
        entidadeId: id,
        contatoId: l.c.contatoId,
        responsavelId: alvo ?? l.c.atribuidaA,
        antes: { atribuidaA: l.c.atribuidaA },
        depois: { atribuidaA: alvo },
      });
      return conversaDto(await carregarSemEscopo(tx, ctx, id));
    });
  }

  async function carregarSemEscopo(tx: Tx, ctx: ContextoEmpresa, id: string) {
    const [l] = await consultaConversas(tx).where(and(eq(conversa.id, id), eq(conversa.empresaId, ctx.empresaId)));
    if (!l) throw naoEncontrado("Conversa");
    return l;
  }

  async function alterarStatus(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, status: StatusConversa): Promise<ConversaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const l = await carregar(tx, ctx, escopo, id);
      await tx.db.update(conversa).set({ status, ...(status === "resolvida" ? { naoLidas: 0 } : {}), atualizadoEm: new Date() }).where(eq(conversa.id, id));
      await registrar(tx, origem, { acao: `conversa.${status}`, entidade: "conversa", entidadeId: id, contatoId: l.c.contatoId, responsavelId: l.c.atribuidaA, antes: { status: l.c.status }, depois: { status } });
      return conversaDto(await carregar(tx, ctx, escopo, id));
    });
  }

  /** Começa (ou reabre) a conversa com um contato num canal: quem iniciou fica como dono. */
  async function iniciar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, dados: { canalId: string; contatoId: string }): Promise<ConversaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [cn] = await tx.db.select().from(canal).where(and(eq(canal.id, dados.canalId), eq(canal.empresaId, ctx.empresaId), isNull(canal.arquivadoEm)));
      if (!cn) throw naoEncontrado("Canal");
      const ct = await contatos.buscarVisivel(tx, ctx.empresaId, ctx, escopo, dados.contatoId);
      if (!ct || ct.arquivadoEm) throw naoEncontrado("Contato");
      if (!ct.telefone) throw invalido("Este contato não tem telefone. Cadastre o número para conversar pelo WhatsApp.");
      const [existente] = await tx.db
        .select({ id: conversa.id })
        .from(conversa)
        .where(and(eq(conversa.canalId, cn.id), isNull(conversa.mescladaEmId), or(inArray(conversa.telefone, variantesTelefone(ct.telefone)), eq(conversa.contatoId, ct.id))))
        .limit(1);
      if (existente) return conversaDto(await carregarSemEscopo(tx, ctx, existente.id));
      const [c] = await tx.db
        .insert(conversa)
        .values({ empresaId: ctx.empresaId, canalId: cn.id, contatoId: ct.id, telefone: ct.telefone, atribuidaA: ctx.usuarioId, equipeId: cn.equipeId, ultimaMensagemEm: new Date() })
        .returning();
      await registrar(tx, origem, { acao: "conversa.iniciada", entidade: "conversa", entidadeId: c.id, contatoId: ct.id, responsavelId: ctx.usuarioId, depois: { canal: cn.nome } });
      return conversaDto(await carregarSemEscopo(tx, ctx, c.id));
    });
  }

  /** Arquivo de uma mensagem (imagem, áudio, documento) para a tela, com a mesma checagem de acesso. */
  async function midia(ctx: ContextoEmpresa, escopo: Escopo, mensagemId: string) {
    const m = await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [m] = await tx.db.select().from(mensagem).where(and(eq(mensagem.id, mensagemId), eq(mensagem.empresaId, ctx.empresaId)));
      if (!m?.arquivoId) throw naoEncontrado("Arquivo");
      await carregar(tx, ctx, escopo, m.conversaId);
      return m;
    });
    const arq = await arquivos.ler(ctx.empresaId, m.arquivoId as string);
    return { nome: m.midiaNome ?? arq.nome, mime: m.midiaMime ?? arq.tipoMime, conteudo: arq.conteudo };
  }

  async function reenviar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, mensagemId: string): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [m] = await tx.db.select().from(mensagem).where(and(eq(mensagem.id, mensagemId), eq(mensagem.empresaId, ctx.empresaId)));
      if (!m) throw naoEncontrado("Mensagem");
      await carregar(tx, ctx, escopo, m.conversaId);
      if (m.direcao !== "saida" || m.status !== "falhou") throw invalido("Só mensagens que falharam podem ser reenviadas.");
      await tx.db.update(mensagem).set({ status: "pendente", erro: null, atualizadoEm: new Date() }).where(eq(mensagem.id, m.id));
      await jobs.enfileirar(tx, FILAS_CONVERSAS.envio, { empresaId: ctx.empresaId, mensagemId: m.id, voz: m.tipo === "audio" && /ogg/.test(m.midiaMime ?? "") });
      await registrar(tx, origem, { acao: "mensagem.reenviada", entidade: "conversa", entidadeId: m.conversaId, dados: { mensagemId: m.id } });
    });
  }

  return { listar, obter, mensagens, enviarTexto, enviarMidia, marcarLida, atribuir, alterarStatus, iniciar, midia, reenviar };
}
