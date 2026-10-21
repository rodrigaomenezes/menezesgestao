// Rotas da cobrança dos clientes (fase 8.6): conta de cobrança da empresa, cobranças da venda e o aviso do provedor.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { CobrancaDto, CobrancaEntrada, ContaCobrancaDto, ContaCobrancaEntrada, Ok, ParamId, type Acao } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirEmpresa, exigirEscopo, origemDe } from "../acesso/acesso.js";
import { criarServicoRecebimentos, type RegistroProvedoresRecebimento } from "./recebimentos.servico.js";

const acesso = (acao: Acao) => ({ acesso: { modulo: "vendas" as const, acao } });
const tags = ["Receita — cobrança dos clientes"];

export const rotasRecebimentos =
  (s: Servicos, provedores?: RegistroProvedoresRecebimento): FastifyPluginAsyncZod =>
  async (app) => {
    const r = criarServicoRecebimentos(s, provedores);

    app.get(
      "/api/cobranca/conta",
      { config: acesso("administrar"), schema: { tags, summary: "Conta de cobrança da empresa (a chave nunca volta)", response: { 200: z.object({ conta: ContaCobrancaDto.nullable() }) } } },
      async (req) => ({ conta: await r.conta(exigirEmpresa(req)) }),
    );
    app.put(
      "/api/cobranca/conta",
      { config: acesso("administrar"), schema: { tags, summary: "Conectar o provedor de cobrança (testa a chave e guarda cifrada)", body: ContaCobrancaEntrada, response: { 200: ContaCobrancaDto } } },
      async (req) => r.salvarConta(exigirEmpresa(req), origemDe(req), req.body),
    );
    app.get(
      "/api/vendas/:id/cobrancas",
      { config: acesso("ver"), schema: { tags, summary: "Cobranças da venda", params: ParamId, response: { 200: z.object({ itens: z.array(CobrancaDto) }) } } },
      async (req) => r.daVenda(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );
    app.post(
      "/api/vendas/:id/cobrancas",
      { config: acesso("editar"), schema: { tags, summary: "Gerar cobrança (Pix, boleto ou link) no provedor da empresa", params: ParamId, body: CobrancaEntrada, response: { 201: CobrancaDto } } },
      async (req, reply) => reply.status(201).send(await r.gerar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body)),
    );
    app.post(
      "/api/cobrancas/:id/cancelar",
      { config: acesso("editar"), schema: { tags, summary: "Cancelar cobrança em aberto", params: ParamId, response: { 200: CobrancaDto } } },
      async (req) => r.cancelar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id),
    );
    app.post(
      "/api/cobrancas/:id/simular-pagamento",
      { config: acesso("editar"), schema: { tags, summary: "Demonstração: simular o pagamento (mesmo caminho do aviso real)", params: ParamId, response: { 200: CobrancaDto } } },
      async (req) => r.simularPagamento(exigirEmpresa(req), exigirEscopo(req), req.params.id),
    );
    app.post(
      "/api/webhooks/cobranca/:empresaId",
      {
        config: { acesso: { webhook: true }, rateLimit: false },
        schema: { tags: ["Webhooks"], summary: "Aviso do provedor de cobrança (token no cabeçalho)", params: z.object({ empresaId: z.uuid() }), response: { 200: Ok } },
      },
      async (req) => {
        const h = req.headers["asaas-access-token"] ?? req.headers["x-token-cobranca"];
        return r.receberAviso(req.params.empresaId, typeof h === "string" ? h : undefined, req.body);
      },
    );
  };
