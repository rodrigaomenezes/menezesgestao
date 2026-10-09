// Entrada de mensagens (webhook, conexão por QR ou simulação). Regra de ouro: a resposta do cliente cai sempre
// na mesma conversa, e evento repetido nunca duplica nada.
// Busca em cascata: (1) id da mensagem já visto → ignora; (2) id do cliente no provedor; (3) telefone com e sem
// o nono dígito; (4) contato com esse telefone. Só então cria contato/conversa. Corrida entre dois webhooks do
// mesmo cliente novo é resolvida pelo índice único (canal, telefone) + nova tentativa.
import { erroSeguro, registrarLog } from "../../infra/log.js";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { formatarTelefone, variantesTelefone } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { automacao, canal, contato, conversa, empresa, mensagem } from "../../infra/esquema.js";
import { codigoPg } from "../../infra/erros.js";
import type { Servicos } from "../../app.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { publicar } from "../eventos/publicar.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { paraProvedor, type RegistroProvedores } from "./canais.servico.js";
import { FILAS_CONVERSAS, type ServicoEnvio } from "./envio.servico.js";
import { dentroDoHorario } from "./horario.js";
import { ErroProvedor, type EventoEntrada } from "./provedores/tipos.js";

type EventoMensagem = Extract<EventoEntrada, { tipo: "mensagem" }>;
type LinhaConversa = typeof conversa.$inferSelect;

const RESUMO_MIDIA = { imagem: "📷 Imagem", audio: "🎤 Áudio", video: "🎬 Vídeo", documento: "📄 Documento", texto: "" } as const;
const LIMITE_MIDIA = 16 * 1024 * 1024;

