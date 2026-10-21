// Cobrança dos clientes da empresa pelo provedor dela. A chave fica cifrada (CRM_CHAVE) e nunca volta para a tela; a
// cobrança nasce da venda; o aviso do provedor (webhook) dá baixa: paga → venda confirmada (estoque, BPI, evento).
// Cada aviso é processado uma vez só (cobranca_aviso), então repetir o webhook não muda nada.
import type { CobrancaDto, ContaCobrancaDto, Escopo, ProvedorCobrancaId } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { ErroApp, conflito, invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { registrarLog } from "../../infra/log.js";
import { cifrar, decifrar, iguaisSeguro, novoToken } from "../../infra/seguranca/cripto.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { fusoDe, hojeNoFuso } from "../operacao/comum.js";
import { confirmarPorPagamento, criarServicoVendas } from "../receita/vendas.servico.js";
import { provedorAsaas } from "./provedores/asaas.js";
import { provedorRecebimentoDemonstracao } from "./provedores/demonstracao.js";
import { ErroCobranca, type CredenciaisCobranca, type ProvedorRecebimento } from "./provedores/tipos.js";

export type RegistroProvedoresRecebimento = Record<ProvedorCobrancaId, ProvedorRecebimento>;
export const provedoresRecebimentoPadrao = (): RegistroProvedoresRecebimento => ({ demonstracao: provedorRecebimentoDemonstracao, asaas: provedorAsaas() });

type LinhaConta = {
  empresa_id: string;
  provedor: ProvedorCobrancaId;
  ambiente: "teste" | "producao";
  credenciais: string | null;
  final_chave: string | null;
  token_webhook: string;
  ativa: boolean;
  atualizado_em: Date;
};
type LinhaCobranca = {
  id: string;
  venda_id: string;
  provedor: string;
  id_externo: string | null;
  forma: "pix" | "boleto" | "link";
  valor_centavos: string | number;
  vencimento: string;
  status: CobrancaDto["status"];
  link: string | null;
  pix_copia_cola: string | null;
  pago_em: Date | null;
  criado_em: Date;
};

const dtoCobranca = (c: LinhaCobranca): CobrancaDto => ({
  id: c.id,
  vendaId: c.venda_id,
  provedor: c.provedor,
  forma: c.forma,
  valorCentavos: Number(c.valor_centavos),
  vencimento: typeof c.vencimento === "string" ? c.vencimento : new Date(c.vencimento).toISOString().slice(0, 10),
  status: c.status,
  link: c.link,
  pixCopiaCola: c.pix_copia_cola,
  pagoEm: c.pago_em ? new Date(c.pago_em).toISOString() : null,
  criadoEm: new Date(c.criado_em).toISOString(),
});

const q = async <T = Record<string, unknown>>(tx: Tx, texto: string, valores: unknown[] = []): Promise<T[]> =>
  (await tx.cliente.query(texto, valores)).rows as T[];

const ORIGEM_PROVEDOR = (empresaId: string): Origem => ({ empresaId, atorId: null, ip: null, dispositivo: "cobranca" });

/** Quem confere pagamento (escopo além do próprio) gera e cancela cobranças. */
const confere = (escopo: Escopo) => escopo !== "proprio";

export function criarServicoRecebimentos(s: Servicos, provedores: RegistroProvedoresRecebimento = provedoresRecebimentoPadrao()) {
  const { banco, config } = s;
  const vendas = criarServicoVendas(s);

  const credenciais = (c: LinhaConta): CredenciaisCobranca => ({
    chave: c.credenciais ? (JSON.parse(decifrar(config.crmChave, c.credenciais)) as { chave: string }).chave : null,
    ambiente: c.ambiente,
  });
  const dtoConta = (c: LinhaConta): ContaCobrancaDto => ({
    provedor: c.provedor,
    ambiente: c.ambiente,
    finalChave: c.final_chave,
    ativa: c.ativa,
    urlWebhook: `${config.appUrl.replace(/\/$/, "")}/api/webhooks/cobranca/${c.empresa_id}`,
    tokenWebhook: decifrar(config.crmChave, c.token_webhook),
    atualizadoEm: new Date(c.atualizado_em).toISOString(),
  });
  const lerConta = async (tx: Tx, empresaId: string) => (await q<LinhaConta>(tx, "SELECT * FROM conta_cobranca WHERE empresa_id = $1", [empresaId]))[0] ?? null;

  async function conta(ctx: ContextoEmpresa): Promise<ContaCobrancaDto | null> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await lerConta(tx, ctx.empresaId);
      return c ? dtoConta(c) : null;
    });
  }

  /** Salva a conta; com chave nova, testa no provedor antes de guardar (cifrada). */
  async function salvarConta(ctx: ContextoEmpresa, origem: Origem, d: { provedor: ProvedorCobrancaId; ambiente: "teste" | "producao"; chave?: string; ativa: boolean }) {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await lerConta(tx, ctx.empresaId);
      const mesmaConta = antes && antes.provedor === d.provedor;
      const chave = d.chave ? d.chave : mesmaConta ? credenciais(antes).chave : null;
      if (d.provedor !== "demonstracao" && !chave) throw invalido("Informe a chave de API do provedor.");
      if (d.chave) {
        try {
          await provedores[d.provedor].testar({ chave, ambiente: d.ambiente });
        } catch (e) {
          throw invalido(e instanceof ErroCobranca ? e.message : "Não foi possível testar a chave no provedor.");
        }
      }
      const [c] = await q<LinhaConta>(
        tx,
        `INSERT INTO conta_cobranca (empresa_id, provedor, ambiente, credenciais, final_chave, token_webhook, ativa, atualizado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (empresa_id) DO UPDATE SET provedor = $2, ambiente = $3, credenciais = $4, final_chave = $5, ativa = $7,
           atualizado_por = $8, atualizado_em = now()
         RETURNING *`,
        [
          ctx.empresaId,
          d.provedor,
          d.ambiente,
          chave ? cifrar(config.crmChave, JSON.stringify({ chave })) : null,
          chave ? chave.slice(-4) : null,
          antes?.token_webhook ?? cifrar(config.crmChave, novoToken()),
          d.ativa,
          ctx.usuarioId,
        ],
      );
      // Nunca a chave no histórico: só o que mudou de visível.
      await registrar(tx, origem, { acao: "cobranca.conta_salva", entidade: "conta_cobranca", entidadeId: ctx.empresaId, depois: { provedor: d.provedor, ambiente: d.ambiente, ativa: d.ativa, chaveNova: Boolean(d.chave) } });
      return dtoConta(c!);
    });
  }

  async function daVenda(ctx: ContextoEmpresa, escopo: Escopo, vendaId: string): Promise<{ itens: CobrancaDto[] }> {
    await vendas.obter(ctx, escopo, vendaId);
    return comEmpresa(banco, ctx.empresaId, async (tx) => ({
      itens: (await q<LinhaCobranca>(tx, "SELECT * FROM cobranca WHERE empresa_id = $1 AND venda_id = $2 ORDER BY criado_em DESC LIMIT 20", [ctx.empresaId, vendaId])).map(dtoCobranca),
    }));
  }

  async function gerar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, vendaId: string, d: { forma: "pix" | "boleto" | "link"; vencimento?: string; documento?: string }): Promise<CobrancaDto> {
    if (!confere(escopo)) throw semPermissao();
    const v = await vendas.obter(ctx, escopo, vendaId);
    if (v.status !== "pendente") throw conflito("Só venda aguardando pagamento recebe cobrança.");
    const hoje = hojeNoFuso(fusoDe(ctx));
    const vencimento = d.vencimento ?? hoje;
    if (vencimento < hoje) throw invalido("O vencimento não pode ser antes de hoje.");
    // 1) Reserva a cobrança (uma em aberto por venda), 2) chama o provedor fora da transação, 3) grava o resultado.
    const { c, cobrancaId, pagador } = await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await lerConta(tx, ctx.empresaId);
      if (!c || !c.ativa) throw invalido("Conecte a conta de cobrança da empresa (Vendas → Conta de cobrança) antes de gerar cobranças.");
      const [ct] = await q<{ nome: string; telefone: string | null; email: string | null }>(tx, "SELECT nome, telefone, email FROM contato WHERE id = $1 AND empresa_id = $2", [v.contatoId, ctx.empresaId]);
      try {
        const [n] = await q<{ id: string }>(
          tx,
          `INSERT INTO cobranca (empresa_id, venda_id, provedor, forma, valor_centavos, vencimento, criado_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [ctx.empresaId, vendaId, c.provedor, d.forma, v.valorCentavos, vencimento, ctx.usuarioId],
        );
        return { c, cobrancaId: n!.id, pagador: { nome: ct?.nome ?? "Cliente", documento: d.documento || null, telefone: ct?.telefone ?? null, email: ct?.email ?? null } };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflito("Esta venda já tem uma cobrança em aberto. Cancele a anterior para gerar outra.");
        throw e;
      }
    });
    let criada;
    try {
      criada = await provedores[c.provedor].criar(credenciais(c), {
        referencia: cobrancaId,
        forma: d.forma,
        valorCentavos: v.valorCentavos,
        vencimento,
        descricao: `${v.ofertaNome}`,
        pagador,
      });
    } catch (e) {
      await comEmpresa(banco, ctx.empresaId, (tx) => q(tx, "DELETE FROM cobranca WHERE id = $1 AND id_externo IS NULL", [cobrancaId]));
      if (e instanceof ErroCobranca) throw invalido(e.message);
      registrarLog({ level: "error", event: "cobranca.falha_provedor", empresaId: ctx.empresaId, provedor: c.provedor });
      throw new ErroApp(502, "ERRO_INTERNO", "O provedor de cobrança não respondeu. Tente de novo em instantes.");
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [l] = await q<LinhaCobranca>(tx, "UPDATE cobranca SET id_externo = $2, link = $3, pix_copia_cola = $4, atualizado_em = now() WHERE id = $1 RETURNING *", [
        cobrancaId,
        criada.idExterno,
        criada.link,
        criada.pixCopiaCola,
      ]);
      await registrar(tx, origem, { acao: "cobranca.gerada", entidade: "venda", entidadeId: vendaId, contatoId: v.contatoId, depois: { forma: d.forma, valorCentavos: v.valorCentavos, vencimento } });
      return dtoCobranca(l!);
    });
  }

  async function carregarDaEmpresa(ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const l = await comEmpresa(banco, ctx.empresaId, async (tx) => (await q<LinhaCobranca>(tx, "SELECT * FROM cobranca WHERE id = $1 AND empresa_id = $2", [id, ctx.empresaId]))[0]);
    if (!l) throw naoEncontrado("Cobrança");
    await vendas.obter(ctx, escopo, l.venda_id);
    return l;
  }

  async function cancelar(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string): Promise<CobrancaDto> {
    if (!confere(escopo)) throw semPermissao();
    const l = await carregarDaEmpresa(ctx, escopo, id);
    if (l.status !== "pendente" && l.status !== "vencida") throw conflito("Só cobrança em aberto pode ser cancelada.");
    const c = await comEmpresa(banco, ctx.empresaId, (tx) => lerConta(tx, ctx.empresaId));
    if (c && l.id_externo) {
      try {
        await provedores[l.provedor as ProvedorCobrancaId].cancelar(credenciais(c), l.id_externo);
      } catch (e) {
        throw invalido(e instanceof ErroCobranca ? e.message : "O provedor não cancelou a cobrança. Tente de novo.");
      }
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [n] = await q<LinhaCobranca>(tx, "UPDATE cobranca SET status = 'cancelada', atualizado_em = now() WHERE id = $1 AND status IN ('pendente','vencida') RETURNING *", [id]);
      await registrar(tx, origem, { acao: "cobranca.cancelada", entidade: "venda", entidadeId: l.venda_id });
      return dtoCobranca(n ?? l);
    });
  }

  /**
   * Aviso do provedor. O token confere com o da conta (comparação em tempo constante); o mesmo aviso duas vezes não
   * muda nada; "paga" confirma a venda aguardando pagamento (estoque, BPI e evento, como a confirmação manual).
   */
  async function receberAviso(empresaId: string, token: string | undefined, corpo: unknown): Promise<{ ok: true }> {
    return comEmpresa(banco, empresaId, async (tx) => {
      const c = await lerConta(tx, empresaId);
      if (!c || !token || !iguaisSeguro(token, decifrar(config.crmChave, c.token_webhook))) throw new ErroApp(403, "SEM_PERMISSAO", "Token do aviso de cobrança não confere.");
      const aviso = provedores[c.provedor].interpretar(corpo);
      if (!aviso) return { ok: true as const }; // evento que não nos interessa
      const [cob] = await q<LinhaCobranca>(tx, "SELECT * FROM cobranca WHERE empresa_id = $1 AND provedor = $2 AND id_externo = $3 FOR UPDATE", [empresaId, c.provedor, aviso.idExterno]);
      const novo = await q(
        tx,
        "INSERT INTO cobranca_aviso (empresa_id, provedor, id_evento, cobranca_id, tipo) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING 1",
        [empresaId, c.provedor, aviso.idEvento, cob?.id ?? null, aviso.status ?? "outro"],
      );
      if (!novo.length || !cob || !aviso.status || cob.status === aviso.status) return { ok: true as const };
      // Cancelada ou estornada não volta a "paga" por aviso atrasado de vencimento.
      if (aviso.status === "vencida" && cob.status !== "pendente") return { ok: true as const };
      await q(tx, "UPDATE cobranca SET status = $2, pago_em = CASE WHEN $2 = 'paga' THEN now() ELSE pago_em END, atualizado_em = now() WHERE id = $1", [cob.id, aviso.status]);
      const origem = ORIGEM_PROVEDOR(empresaId);
      await registrar(tx, origem, { acao: `cobranca.${aviso.status}`, entidade: "venda", entidadeId: cob.venda_id, depois: { cobrancaId: cob.id } });
      if (aviso.status === "paga") await confirmarPorPagamento(tx, origem, cob.venda_id);
      return { ok: true as const };
    });
  }

  /** Demonstração: simula o pagamento passando pelo mesmo caminho do aviso real. */
  async function simularPagamento(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<CobrancaDto> {
    if (!confere(escopo)) throw semPermissao();
    const l = await carregarDaEmpresa(ctx, escopo, id);
    if (l.provedor !== "demonstracao") throw invalido("Só cobrança de demonstração pode ter o pagamento simulado.");
    const token = await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const c = await lerConta(tx, ctx.empresaId);
      return c ? decifrar(config.crmChave, c.token_webhook) : undefined;
    });
    await receberAviso(ctx.empresaId, token, { id: `simulado_${l.id}`, idExterno: l.id_externo, status: "paga" });
    return (await daVenda(ctx, escopo, l.venda_id)).itens.find((x) => x.id === id)!;
  }

  return { conta, salvarConta, daVenda, gerar, cancelar, receberAviso, simularPagamento };
}
