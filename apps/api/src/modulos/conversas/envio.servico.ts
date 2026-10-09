// Saída de mensagens: grava como "pendente" e enfileira o envio (com novas tentativas); o job chama o provedor.
// Também agenda o follow-up e preenche as variáveis ({nome}, {vendedor}, {produto}, {empresa}).
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { preencherVariaveis } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { automacao, canal, contato, conversa, empresa, mensagem, oportunidade, usuario, type TipoAutomacao, type TipoMensagem } from "../../infra/esquema.js";
import type { Servicos } from "../../app.js";
import type { Origem } from "../auditoria/registro.js";
import { publicar } from "../eventos/publicar.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { paraProvedor, type RegistroProvedores } from "./canais.servico.js";
import { ErroProvedor, type ConteudoSaida } from "./provedores/tipos.js";

export const FILAS_CONVERSAS = {
  envio: "conversas.envio",
  midia: "conversas.midia",
  followUp: "conversas.follow_up",
  juntar: "conversas.juntar",
} as const;

type LinhaConversa = typeof conversa.$inferSelect;

export interface NovaSaida {
  tipo: TipoMensagem;
  texto?: string | null;
  arquivoId?: string | null;
  midiaNome?: string | null;
  midiaMime?: string | null;
  autorId: string | null;
  automacao?: TipoAutomacao | null;
  /** Áudio gravado na tela: vai como mensagem de voz. */
  voz?: boolean;
}

const resumo = (s: NovaSaida) =>
  s.texto?.slice(0, 120) ?? { imagem: "📷 Imagem", audio: "🎤 Áudio", video: "🎬 Vídeo", documento: "📄 Documento", texto: "", sistema: "" }[s.tipo];

/** Valores das variáveis para uma conversa (o vendedor é quem está atendendo). */
export async function variaveisDaConversa(tx: Tx, c: LinhaConversa, autorId: string | null): Promise<Record<string, string>> {
  const [ct] = c.contatoId ? await tx.db.select({ nome: contato.nome }).from(contato).where(eq(contato.id, c.contatoId)) : [];
  const vendedorId = autorId ?? c.atribuidaA;
  const [v] = vendedorId ? await tx.db.select({ nome: usuario.nome }).from(usuario).where(eq(usuario.id, vendedorId)) : [];
  const [op] = c.contatoId
    ? await tx.db
        .select({ oferta: oportunidade.oferta, titulo: oportunidade.titulo })
        .from(oportunidade)
        .where(and(eq(oportunidade.contatoId, c.contatoId), eq(oportunidade.status, "aberta"), isNull(oportunidade.arquivadoEm)))
        .orderBy(desc(oportunidade.atualizadoEm))
        .limit(1)
    : [];
  const [e] = await tx.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, c.empresaId));
  return {
    nome: ct?.nome.split(/\s+/)[0] ?? "",
    vendedor: v?.nome.split(/\s+/)[0] ?? "",
    produto: op?.oferta ?? op?.titulo ?? "",
    empresa: e?.nome ?? "",
  };
}

