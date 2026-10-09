// Avisos no celular (Web Push) atrás de interface: provedor real (VAPID) ou demonstração (caixa de saída).
// Push só para quem está fora: notificação que chegou por tempo real a uma tela aberta não vira push.
import { and, eq, inArray, isNull } from "drizzle-orm";
import webpush from "web-push";
import { comoSistema, type Banco } from "../../infra/banco.js";
import { avisoSaida, pushInscricao } from "../../infra/esquema.js";
import { cifrar, decifrar } from "../../infra/seguranca/cripto.js";
import { erroSeguro, registrarLog } from "../../infra/log.js";
import type { Config } from "../../config.js";

export const FILA_PUSH = "push.varrer";

export interface InscricaoPush {
  endpoint: string;
  chaves: { p256dh: string; auth: string };
}
export interface ConteudoPush {
  titulo: string;
  texto: string | null;
  /** Caminho dentro do app (ex.: /agenda). */
  link: string | null;
  tag: string;
}

export interface ProvedorPush {
  readonly id: "demonstracao" | "webpush";
  /** Chave pública VAPID para o navegador se inscrever (null = sem push real). */
  readonly chavePublica: string | null;
  /** "expirada": o navegador cancelou a inscrição (404/410) — não adianta tentar de novo. */
  enviar(inscricao: InscricaoPush, conteudo: ConteudoPush, usuarioId: string): Promise<"ok" | "expirada">;
}

/** Demonstração: o aviso vai para a caixa de saída (canal "push"), sem serviço externo. */
export function provedorPushDemonstracao(banco: Banco): ProvedorPush {
  return {
    id: "demonstracao",
    chavePublica: null,
    async enviar(_inscricao, c, usuarioId) {
      await comoSistema(banco, (tx) => tx.db.insert(avisoSaida).values({ canal: "push", para: usuarioId, assunto: c.titulo, texto: [c.texto, c.link].filter(Boolean).join("\n") }));
      return "ok";
    },
  };
}

export function provedorWebPush(vapid: NonNullable<Config["vapid"]>): ProvedorPush {
  webpush.setVapidDetails(vapid.contato, vapid.publica, vapid.privada);
  return {
    id: "webpush",
    chavePublica: vapid.publica,
    async enviar(inscricao, c) {
      try {
        await webpush.sendNotification({ endpoint: inscricao.endpoint, keys: inscricao.chaves }, JSON.stringify(c), { TTL: 3600, urgency: "high" });
        return "ok";
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return "expirada";
        throw err;
      }
    },
  };
}

export function criarProvedorPush(config: Config, banco: Banco): ProvedorPush {
  return config.vapid ? provedorWebPush(config.vapid) : provedorPushDemonstracao(banco);
}

/** Só caminhos do próprio app: o link do aviso nunca leva para fora. */
export const linkSeguro = (link: string | null) => (link && link.startsWith("/") && !link.startsWith("//") ? link : "/");

export function criarServicoPush(banco: Banco, config: Config, provedor: ProvedorPush) {
  async function inscrever(usuarioId: string, i: InscricaoPush, dispositivo: string | null): Promise<void> {
    const celular = /Android|iPhone|iPad|Mobile/i.test(dispositivo ?? "");
    const chaves = cifrar(config.crmChave, JSON.stringify(i.chaves));
    await comoSistema(banco, (tx) =>
      tx.db
        .insert(pushInscricao)
        .values({ usuarioId, endpoint: i.endpoint, chaves, celular, dispositivo })
        // O mesmo aparelho passa para quem entrou nele agora.
        .onConflictDoUpdate({ target: pushInscricao.endpoint, set: { usuarioId, chaves, celular, dispositivo, encerradaEm: null, criadoEm: new Date() } }),
    );
  }

  async function cancelar(usuarioId: string, endpoint: string): Promise<void> {
    await comoSistema(banco, (tx) =>
      tx.db.update(pushInscricao).set({ encerradaEm: new Date() }).where(and(eq(pushInscricao.endpoint, endpoint), eq(pushInscricao.usuarioId, usuarioId))),
    );
  }

  /** Notificação que chegou a uma tela aberta (tempo real) não precisa de push. */
  async function marcarEntregue(notificacaoId: string): Promise<void> {
    await banco.pool.query("UPDATE notificacao SET entregue_em = now() WHERE id = $1 AND entregue_em IS NULL", [notificacaoId]);
  }

  /**
   * Job (a cada minuto): avisos de quem está fora — não lidos, não entregues por tempo real depois de 15 s.
   * Marca antes de enviar (dois jobs não mandam o mesmo aviso duas vezes).
   */
  async function varrer(): Promise<number> {
    const pendentes = await comoSistema(banco, async (tx) => {
      const { rows } = await tx.cliente.query<{ id: string; usuario_id: string; titulo: string; texto: string | null; link: string | null; so_celular: boolean }>(
        `UPDATE notificacao SET push_em = now()
          WHERE id IN (SELECT id FROM notificacao
                        WHERE push_em IS NULL AND lida_em IS NULL AND entregue_em IS NULL
                          AND criado_em < now() - interval '15 seconds' AND criado_em > now() - interval '30 minutes'
                        ORDER BY criado_em LIMIT 200 FOR UPDATE SKIP LOCKED)
        RETURNING id, usuario_id, titulo, texto, link, so_celular`,
      );
      return rows;
    });
    if (!pendentes.length) return 0;
    const inscricoes = await comoSistema(banco, (tx) =>
      tx.db
        .select()
        .from(pushInscricao)
        .where(and(inArray(pushInscricao.usuarioId, [...new Set(pendentes.map((p) => p.usuario_id))]), isNull(pushInscricao.encerradaEm))),
    );
    let enviados = 0;
    for (const n of pendentes) {
      const conteudo: ConteudoPush = { titulo: n.titulo, texto: n.texto, link: linkSeguro(n.link), tag: n.id };
      for (const i of inscricoes.filter((x) => x.usuarioId === n.usuario_id && (!n.so_celular || x.celular))) {
        try {
          const r = await provedor.enviar({ endpoint: i.endpoint, chaves: JSON.parse(decifrar(config.crmChave, i.chaves)) }, conteudo, n.usuario_id);
          await comoSistema(banco, (tx) =>
            tx.db
              .update(pushInscricao)
              .set(r === "ok" ? { ultimoEnvioEm: new Date() } : { encerradaEm: new Date() })
              .where(eq(pushInscricao.id, i.id)),
          );
          if (r === "ok") enviados++;
        } catch (err) {
          // Um aparelho com problema não impede os outros; fica no log (sem conteúdo do aviso).
          registrarLog({ level: "warn", event: "push.falhou", inscricaoId: i.id, erro: erroSeguro(err) });
        }
      }
    }
    return enviados;
  }

  return { inscrever, cancelar, marcarEntregue, varrer, chavePublica: provedor.chavePublica };
}