/** (1)–(4): acha a conversa deste cliente neste canal, se existir. */
async function acharConversa(tx: Tx, empresaId: string, canalId: string, ids: string[], telefone: string | null): Promise<LinhaConversa | null> {
  const telefones = telefone ? variantesTelefone(telefone) : [];
  const porIdOuTelefone = await tx.db
    .select()
    .from(conversa)
    .where(
      and(
        eq(conversa.canalId, canalId),
        isNull(conversa.mescladaEmId),
        sql`(${conversa.idsExternos} && ${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`}${
          telefones.length ? sql` OR ${conversa.telefone} IN (${sql.join(telefones.map((t) => sql`${t}`), sql`, `)})` : sql``
        })`,
      ),
    )
    .orderBy(asc(conversa.criadoEm))
    .limit(1);
  if (porIdOuTelefone[0]) return porIdOuTelefone[0];
  if (!telefones.length) return null;
  const [ct] = await tx.db.select({ id: contato.id }).from(contato).where(and(eq(contato.empresaId, empresaId), inArray(contato.telefone, telefones))).limit(1);
  if (!ct) return null;
  const [porContato] = await tx.db
    .select()
    .from(conversa)
    .where(and(eq(conversa.canalId, canalId), eq(conversa.contatoId, ct.id), isNull(conversa.mescladaEmId)))
    .orderBy(asc(conversa.criadoEm))
    .limit(1);
  return porContato ?? null;
}

export function criarServicoEntrada(s: Servicos, provedores: RegistroProvedores, arquivos: ProvedorArquivos, envio: ServicoEnvio) {
  const { banco, config, jobs } = s;

  async function mensagemRecebida(tx: Tx, cn: typeof canal.$inferSelect, ev: EventoMensagem): Promise<void> {
    // (1) Idempotência: o mesmo id de mensagem neste canal já foi gravado.
    const [repetida] = await tx.db.select({ id: mensagem.id }).from(mensagem).where(and(eq(mensagem.canalId, cn.id), eq(mensagem.idExterno, ev.idExterno)));
    if (repetida) return;

    const origem: Origem = { empresaId: cn.empresaId, atorId: null, ip: null, dispositivo: `whatsapp ${cn.provedor}` };
    const ids = [...new Set([ev.remetente, ...ev.idsAlternativos].filter(Boolean))];
    let c = await acharConversa(tx, cn.empresaId, cn.id, ids, ev.telefone);
    let nova = false;

    if (!c) {
      // Contato: reaproveita o que já tem este telefone (mesmo na lixeira); senão cria.
      const telefones = ev.telefone ? variantesTelefone(ev.telefone) : [];
      let [ct] = telefones.length
        ? await tx.db.select({ id: contato.id, responsavelId: contato.responsavelId }).from(contato).where(and(eq(contato.empresaId, cn.empresaId), inArray(contato.telefone, telefones))).limit(1)
        : [];
      if (!ct) {
        const nome = ev.nome?.trim() || (ev.telefone ? formatarTelefone(ev.telefone) : "Contato do WhatsApp");
        [ct] = await tx.db
          .insert(contato)
          .values({ empresaId: cn.empresaId, nome, telefone: ev.telefone, origem: "WhatsApp" })
          .returning({ id: contato.id, responsavelId: contato.responsavelId });
        await registrar(tx, origem, { acao: "contato.criado", entidade: "contato", entidadeId: ct.id, contatoId: ct.id, depois: { nome, telefone: ev.telefone, origem: "WhatsApp" } });
      }
      [c] = await tx.db
        .insert(conversa)
        .values({
          empresaId: cn.empresaId,
          canalId: cn.id,
          contatoId: ct.id,
          telefone: ev.telefone,
          idsExternos: ids,
          // Cliente com dono na carteira já cai com o dono; os demais ficam na fila da equipe do canal.
          atribuidaA: ct.responsavelId,
          equipeId: cn.equipeId,
        })
        .returning();
      nova = true;
    }

    const texto = ev.texto ?? null;
    const [m] = await tx.db
      .insert(mensagem)
      .values({
        empresaId: cn.empresaId,
        conversaId: c.id,
        canalId: cn.id,
        direcao: "entrada",
        tipo: ev.conteudo,
        texto,
        midiaNome: ev.midia?.nome ?? null,
        midiaMime: ev.midia?.mime ?? null,
        midiaPendente: ev.midia ? ev.midia.ref : null,
        status: "recebida",
        idExterno: ev.idExterno,
        criadoEm: ev.em,
      })
      .onConflictDoNothing()
      .returning();
    if (!m) return; // outro processo gravou a mesma mensagem ao mesmo tempo

    const reabre = c.status !== "aberta";
    await tx.db
      .update(conversa)
      .set({
        idsExternos: sql`ARRAY(SELECT DISTINCT unnest(${conversa.idsExternos} || ${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`}))`,
        status: "aberta",
        naoLidas: sql`${conversa.naoLidas} + 1`,
        ultimaMensagem: (texto ?? RESUMO_MIDIA[ev.conteudo]).slice(0, 120),
        ultimaMensagemEm: ev.em,
        ultimaEntradaEm: ev.em,
        atualizadoEm: new Date(),
      })
      .where(eq(conversa.id, c.id));
    // Telefone descoberto depois (cliente que chegou só com id do provedor): grava se ninguém mais tem.
    if (!c.telefone && ev.telefone) {
      await tx.db.execute(sql`
        UPDATE conversa SET telefone = ${ev.telefone}
         WHERE id = ${c.id} AND NOT EXISTS (
           SELECT 1 FROM conversa o WHERE o.canal_id = ${cn.id} AND o.telefone = ${ev.telefone} AND o.mesclada_em_id IS NULL)`);
    }

    await publicar(tx, origem, {
      tipo: "mensagem.recebida",
      entidade: "conversa",
      entidadeId: c.id,
      contatoId: c.contatoId,
      responsavelId: c.atribuidaA,
      dados: { mensagemId: m.id, tipo: ev.conteudo, resumo: (texto ?? RESUMO_MIDIA[ev.conteudo]).slice(0, 120), nova, reaberta: reabre && !nova },
    });
    if (ev.midia) await jobs.enfileirar(tx, FILAS_CONVERSAS.midia, { empresaId: cn.empresaId, mensagemId: m.id });

    // Mensagens automáticas.
    if (nova) await envio.enviarAutomatica(tx, origem, c, "boas_vindas");
    const [fora] = await tx.db
      .select({ id: automacao.id })
      .from(automacao)
      .where(and(eq(automacao.empresaId, cn.empresaId), eq(automacao.tipo, "fora_horario"), eq(automacao.ativa, true)));
    if (fora) {
      const [e] = await tx.db.select({ fuso: empresa.fuso }).from(empresa).where(eq(empresa.id, cn.empresaId));
      if (!dentroDoHorario(cn.horario, e?.fuso ?? "America/Sao_Paulo", ev.em > new Date() ? new Date() : ev.em)) {
        // No máximo uma a cada 12 h por conversa.
        const [recente] = await tx.db
          .select({ id: mensagem.id })
          .from(mensagem)
          .where(and(eq(mensagem.conversaId, c.id), eq(mensagem.automacao, "fora_horario"), gt(mensagem.criadoEm, new Date(Date.now() - 12 * 3600_000))))
          .limit(1);
        if (!recente) await envio.enviarAutomatica(tx, origem, c, "fora_horario");
      }
    }
  }

  async function statusRecebido(tx: Tx, cn: typeof canal.$inferSelect, ev: Extract<EventoEntrada, { tipo: "status" }>): Promise<void> {
    const ordem = { pendente: 0, falhou: 0, enviada: 1, entregue: 2, lida: 3, recebida: 0 } as const;
    const [m] = await tx.db.select().from(mensagem).where(and(eq(mensagem.canalId, cn.id), eq(mensagem.idExterno, ev.idExterno)));
    // Status nunca volta atrás (webhooks chegam fora de ordem); "falhou" vale sempre.
    if (!m || m.direcao !== "saida") return;
    if (ev.status !== "falhou" && ordem[ev.status] <= ordem[m.status]) return;
    await tx.db
      .update(mensagem)
      .set({ status: ev.status, erro: ev.status === "falhou" ? (ev.erro ?? "O WhatsApp não entregou a mensagem.") : null, atualizadoEm: new Date() })
      .where(eq(mensagem.id, m.id));
    const [c] = await tx.db.select({ atribuidaA: conversa.atribuidaA }).from(conversa).where(eq(conversa.id, m.conversaId));
    await publicar(tx, { empresaId: cn.empresaId, atorId: null, ip: null, dispositivo: `whatsapp ${cn.provedor}` }, {
      tipo: "mensagem.atualizada",
      entidade: "conversa",
      entidadeId: m.conversaId,
      responsavelId: c?.atribuidaA ?? null,
      dados: { mensagemId: m.id, status: ev.status },
    });
  }

  /** Processa os eventos de um canal, cada um na sua transação (um evento ruim não derruba os outros). */
  async function processar(alvo: { id: string; empresaId: string }, eventos: EventoEntrada[]): Promise<void> {
    for (const ev of eventos) {
      for (let tentativa = 1; ; tentativa++) {
        try {
          await comEmpresa(banco, alvo.empresaId, async (tx) => {
            const [cn] = await tx.db.select().from(canal).where(eq(canal.id, alvo.id));
            if (!cn || cn.arquivadoEm) return;
            if (ev.tipo === "mensagem") await mensagemRecebida(tx, cn, ev);
            else await statusRecebido(tx, cn, ev);
          });
          break;
        } catch (e) {
          // Dois eventos do mesmo cliente novo ao mesmo tempo: o segundo encontra a conversa na nova tentativa.
          if (codigoPg(e) === "23505" && tentativa < 3) continue;
          registrarLog({ level: "error", event: "conversas.entrada_falhou", canalId: alvo.id, tipo: ev.tipo, erro: erroSeguro(e) });
          throw e;
        }
      }
    }
  }

  /** Job: baixa a mídia recebida do provedor e guarda no armazenamento de arquivos. */
  async function baixarMidia(dados: { empresaId: string; mensagemId: string }): Promise<void> {
    const alvo = await comEmpresa(banco, dados.empresaId, async (tx) => {
      const [m] = await tx.db.select().from(mensagem).where(eq(mensagem.id, dados.mensagemId));
      if (!m?.midiaPendente || m.arquivoId) return null;
      const [cn] = await tx.db.select().from(canal).where(eq(canal.id, m.canalId));
      return cn ? { m, cn } : null;
    });
    if (!alvo) return;
    const { m, cn } = alvo;
    let midia;
    try {
      midia = await provedores[cn.provedor].baixarMidia(paraProvedor(config.crmChave, cn), m.midiaPendente as Record<string, unknown>);
    } catch (e) {
      if (e instanceof ErroProvedor && !e.temporario) {
        await comEmpresa(banco, dados.empresaId, (tx) =>
          tx.db.update(mensagem).set({ erro: e.message, midiaPendente: null, atualizadoEm: new Date() }).where(eq(mensagem.id, m.id)),
        );
        return;
      }
      throw e;
    }
    if (midia.conteudo.length > LIMITE_MIDIA) {
      await comEmpresa(banco, dados.empresaId, (tx) =>
        tx.db.update(mensagem).set({ erro: "Arquivo maior que 16 MB: veja no celular.", midiaPendente: null, atualizadoEm: new Date() }).where(eq(mensagem.id, m.id)),
      );
      return;
    }
    const mime = m.midiaMime && m.midiaMime !== "application/octet-stream" ? m.midiaMime : midia.mime;
    const nome = m.midiaNome ?? `${m.tipo}-${m.id.slice(0, 8)}.${(mime.split("/")[1] ?? "bin").split(";")[0]}`;
    const { id: arquivoId } = await arquivos.gravar(dados.empresaId, { nome, tipoMime: mime, conteudo: midia.conteudo, criadoPor: null });
    await comEmpresa(banco, dados.empresaId, async (tx) => {
      await tx.db.update(mensagem).set({ arquivoId, midiaNome: nome, midiaMime: mime, midiaPendente: null, atualizadoEm: new Date() }).where(eq(mensagem.id, m.id));
      const [c] = await tx.db.select({ atribuidaA: conversa.atribuidaA }).from(conversa).where(eq(conversa.id, m.conversaId));
      await publicar(tx, { empresaId: dados.empresaId, atorId: null, ip: null, dispositivo: "mídia" }, {
        tipo: "mensagem.atualizada",
        entidade: "conversa",
        entidadeId: m.conversaId,
        responsavelId: c?.atribuidaA ?? null,
        dados: { mensagemId: m.id, midia: true },
      });
    });
  }

  /** Última mensagem de entrada (usada pela tela para a janela de 24 h). */
  async function ultimaEntrada(tx: Tx, conversaId: string): Promise<Date | null> {
    const [m] = await tx.db
      .select({ em: mensagem.criadoEm })
      .from(mensagem)
      .where(and(eq(mensagem.conversaId, conversaId), eq(mensagem.direcao, "entrada")))
      .orderBy(desc(mensagem.criadoEm))
      .limit(1);
    return m?.em ?? null;
  }

  return { processar, baixarMidia, ultimaEntrada };
}

export type ServicoEntrada = ReturnType<typeof criarServicoEntrada>;
