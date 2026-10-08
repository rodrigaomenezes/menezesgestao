// Telefonia: configuração (SIP, gravação), ramais, ligações e seus estados, resultado e gravação cifrada.
// As ligações acontecem no navegador (treino, celular ou SIP/WebRTC); o servidor registra cada mudança de estado,
// confere as transições e grava o histórico do contato sem ninguém digitar.
import { createHmac } from "node:crypto";
import { aliasedTable, and, asc, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import {
  normalizarTelefone,
  transicaoValida,
  type Escopo,
  type EstadoLigacaoId,
  type LigacaoDto,
  type MeuTelefoneDto,
  type Pagina,
  type ProvedorTelefoneId,
  type RamalDto,
  type ResultadoLigacaoDto,
  type TelefoniaConfigDto,
} from "@mg/shared";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { arquivo, contato, filaItem, ligacao, ligacaoEvento, ramal, resultadoLigacao, telefoniaConfig, usuario, vinculo } from "../../infra/esquema.js";
import { ErroApp, invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import { cifrar, cifrarBytes, decifrar, decifrarBytes, iguaisSeguro } from "../../infra/seguranca/cripto.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { filtroUsuariosVisiveis, usuariosVisiveis } from "../acesso/escopo.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { publicar } from "../eventos/publicar.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";

export const LIMITE_GRAVACAO = 30 * 1024 * 1024;
const VALIDADE_LINK_MS = 5 * 60_000;
const AVISO_PADRAO = "Esta ligação pode ser gravada para garantir a qualidade do atendimento.";

type LinhaLigacao = typeof ligacao.$inferSelect;
const quem = aliasedTable(usuario, "quem");

export function criarServicoTelefonia(s: Servicos, arquivos: ProvedorArquivos) {
  const { banco, config } = s;

  async function lerConfig(tx: Tx, empresaId: string): Promise<TelefoniaConfigDto> {
    const [c] = await tx.db.select().from(telefoniaConfig).where(eq(telefoniaConfig.empresaId, empresaId));
    return {
      sipServidor: c?.sipServidor ?? null,
      sipDominio: c?.sipDominio ?? null,
      gravacaoAtiva: c?.gravacaoAtiva ?? false,
      avisoGravacao: c?.avisoGravacao ?? AVISO_PADRAO,
      retencaoDias: c?.retencaoDias ?? 90,
    };
  }

  async function obterConfig(ctx: ContextoEmpresa): Promise<TelefoniaConfigDto> {
    return comEmpresa(banco, ctx.empresaId, (tx) => lerConfig(tx, ctx.empresaId));
  }

  async function salvarConfig(ctx: ContextoEmpresa, origem: Origem, d: TelefoniaConfigDto): Promise<TelefoniaConfigDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await lerConfig(tx, ctx.empresaId);
      const valores = {
        sipServidor: d.sipServidor || null,
        sipDominio: d.sipDominio || null,
        gravacaoAtiva: d.gravacaoAtiva,
        avisoGravacao: d.avisoGravacao,
        retencaoDias: d.retencaoDias,
        atualizadoEm: new Date(),
      };
      await tx.db.insert(telefoniaConfig).values({ empresaId: ctx.empresaId, ...valores }).onConflictDoUpdate({ target: telefoniaConfig.empresaId, set: valores });
      await registrar(tx, origem, { acao: "telefonia.configurada", entidade: "telefonia", entidadeId: ctx.empresaId, antes, depois: d });
      return lerConfig(tx, ctx.empresaId);
    });
  }

  async function ramais(ctx: ContextoEmpresa): Promise<RamalDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) =>
      (
        await tx.db
          .select({ usuarioId: ramal.usuarioId, usuarioNome: usuario.nome, login: ramal.login, ativo: ramal.ativo })
          .from(ramal)
          .innerJoin(usuario, eq(usuario.id, ramal.usuarioId))
          .where(eq(ramal.empresaId, ctx.empresaId))
          .orderBy(asc(usuario.nome))
          .limit(500)
      ).map((r) => r),
    );
  }

  async function salvarRamal(ctx: ContextoEmpresa, origem: Origem, usuarioId: string, d: { login: string; senha?: string | null; ativo: boolean }): Promise<RamalDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [v] = await tx.db
        .select({ nome: usuario.nome })
        .from(vinculo)
        .innerJoin(usuario, eq(usuario.id, vinculo.usuarioId))
        .where(and(eq(vinculo.empresaId, ctx.empresaId), eq(vinculo.usuarioId, usuarioId), isNull(vinculo.arquivadoEm)));
      if (!v) throw invalido("Pessoa não encontrada nesta empresa.");
      const [atual] = await tx.db.select().from(ramal).where(and(eq(ramal.empresaId, ctx.empresaId), eq(ramal.usuarioId, usuarioId)));
      if (!atual && !d.senha) throw invalido("Informe a senha do ramal.");
      const senha = d.senha ? cifrar(config.crmChave, d.senha) : (atual?.senha ?? "");
      await tx.db
        .insert(ramal)
        .values({ empresaId: ctx.empresaId, usuarioId, login: d.login, senha, ativo: d.ativo })
        .onConflictDoUpdate({ target: [ramal.empresaId, ramal.usuarioId], set: { login: d.login, senha, ativo: d.ativo, atualizadoEm: new Date() } });
      // A senha nunca vai para a auditoria: só se foi trocada.
      await registrar(tx, origem, { acao: "telefonia.ramal_salvo", entidade: "usuario", entidadeId: usuarioId, depois: { login: d.login, ativo: d.ativo, senhaTrocada: Boolean(d.senha) } });
      return { usuarioId, usuarioNome: v.nome, login: d.login, ativo: d.ativo };
    });
  }

  /** O que o navegador da própria pessoa precisa para ligar (inclusive a senha do ramal, que só ela recebe). */
  async function meuTelefone(ctx: ContextoEmpresa): Promise<MeuTelefoneDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await lerConfig(tx, ctx.empresaId);
      const [r] = await tx.db.select().from(ramal).where(and(eq(ramal.empresaId, ctx.empresaId), eq(ramal.usuarioId, ctx.usuarioId), eq(ramal.ativo, true)));
      const sip = c.sipServidor && c.sipDominio && r ? { servidor: c.sipServidor, dominio: c.sipDominio, login: r.login, senha: decifrar(config.crmChave, r.senha) } : null;
      const provedores: ProvedorTelefoneId[] = sip ? ["sip", "celular", "treino"] : ["celular", "treino"];
      return { provedores, sip, gravacaoAtiva: c.gravacaoAtiva, avisoGravacao: c.avisoGravacao };
    });
  }

  // Resultados ---------------------------------------------------------------------------------------
  const resultadoDto = (r: typeof resultadoLigacao.$inferSelect): ResultadoLigacaoDto => ({
    id: r.id,
    nome: r.nome,
    acao: r.acao,
    horas: r.horas,
    atendida: r.atendida,
    ordem: r.ordem,
    arquivadoEm: iso(r.arquivadoEm),
  });

  async function resultados(ctx: ContextoEmpresa): Promise<ResultadoLigacaoDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) =>
      (await tx.db.select().from(resultadoLigacao).where(eq(resultadoLigacao.empresaId, ctx.empresaId)).orderBy(asc(resultadoLigacao.ordem), asc(resultadoLigacao.nome)).limit(200)).map(
        resultadoDto,
      ),
    );
  }

  async function salvarResultado(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string | null,
    d: { nome?: string; acao?: (typeof resultadoLigacao.$inferSelect)["acao"]; horas?: number | null; atendida?: boolean; ordem?: number; arquivado?: boolean },
  ): Promise<ResultadoLigacaoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const { arquivado, ...resto } = d;
      let r;
      if (id) {
        [r] = await tx.db
          .update(resultadoLigacao)
          .set({ ...resto, ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }), atualizadoEm: new Date() })
          .where(and(eq(resultadoLigacao.id, id), eq(resultadoLigacao.empresaId, ctx.empresaId)))
          .returning();
        if (!r) throw naoEncontrado("Resultado");
      } else {
        if (!d.nome || !d.acao) throw invalido("Informe o nome e a ação do resultado.");
        [r] = await tx.db
          .insert(resultadoLigacao)
          .values({ empresaId: ctx.empresaId, nome: d.nome, acao: d.acao, horas: d.horas ?? null, atendida: d.atendida ?? false, ordem: d.ordem ?? 0 })
          .returning();
      }
      if (r.acao !== "reagendar" && r.horas !== null) [r] = await tx.db.update(resultadoLigacao).set({ horas: null }).where(eq(resultadoLigacao.id, r.id)).returning();
      await registrar(tx, origem, { acao: id ? "resultado_ligacao.atualizado" : "resultado_ligacao.criado", entidade: "resultado_ligacao", entidadeId: r.id, depois: d });
      return resultadoDto(r);
    });
  }

  // Ligações -----------------------------------------------------------------------------------------
  function consulta(tx: Tx) {
    return tx.db
      .select({ l: ligacao, contatoNome: contato.nome, usuarioNome: quem.nome, resultadoNome: resultadoLigacao.nome })
      .from(ligacao)
      .leftJoin(contato, eq(contato.id, ligacao.contatoId))
      .leftJoin(quem, eq(quem.id, ligacao.usuarioId))
      .leftJoin(resultadoLigacao, eq(resultadoLigacao.id, ligacao.resultadoId));
  }
  type LinhaConsulta = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];

  const dto = (x: LinhaConsulta): LigacaoDto => ({
    id: x.l.id,
    contatoId: x.l.contatoId,
    contatoNome: x.contatoNome,
    oportunidadeId: x.l.oportunidadeId,
    filaItemId: x.l.filaItemId,
    usuarioId: x.l.usuarioId,
    usuarioNome: x.usuarioNome,
    provedor: x.l.provedor,
    direcao: x.l.direcao,
    numero: x.l.numero,
    estado: x.l.estado,
    iniciadaEm: iso(x.l.iniciadaEm) ?? "",
    atendidaEm: iso(x.l.atendidaEm),
    encerradaEm: iso(x.l.encerradaEm),
    duracaoSegundos: x.l.duracaoSegundos,
    motivoFim: x.l.motivoFim,
    resultadoId: x.l.resultadoId,
    resultadoNome: x.resultadoNome,
    observacao: x.l.observacao,
    temGravacao: Boolean(x.l.gravacaoArquivoId),
  });

  async function carregarDto(tx: Tx, id: string): Promise<LigacaoDto> {
    const [x] = await consulta(tx).where(eq(ligacao.id, id));
    if (!x) throw naoEncontrado("Ligação");
    return dto(x);
  }

  /** Só quem fez a ligação muda o estado dela. */
  async function carregarMinha(tx: Tx, ctx: ContextoEmpresa, id: string): Promise<LinhaLigacao> {
    const [l] = await tx.db.select().from(ligacao).where(and(eq(ligacao.id, id), eq(ligacao.empresaId, ctx.empresaId))).for("update");
    if (!l || l.usuarioId !== ctx.usuarioId) throw naoEncontrado("Ligação");
    return l;
  }

  async function criar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    d: { provedor: ProvedorTelefoneId; numero?: string | null; contatoId?: string | null; oportunidadeId?: string | null; filaItemId?: string | null },
  ): Promise<LigacaoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      let contatoId = d.contatoId ?? null;
      if (d.filaItemId) {
        const [i] = await tx.db.select().from(filaItem).where(and(eq(filaItem.id, d.filaItemId), eq(filaItem.empresaId, ctx.empresaId)));
        if (!i) throw naoEncontrado("Item da fila");
        if (i.status !== "reservado" || i.reservadoPor !== ctx.usuarioId) throw new ErroApp(409, "CONFLITO", "Este contato da fila não está reservado para você. Pegue o próximo.");
        contatoId = i.contatoId;
      }
      let numero = d.numero ? normalizarTelefone(d.numero) : null;
      if (d.numero && !numero) throw invalido("Número inválido. Use DDD + número, ex.: (11) 98888-7777.");
      if (contatoId) {
        const condicao =
          escopo === "empresa" || d.filaItemId ? sql`true` : sql`(${contato.responsavelId} IS NULL OR ${filtroUsuariosVisiveis(ctx, escopo, contato.responsavelId)})`;
        const [c] = await tx.db.select().from(contato).where(and(eq(contato.id, contatoId), eq(contato.empresaId, ctx.empresaId), condicao));
        if (!c) throw naoEncontrado("Contato");
        if (c.naoContatar) throw invalido("Este contato pediu para não ser contatado (LGPD). A ligação não foi feita.");
        numero = numero ?? c.telefone;
      }
      if (!numero) throw invalido("Este contato não tem telefone. Cadastre o número para ligar.");
      if (d.provedor === "sip") {
        const meu = await tx.db.select({ id: ramal.id }).from(ramal).where(and(eq(ramal.empresaId, ctx.empresaId), eq(ramal.usuarioId, ctx.usuarioId), eq(ramal.ativo, true)));
        if (!meu.length) throw invalido("Você não tem ramal SIP ativo. Peça ao administrador ou use o celular.");
      }
      const [l] = await tx.db
        .insert(ligacao)
        .values({ empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, contatoId, oportunidadeId: d.oportunidadeId ?? null, filaItemId: d.filaItemId ?? null, provedor: d.provedor, numero })
        .returning();
      await tx.db.insert(ligacaoEvento).values({ empresaId: ctx.empresaId, ligacaoId: l.id, estado: "criada" });
      await publicar(tx, origem, { tipo: "ligacao.criada", entidade: "ligacao", entidadeId: l.id, contatoId, responsavelId: ctx.usuarioId, silencioso: false });
      return carregarDto(tx, l.id);
    });
  }

  async function mudarEstado(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string,
    d: { estado: EstadoLigacaoId; idExterno?: string | null; detalhe?: string | null; duracaoInformada?: number | null },
  ): Promise<LigacaoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const l = await carregarMinha(tx, ctx, id);
      if (!transicaoValida(l.estado, d.estado)) {
        throw invalido(`A ligação não pode passar de "${l.estado}" para "${d.estado}".`);
      }
      if (l.estado === d.estado && !d.idExterno) return carregarDto(tx, id); // repetido: nada muda
      const agora = new Date();
      let atendidaEm = d.estado === "em_ligacao" && !l.atendidaEm ? agora : l.atendidaEm;
      // Celular do vendedor: quem informa a duração é a pessoa, ao voltar para o sistema.
      if (l.provedor === "celular" && d.estado === "encerrada" && d.duracaoInformada !== undefined && d.duracaoInformada !== null) {
        atendidaEm = d.duracaoInformada > 0 ? new Date(agora.getTime() - d.duracaoInformada * 1000) : null;
      }
      const encerrando = d.estado === "encerrada" && l.estado !== "encerrada";
      await tx.db
        .update(ligacao)
        .set({
          estado: d.estado,
          atendidaEm,
          ...(d.idExterno ? { idExterno: d.idExterno } : {}),
          ...(encerrando
            ? {
                encerradaEm: agora,
                duracaoSegundos: atendidaEm ? Math.max(0, Math.round((agora.getTime() - atendidaEm.getTime()) / 1000)) : 0,
                motivoFim: d.detalhe ?? (atendidaEm ? "desligada" : "não atendida"),
              }
            : {}),
          atualizadoEm: agora,
        })
        .where(eq(ligacao.id, id));
      if (l.estado !== d.estado) await tx.db.insert(ligacaoEvento).values({ empresaId: ctx.empresaId, ligacaoId: id, estado: d.estado, detalhe: d.detalhe ?? null });
      if (encerrando) {
        // Histórico do contato sem digitação: a ligação encerrada vira evento com duração.
        const duracao = atendidaEm ? Math.round((agora.getTime() - atendidaEm.getTime()) / 1000) : 0;
        await registrar(tx, origem, {
          acao: "ligacao.encerrada",
          entidade: "ligacao",
          entidadeId: id,
          contatoId: l.contatoId,
          responsavelId: ctx.usuarioId,
          dados: { numero: l.numero, provedor: l.provedor, atendida: Boolean(atendidaEm), duracaoSegundos: duracao, motivo: d.detalhe ?? null },
        });
      } else {
        await publicar(tx, origem, { tipo: "ligacao.estado", entidade: "ligacao", entidadeId: id, responsavelId: ctx.usuarioId, dados: { estado: d.estado } });
      }
      return carregarDto(tx, id);
    });
  }

  async function finalizar(ctx: ContextoEmpresa, origem: Origem, id: string, d: { resultadoId?: string | null; observacao?: string | null }): Promise<LigacaoDto> {
    const l0 = await comEmpresa(banco, ctx.empresaId, (tx) => carregarMinha(tx, ctx, id));
    if (l0.estado !== "encerrada") await mudarEstado(ctx, origem, id, { estado: "encerrada", detalhe: "encerrada ao registrar o resultado" });
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const l = await carregarMinha(tx, ctx, id);
      if (d.resultadoId) {
        const [r] = await tx.db.select({ id: resultadoLigacao.id, nome: resultadoLigacao.nome }).from(resultadoLigacao).where(and(eq(resultadoLigacao.id, d.resultadoId), eq(resultadoLigacao.empresaId, ctx.empresaId)));
        if (!r) throw invalido("Resultado não encontrado.");
      }
      await tx.db.update(ligacao).set({ resultadoId: d.resultadoId ?? l.resultadoId, observacao: d.observacao ?? l.observacao, atualizadoEm: new Date() }).where(eq(ligacao.id, id));
      if (d.resultadoId || d.observacao) {
        await registrar(tx, origem, { acao: "ligacao.resultado", entidade: "ligacao", entidadeId: id, contatoId: l.contatoId, responsavelId: ctx.usuarioId, dados: { resultadoId: d.resultadoId ?? null, observacao: d.observacao ?? null } });
      }
      return carregarDto(tx, id);
    });
  }

  async function listar(ctx: ContextoEmpresa, escopo: Escopo, f: { contatoId?: string; usuarioId?: string; cursor?: string; limite: number }): Promise<Pagina<LigacaoDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const cursor = lerCursor(f.cursor);
      const linhas = await consulta(tx)
        .where(
          and(
            eq(ligacao.empresaId, ctx.empresaId),
            filtroUsuariosVisiveis(ctx, escopo, ligacao.usuarioId),
            f.contatoId ? eq(ligacao.contatoId, f.contatoId) : undefined,
            f.usuarioId ? eq(ligacao.usuarioId, f.usuarioId) : undefined,
            cursor ? sql`(${ligacao.criadoEm}, ${ligacao.id}) < (${cursor.criadoEm}::timestamptz, ${cursor.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(ligacao.criadoEm), desc(ligacao.id))
        .limit(f.limite + 1);
      return montarPagina(
        linhas.map((x) => ({ ...x, id: x.l.id, criadoEm: x.l.criadoEm })),
        f.limite,
        dto,
      );
    });
  }

  async function obter(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<LigacaoDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [x] = await consulta(tx).where(and(eq(ligacao.id, id), eq(ligacao.empresaId, ctx.empresaId), filtroUsuariosVisiveis(ctx, escopo, ligacao.usuarioId)));
      if (!x) throw naoEncontrado("Ligação");
      return dto(x);
    });
  }

  // Gravação ------------------------------------------------------------------------------------------
  /** Recebe a gravação (feita no navegador depois do aviso ao cliente), cifra e guarda com prazo de retenção. */
  async function gravar(ctx: ContextoEmpresa, origem: Origem, id: string, a: { mime: string; conteudo: Buffer }): Promise<LigacaoDto> {
    const { l, cfg } = await comEmpresa(banco, ctx.empresaId, async (tx) => ({ l: await carregarMinha(tx, ctx, id), cfg: await lerConfig(tx, ctx.empresaId) }));
    if (!cfg.gravacaoAtiva) throw invalido("A gravação de ligações está desligada nesta empresa.");
    if (l.gravacaoArquivoId) throw invalido("Esta ligação já tem gravação.");
    if (!a.conteudo.length) throw invalido("A gravação está vazia.");
    const { id: arquivoId } = await arquivos.gravar(ctx.empresaId, {
      nome: `gravacao-${id}.cifrado`,
      tipoMime: a.mime.split(";")[0] || "audio/webm",
      conteudo: cifrarBytes(config.crmChave, a.conteudo),
      criadoPor: ctx.usuarioId,
    });
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await tx.db
        .update(ligacao)
        .set({ gravacaoArquivoId: arquivoId, gravacaoExpiraEm: new Date(Date.now() + cfg.retencaoDias * 86_400_000), atualizadoEm: new Date() })
        .where(eq(ligacao.id, id));
      await registrar(tx, origem, { acao: "gravacao.salva", entidade: "ligacao", entidadeId: id, contatoId: l.contatoId, dados: { tamanho: a.conteudo.length, retencaoDias: cfg.retencaoDias } });
      return carregarDto(tx, id);
    });
  }

  const assinarLink = (ligacaoId: string, usuarioId: string, expira: number) =>
    createHmac("sha256", config.sessionSecret).update(`gravacao:${ligacaoId}:${usuarioId}:${expira}`).digest("base64url");

  /** Link temporário (5 min) para ouvir a gravação. Cada pedido de acesso fica registrado na auditoria. */
  async function linkGravacao(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string): Promise<{ url: string; expiraEm: string }> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [l] = await tx.db.select().from(ligacao).where(and(eq(ligacao.id, id), eq(ligacao.empresaId, ctx.empresaId), filtroUsuariosVisiveis(ctx, escopo, ligacao.usuarioId)));
      if (!l) throw naoEncontrado("Ligação");
      if (!l.gravacaoArquivoId) throw naoEncontrado("Gravação");
      const expira = Date.now() + VALIDADE_LINK_MS;
      await registrar(tx, origem, { acao: "gravacao.acessada", entidade: "ligacao", entidadeId: id, contatoId: l.contatoId, dados: { ligacaoDe: l.usuarioId } });
      return { url: `/api/gravacoes/${id}.${expira}.${assinarLink(id, ctx.usuarioId, expira)}`, expiraEm: new Date(expira).toISOString() };
    });
  }

  async function lerGravacao(ctx: ContextoEmpresa, token: string): Promise<{ mime: string; conteudo: Buffer }> {
    const [id, expiraTexto, assinatura] = token.split(".");
    const expira = Number(expiraTexto);
    if (!id || !assinatura || !Number.isFinite(expira) || !iguaisSeguro(assinatura, assinarLink(id, ctx.usuarioId, expira))) throw semPermissao();
    if (Date.now() > expira) throw new ErroApp(410, "LINK_INVALIDO", "O link da gravação expirou. Abra a gravação de novo pela ligação.");
    const l = await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [l] = await tx.db.select().from(ligacao).where(and(eq(ligacao.id, id), eq(ligacao.empresaId, ctx.empresaId)));
      return l;
    });
    if (!l?.gravacaoArquivoId) throw naoEncontrado("Gravação");
    const arq = await arquivos.ler(ctx.empresaId, l.gravacaoArquivoId);
    if (!arq.conteudo.length) throw new ErroApp(410, "NAO_ENCONTRADO", "A gravação passou do prazo de retenção e foi apagada.");
    return { mime: arq.tipoMime, conteudo: decifrarBytes(config.crmChave, arq.conteudo) };
  }

  /** Job diário: apaga o conteúdo das gravações vencidas (retenção da LGPD). A ligação e o registro ficam. */
  async function aplicarRetencao(): Promise<number> {
    const vencidas = await comoSistema(banco, (tx) =>
      tx.db
        .select({ id: ligacao.id, empresaId: ligacao.empresaId, arquivoId: ligacao.gravacaoArquivoId, contatoId: ligacao.contatoId })
        .from(ligacao)
        .where(and(isNotNull(ligacao.gravacaoArquivoId), lt(ligacao.gravacaoExpiraEm, new Date())))
        .limit(500),
    );
    let apagadas = 0;
    for (const v of vencidas) {
      await comEmpresa(banco, v.empresaId, async (tx) => {
        const [a] = await tx.db
          .update(arquivo)
          .set({ conteudo: Buffer.alloc(0), arquivadoEm: new Date() })
          .where(and(eq(arquivo.id, v.arquivoId as string), sql`octet_length(${arquivo.conteudo}) > 0`))
          .returning({ id: arquivo.id });
        if (!a) return;
        await registrar(tx, { empresaId: v.empresaId, atorId: null, ip: null, dispositivo: "retenção" }, { acao: "gravacao.expirada", entidade: "ligacao", entidadeId: v.id, contatoId: v.contatoId });
        apagadas++;
      });
    }
    return apagadas;
  }

  /** Para o tempo real e a tela: quem eu posso ver (gestor acompanha a equipe). */
  async function podeVer(ctx: ContextoEmpresa, escopo: Escopo, usuarioId: string): Promise<boolean> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const v = await usuariosVisiveis(tx, ctx, escopo);
      return v === "todos" || v.has(usuarioId);
    });
  }

  return { obterConfig, salvarConfig, ramais, salvarRamal, meuTelefone, resultados, salvarResultado, criar, mudarEstado, finalizar, listar, obter, gravar, linkGravacao, lerGravacao, aplicarRetencao, podeVer };
}

export type ServicoTelefonia = ReturnType<typeof criarServicoTelefonia>;
