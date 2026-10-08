// Tempo real por SSE. Cada instância do servidor escuta o canal de eventos do PostgreSQL (LISTEN):
// com várias instâncias, todas recebem todos os avisos e entregam às conexões que têm abertas.
import pg from "pg";
import type { FastifyReply } from "fastify";
import { temPermissao, type Escopo, type Modulo } from "@mg/shared";
import { comEmpresa, type Banco } from "../../infra/banco.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { usuariosVisiveis } from "../acesso/escopo.js";
import { CANAL_EVENTOS, type AvisoEvento } from "./publicar.js";

/** Entidade do evento → módulo cuja permissão de "ver" libera o aviso. */
export const MODULO_DA_ENTIDADE: Record<string, Modulo> = {
  usuario: "usuarios",
  equipe: "usuarios",
  perfil: "usuarios",
  unidade: "configuracoes",
  empresa: "configuracoes",
};

interface Conexao {
  ctx: ContextoEmpresa;
  reply: FastifyReply;
  /** Por módulo: quem a pessoa enxerga, conforme o escopo de "ver". */
  visiveis: Map<Modulo, Set<string> | "todos">;
  escopos: Map<Modulo, Escopo>;
}

export class TempoReal {
  private cliente: pg.Client | null = null;
  private parado = false;
  private readonly conexoes = new Map<string, Set<Conexao>>();

  constructor(
    private readonly banco: Banco,
    private readonly databaseUrl: string,
  ) {}

  async iniciar(): Promise<void> {
    this.parado = false;
    const cliente = new pg.Client({ connectionString: this.databaseUrl });
    cliente.on("notification", (msg) => {
      if (msg.channel !== CANAL_EVENTOS || !msg.payload) return;
      try {
        this.distribuir(JSON.parse(msg.payload) as AvisoEvento);
      } catch (err) {
        console.error("[tempo-real] aviso inválido:", (err as Error).message);
      }
    });
    cliente.on("error", (err) => {
      console.error("[tempo-real] conexão perdida, reconectando:", err.message);
      this.cliente = null;
      if (!this.parado) setTimeout(() => void this.iniciar().catch(() => undefined), 1000);
    });
    await cliente.connect();
    await cliente.query(`LISTEN ${CANAL_EVENTOS}`);
    this.cliente = cliente;
  }

  async parar(): Promise<void> {
    this.parado = true;
    for (const conjunto of this.conexoes.values()) {
      for (const c of conjunto) c.reply.raw.end();
    }
    this.conexoes.clear();
    await this.cliente?.end().catch(() => undefined);
    this.cliente = null;
  }

  totalConexoes(): number {
    let total = 0;
    for (const c of this.conexoes.values()) total += c.size;
    return total;
  }

  async conectar(ctx: ContextoEmpresa, reply: FastifyReply): Promise<void> {
    const visiveis = new Map<Modulo, Set<string> | "todos">();
    const escopos = new Map<Modulo, Escopo>();
    const modulos = [...new Set(Object.values(MODULO_DA_ENTIDADE))];
    await comEmpresa(this.banco, ctx.empresaId, async (tx) => {
      for (const modulo of modulos) {
        const escopo = temPermissao(ctx.permissoes, modulo, "ver");
        if (!escopo) continue;
        escopos.set(modulo, escopo);
        visiveis.set(modulo, await usuariosVisiveis(tx, ctx, escopo));
      }
    });

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write(`retry: 3000\n\n`);
    reply.raw.write(`data: ${JSON.stringify({ tipo: "conectado" })}\n\n`);

    const conexao: Conexao = { ctx, reply, visiveis, escopos };
    const conjunto = this.conexoes.get(ctx.empresaId) ?? new Set();
    conjunto.add(conexao);
    this.conexoes.set(ctx.empresaId, conjunto);

    // Batimento da conexão aberta (não é rotina de negócio): mantém proxies sem cortar o SSE.
    // eslint-disable-next-line no-restricted-syntax
    const batimento = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    reply.raw.on("close", () => {
      clearInterval(batimento);
      conjunto.delete(conexao);
      if (!conjunto.size) this.conexoes.delete(ctx.empresaId);
    });
  }

  private distribuir(aviso: AvisoEvento): void {
    const conjunto = this.conexoes.get(aviso.empresaId);
    if (!conjunto) return;
    const dados = JSON.stringify({ tipo: aviso.tipo, entidade: aviso.entidade, entidadeId: aviso.entidadeId });
    for (const c of conjunto) {
      if (this.podeReceber(c, aviso)) c.reply.raw.write(`data: ${dados}\n\n`);
    }
  }

  private podeReceber(c: Conexao, aviso: AvisoEvento): boolean {
    if (aviso.paraUsuarioId) return aviso.paraUsuarioId === c.ctx.usuarioId;
    const modulo = MODULO_DA_ENTIDADE[aviso.entidade];
    if (!modulo) return false;
    const escopo = c.escopos.get(modulo);
    if (!escopo) return false;
    if (escopo === "empresa") return true;
    if (!aviso.responsavelId) return escopo !== "proprio";
    const visiveis = c.visiveis.get(modulo);
    return visiveis === "todos" || Boolean(visiveis?.has(aviso.responsavelId));
  }
}
