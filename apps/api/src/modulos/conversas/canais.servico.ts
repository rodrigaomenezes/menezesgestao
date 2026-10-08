// Canais de mensagens: cadastro, credenciais (cifradas, só entram), conexão e estado.
// Quando um canal cai, os administradores de Conversas recebem uma notificação (nada falha em silêncio).
import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { CanalDto, ConexaoDto } from "@mg/shared";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { canal, equipe, type HorarioCanal, type ProvedorCanal } from "../../infra/esquema.js";
import { conflito, codigoPg, invalido, naoEncontrado } from "../../infra/erros.js";
import { iso } from "../../infra/paginacao.js";
import { cifrar, decifrar } from "../../infra/seguranca/cripto.js";
import type { Config } from "../../config.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { publicar } from "../eventos/publicar.js";
import { notificar } from "../notificacoes/notificar.js";
import type { CanalProvedor, EstadoConexao, ProvedorMensagens } from "./provedores/tipos.js";

export type RegistroProvedores = Record<ProvedorCanal, ProvedorMensagens>;
type LinhaCanal = typeof canal.$inferSelect;

export const HORARIO_PADRAO: HorarioCanal = { dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" };

/** Token de verificação do webhook: derivado do canal (não precisa ser guardado nem trocado). */
export function tokenWebhook(config: Config, canalId: string): string {
  return createHmac("sha256", config.sessionSecret).update(`webhook:${canalId}`).digest("base64url").slice(0, 32);
}

export function canalDto(c: LinhaCanal, config: Config): CanalDto {
  return {
    id: c.id,
    nome: c.nome,
    provedor: c.provedor,
    numero: c.numero,
    status: c.status,
    statusDetalhe: c.statusDetalhe,
    statusEm: iso(c.statusEm) ?? new Date().toISOString(),
    temCredenciais: Boolean(c.credenciais),
    webhookUrl: c.provedor === "cloud_api" ? `${config.appUrl}/api/webhooks/whatsapp/${c.id}` : null,
    webhookToken: c.provedor === "cloud_api" ? tokenWebhook(config, c.id) : null,
    horario: c.horario,
    equipeId: c.equipeId,
    arquivadoEm: iso(c.arquivadoEm),
  };
}

/** Canal com as credenciais decifradas, só em memória, para o provedor usar. */
export function paraProvedor(chave: Buffer, c: LinhaCanal): CanalProvedor {
  return {
    id: c.id,
    empresaId: c.empresaId,
    provedor: c.provedor,
    identificadorExterno: c.identificadorExterno,
    credenciais: c.credenciais ? (JSON.parse(decifrar(chave, c.credenciais)) as Record<string, string>) : null,
  };
}

/** Quem administra Conversas na empresa (recebe aviso de canal caído). */
async function administradoresDeConversas(tx: Tx, empresaId: string): Promise<string[]> {
  const { rows } = await tx.db.execute<{ usuario_id: string }>(sql`
    SELECT DISTINCT v.usuario_id FROM vinculo v
      JOIN permissao p ON p.perfil_id = v.perfil_id AND p.modulo = 'conversas' AND p.acao = 'administrar'
     WHERE v.empresa_id = ${empresaId} AND v.status = 'ativo' AND v.arquivado_em IS NULL`);
  return rows.map((r) => r.usuario_id);
}

export function criarServicoCanais(s: Servicos, provedores: RegistroProvedores) {
  const { banco, config } = s;

  async function carregar(tx: Tx, empresaId: string, id: string): Promise<LinhaCanal> {
    const [c] = await tx.db.select().from(canal).where(and(eq(canal.id, id), eq(canal.empresaId, empresaId)));
    if (!c) throw naoEncontrado("Canal");
    return c;
  }

  /** A equipe do canal tem de ser desta empresa (o RLS esconde as outras: vira "não encontrada"). */
  async function validarEquipe(tx: Tx, empresaId: string, equipeId: string | null | undefined) {
    if (!equipeId) return;
    const [e] = await tx.db.select({ id: equipe.id }).from(equipe).where(and(eq(equipe.id, equipeId), eq(equipe.empresaId, empresaId), isNull(equipe.arquivadoEm)));
    if (!e) throw invalido("Equipe não encontrada. Escolha uma equipe ativa desta empresa.");
  }

  async function comQr(c: LinhaCanal, estado: EstadoConexao | null): Promise<ConexaoDto> {
    const qr = estado?.qr ? await QRCode.toDataURL(estado.qr, { margin: 1, width: 280 }) : null;
    return { canal: canalDto(c, config), qr };
  }

  /** Grava o estado vindo do provedor; avisa os administradores quando um canal conectado cai. */
  async function gravarEstado(alvo: { id: string; empresaId: string }, estado: EstadoConexao): Promise<void> {
    await comEmpresa(banco, alvo.empresaId, async (tx) => {
      const [antes] = await tx.db.select().from(canal).where(eq(canal.id, alvo.id));
      if (!antes) return;
      const mudou = antes.status !== estado.status || (estado.detalhe ?? null) !== antes.statusDetalhe;
      await tx.db
        .update(canal)
        .set({
          status: estado.status,
          statusDetalhe: estado.detalhe ?? null,
          statusEm: mudou ? new Date() : antes.statusEm,
          ...(estado.numero ? { numero: estado.numero } : {}),
          ...(estado.identificadorExterno ? { identificadorExterno: estado.identificadorExterno } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(canal.id, alvo.id));
      const origem: Origem = { empresaId: alvo.empresaId, atorId: null, ip: null, dispositivo: `canal ${antes.provedor}` };
      // QR novo também avisa (a tela mostra o código atualizado).
      if (mudou || estado.qr) await publicar(tx, origem, { tipo: "canal.estado", entidade: "canal", entidadeId: alvo.id, dados: { status: estado.status } });
      if (antes.status === "conectado" && (estado.status === "desconectado" || estado.status === "erro")) {
        for (const usuarioId of await administradoresDeConversas(tx, alvo.empresaId)) {
          await notificar(tx, origem, {
            usuarioId,
            titulo: `WhatsApp desconectado: ${antes.nome}`,
            texto: estado.detalhe ?? "O canal parou de receber e enviar mensagens. Conecte de novo.",
            link: "/conversas/canais",
          });
        }
      }
    });
  }

  async function listar(ctx: ContextoEmpresa): Promise<CanalDto[]> {
    return comEmpresa(banco, ctx.empresaId, async (tx) =>
      (await tx.db.select().from(canal).where(eq(canal.empresaId, ctx.empresaId)).orderBy(asc(canal.criadoEm))).map((c) => canalDto(c, config)),
    );
  }

  async function criar(ctx: ContextoEmpresa, origem: Origem, dados: { nome: string; provedor: ProvedorCanal; equipeId?: string | null; horario?: HorarioCanal }): Promise<CanalDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await validarEquipe(tx, ctx.empresaId, dados.equipeId);
      const [c] = await tx.db
        .insert(canal)
        .values({
          empresaId: ctx.empresaId,
          nome: dados.nome,
          provedor: dados.provedor,
          equipeId: dados.equipeId ?? null,
          horario: dados.horario ?? HORARIO_PADRAO,
          criadoPor: ctx.usuarioId,
        })
        .returning();
      await registrar(tx, origem, { acao: "canal.criado", entidade: "canal", entidadeId: c.id, depois: { nome: c.nome, provedor: c.provedor } });
      return canalDto(c, config);
    });
  }

  async function atualizar(ctx: ContextoEmpresa, origem: Origem, id: string, dados: { nome?: string; equipeId?: string | null; horario?: HorarioCanal; arquivado?: boolean }): Promise<CanalDto> {
    const c0 = await comEmpresa(banco, ctx.empresaId, (tx) => carregar(tx, ctx.empresaId, id));
    if (dados.arquivado === true && c0.status !== "desconectado") {
      await provedores[c0.provedor].desconectar(paraProvedor(config.crmChave, c0)).catch(() => undefined);
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await validarEquipe(tx, ctx.empresaId, dados.equipeId);
      const { arquivado, ...resto } = dados;
      const [c] = await tx.db
        .update(canal)
        .set({
          ...resto,
          ...(arquivado === undefined ? {} : { arquivadoEm: arquivado ? new Date() : null }),
          ...(arquivado ? { status: "desconectado" as const, statusDetalhe: "Canal arquivado.", statusEm: new Date() } : {}),
          atualizadoEm: new Date(),
        })
        .where(and(eq(canal.id, id), eq(canal.empresaId, ctx.empresaId)))
        .returning();
      const acao = arquivado === true ? "canal.arquivado" : arquivado === false ? "canal.restaurado" : "canal.atualizado";
      await registrar(tx, origem, { acao, entidade: "canal", entidadeId: id, antes: { nome: c0.nome, horario: c0.horario }, depois: resto });
      return canalDto(c, config);
    });
  }

  async function salvarCredenciais(ctx: ContextoEmpresa, origem: Origem, id: string, dados: { phoneNumberId: string; token: string; appSecret: string; numero?: string }): Promise<CanalDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c0 = await carregar(tx, ctx.empresaId, id);
      if (c0.provedor !== "cloud_api") throw invalido("Só canais da API oficial usam credenciais. A conexão por QR é feita pelo celular.");
      const cifradas = cifrar(config.crmChave, JSON.stringify({ phoneNumberId: dados.phoneNumberId, token: dados.token, appSecret: dados.appSecret }));
      let c: LinhaCanal;
      try {
        [c] = await tx.db
          .update(canal)
          .set({ credenciais: cifradas, identificadorExterno: dados.phoneNumberId, status: "desconectado", statusDetalhe: "Credenciais salvas. Clique em Conectar para testar.", statusEm: new Date(), atualizadoEm: new Date() })
          .where(eq(canal.id, id))
          .returning();
      } catch (e) {
        // A transação é desfeita inteira: nada mais roda depois daqui.
        if (codigoPg(e) === "23505") throw conflito("Este número da API oficial já está ligado a outro canal.");
        throw e;
      }
      // Nunca registra os valores: só que foram trocados.
      await registrar(tx, origem, { acao: "canal.credenciais_alteradas", entidade: "canal", entidadeId: id, depois: { phoneNumberId: dados.phoneNumberId } });
      return canalDto(c, config);
    });
  }

  async function conectar(ctx: ContextoEmpresa, origem: Origem, id: string): Promise<ConexaoDto> {
    const c0 = await comEmpresa(banco, ctx.empresaId, (tx) => carregar(tx, ctx.empresaId, id));
    if (c0.arquivadoEm) throw invalido("Canal arquivado. Restaure antes de conectar.");
    if (c0.provedor === "cloud_api" && !c0.credenciais) throw invalido("Cadastre as credenciais da Meta antes de conectar.");
    await comEmpresa(banco, ctx.empresaId, (tx) => registrar(tx, origem, { acao: "canal.conexao_solicitada", entidade: "canal", entidadeId: id }));
    const estado = await provedores[c0.provedor].conectar(paraProvedor(config.crmChave, c0));
    await gravarEstado(c0, estado);
    const c = await comEmpresa(banco, ctx.empresaId, (tx) => carregar(tx, ctx.empresaId, id));
    return comQr(c, estado);
  }

  async function desconectar(ctx: ContextoEmpresa, origem: Origem, id: string): Promise<ConexaoDto> {
    const c0 = await comEmpresa(banco, ctx.empresaId, (tx) => carregar(tx, ctx.empresaId, id));
    await provedores[c0.provedor].desconectar(paraProvedor(config.crmChave, c0));
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      await tx.db.update(canal).set({ status: "desconectado", statusDetalhe: "Desconectado pelo administrador.", statusEm: new Date() }).where(eq(canal.id, id));
      await registrar(tx, origem, { acao: "canal.desconectado", entidade: "canal", entidadeId: id });
    });
    return comQr(await comEmpresa(banco, ctx.empresaId, (tx) => carregar(tx, ctx.empresaId, id)), null);
  }

  /** Estado atual (com o QR da vez, se estiver aguardando leitura). */
  async function estado(ctx: ContextoEmpresa, id: string): Promise<ConexaoDto> {
    const c = await comEmpresa(banco, ctx.empresaId, (tx) => carregar(tx, ctx.empresaId, id));
    const atual = c.provedor === "qr" ? await provedores.qr.estado(paraProvedor(config.crmChave, c)) : null;
    return comQr(c, atual);
  }

  /** Na subida do servidor: reconecta os canais por QR que estavam conectados (a sessão está no banco). */
  async function reconectarQr(): Promise<void> {
    const canais = await comoSistema(banco, (tx) =>
      tx.db.select().from(canal).where(and(eq(canal.provedor, "qr"), sql`${canal.arquivadoEm} IS NULL`, sql`${canal.status} IN ('conectado', 'conectando')`)),
    );
    for (const c of canais) {
      void provedores.qr
        .conectar(paraProvedor(config.crmChave, c))
        .then((e) => gravarEstado(c, e))
        .catch((err: Error) => console.error(JSON.stringify({ level: "error", event: "whatsapp_qr.reconexao_falhou", canalId: c.id, erro: err.message })));
    }
  }

  return { listar, criar, atualizar, salvarCredenciais, conectar, desconectar, estado, gravarEstado, reconectarQr, carregar };
}

export type ServicoCanais = ReturnType<typeof criarServicoCanais>;