export function criarServicoEnvio(s: Servicos, provedores: RegistroProvedores, arquivos: ProvedorArquivos) {
  const { banco, config, jobs } = s;

  /** Cria a mensagem de saída (ou nota interna) e, se não for nota, enfileira o envio — na mesma transação. */
  async function criarSaida(tx: Tx, origem: Origem, c: LinhaConversa, saida: NovaSaida, nota = false): Promise<typeof mensagem.$inferSelect> {
    const [m] = await tx.db
      .insert(mensagem)
      .values({
        empresaId: c.empresaId,
        conversaId: c.id,
        canalId: c.canalId,
        direcao: nota ? "nota" : "saida",
        tipo: saida.tipo,
        texto: saida.texto ?? null,
        arquivoId: saida.arquivoId ?? null,
        midiaNome: saida.midiaNome ?? null,
        midiaMime: saida.midiaMime ?? null,
        status: nota ? "enviada" : "pendente",
        autorId: saida.autorId,
        automacao: saida.automacao ?? null,
      })
      .returning();
    if (!nota) {
      await tx.db
        .update(conversa)
        .set({
          ultimaMensagem: resumo(saida),
          ultimaMensagemEm: m.criadoEm,
          // Quem respondeu está esperando o cliente; mensagem automática não muda o andamento.
          ...(saida.autorId && c.status === "aberta" ? { status: "aguardando" as const } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(conversa.id, c.id));
      await jobs.enfileirar(tx, FILAS_CONVERSAS.envio, { empresaId: c.empresaId, mensagemId: m.id, voz: saida.voz ?? false });
      if (saida.autorId) {
        const [fu] = await tx.db
          .select({ horas: automacao.horas })
          .from(automacao)
          .where(and(eq(automacao.empresaId, c.empresaId), eq(automacao.tipo, "follow_up"), eq(automacao.ativa, true)));
        if (fu?.horas) await jobs.enfileirar(tx, FILAS_CONVERSAS.followUp, { empresaId: c.empresaId, conversaId: c.id, mensagemId: m.id }, { aposSegundos: fu.horas * 3600 });
      }
    }
    await publicar(tx, origem, {
      tipo: nota ? "mensagem.nota" : "mensagem.criada",
      entidade: "conversa",
      entidadeId: c.id,
      contatoId: c.contatoId,
      responsavelId: c.atribuidaA,
      dados: { mensagemId: m.id, tipo: saida.tipo, automacao: saida.automacao ?? null, ...(nota ? {} : { resumo: resumo(saida) }) },
    });
    return m;
  }

  /** Mensagem automática (texto com variáveis) se a automação estiver ativa. */
  async function enviarAutomatica(tx: Tx, origem: Origem, c: LinhaConversa, tipo: TipoAutomacao): Promise<boolean> {
    // LGPD: quem pediu para não ser contatado não recebe mensagem automática (boas-vindas, fora do horário, follow-up).
    if (c.contatoId) {
      const [ct] = await tx.db.select({ naoContatar: contato.naoContatar }).from(contato).where(eq(contato.id, c.contatoId));
      if (ct?.naoContatar) return false;
    }
    const [a] = await tx.db
      .select()
      .from(automacao)
      .where(and(eq(automacao.empresaId, c.empresaId), eq(automacao.tipo, tipo), eq(automacao.ativa, true)));
    if (!a) return false;
    const texto = preencherVariaveis(a.texto, await variaveisDaConversa(tx, c, null));
    if (!texto) return false;
    await criarSaida(tx, origem, c, { tipo: "texto", texto, autorId: null, automacao: tipo });
    return true;
  }

  /** Job: entrega a mensagem pelo provedor do canal. Idempotente: só envia o que está pendente ou falhou. */
  async function processarEnvio(dados: { empresaId: string; mensagemId: string; voz?: boolean }): Promise<void> {
    const alvo = await comEmpresa(banco, dados.empresaId, async (tx) => {
      const [m] = await tx.db.select().from(mensagem).where(eq(mensagem.id, dados.mensagemId));
      if (!m || m.direcao !== "saida" || !["pendente", "falhou"].includes(m.status)) return null;
      const [c] = await tx.db.select().from(conversa).where(eq(conversa.id, m.conversaId));
      const [cn] = await tx.db.select().from(canal).where(eq(canal.id, m.canalId));
      return c && cn ? { m, c, cn } : null;
    });
    if (!alvo) return;
    const { m, c, cn } = alvo;
    const origem: Origem = { empresaId: dados.empresaId, atorId: null, ip: null, dispositivo: "envio" };

    async function marcar(campos: Partial<typeof mensagem.$inferInsert>) {
      await comEmpresa(banco, dados.empresaId, async (tx) => {
        await tx.db.update(mensagem).set({ ...campos, atualizadoEm: new Date() }).where(eq(mensagem.id, m.id));
        await publicar(tx, origem, { tipo: "mensagem.atualizada", entidade: "conversa", entidadeId: c.id, responsavelId: c.atribuidaA, dados: { mensagemId: m.id, status: campos.status } });
      });
    }

    try {
      let conteudo: ConteudoSaida;
      if (m.tipo === "texto" || !m.arquivoId) conteudo = { tipo: "texto", texto: m.texto ?? "" };
      else {
        const arq = await arquivos.ler(dados.empresaId, m.arquivoId);
        const midia = { nome: m.midiaNome ?? arq.nome, mime: m.midiaMime ?? arq.tipoMime, conteudo: arq.conteudo };
        conteudo =
          m.tipo === "audio"
            ? { tipo: "audio", midia, voz: dados.voz ?? /ogg/.test(midia.mime) }
            : { tipo: m.tipo === "imagem" || m.tipo === "video" ? m.tipo : "documento", midia, legenda: m.texto };
      }
      // Prefere o id que o próprio provedor usou com este cliente.
      const idExterno = c.idsExternos.find((i) => i.includes("@")) ?? c.idsExternos[0] ?? null;
      const r = await provedores[cn.provedor].enviar(paraProvedor(config.crmChave, cn), { telefone: c.telefone, idExterno }, conteudo);
      await marcar({ status: cn.provedor === "demonstracao" ? "entregue" : "enviada", idExterno: r.idExterno, erro: null });
    } catch (e) {
      const erro = e instanceof ErroProvedor ? e.message : "Falha inesperada no envio. Tentando de novo.";
      await marcar({ status: "falhou", erro });
      // Erro definitivo (número sem WhatsApp, fora da janela…): não adianta tentar de novo.
      if (e instanceof ErroProvedor && !e.temporario) return;
      throw e;
    }
  }

  /** Job: follow-up se o cliente não respondeu à última mensagem (e nenhum follow-up foi enviado depois dela). */
  async function processarFollowUp(dados: { empresaId: string; conversaId: string; mensagemId: string }): Promise<void> {
    await comEmpresa(banco, dados.empresaId, async (tx) => {
      // Trava a conversa: dois jobs para a mesma mensagem não mandam dois follow-ups.
      const { rows } = await tx.db.execute<{ id: string }>(sql`SELECT id FROM conversa WHERE id = ${dados.conversaId} FOR UPDATE`);
      if (!rows.length) return;
      const [c] = await tx.db.select().from(conversa).where(eq(conversa.id, dados.conversaId));
      const [gatilho] = await tx.db.select().from(mensagem).where(eq(mensagem.id, dados.mensagemId));
      if (!c || !gatilho || c.status === "resolvida" || c.mescladaEmId) return;
      const depois = await tx.db
        .select({ id: mensagem.id })
        .from(mensagem)
        .where(and(eq(mensagem.conversaId, c.id), ne(mensagem.direcao, "nota"), gt(mensagem.criadoEm, gatilho.criadoEm)))
        .limit(1);
      if (depois.length) return; // alguém escreveu depois (cliente, vendedor ou outro follow-up)
      await enviarAutomatica(tx, { empresaId: dados.empresaId, atorId: null, ip: null, dispositivo: "automação" }, c, "follow_up");
    });
  }

  return { criarSaida, enviarAutomatica, processarEnvio, processarFollowUp };
}

export type ServicoEnvio = ReturnType<typeof criarServicoEnvio>;
