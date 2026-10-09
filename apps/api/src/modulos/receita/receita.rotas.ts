// Rotas da receita (fase 5): ofertas e entregas (módulo "servicos"), vendas e comissões (módulo "vendas").
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AtualizarEntregaEntrada,
  AtualizarOfertaEntrada,
  AtualizarRegraComissaoEntrada,
  AtualizarVendaEntrada,
  ComissoesDoMesDto,
  EntregaDto,
  EntregaEntrada,
  FecharComissaoEntrada,
  FiltroComissoes,
  FiltroEntregas,
  FiltroOfertas,
  FiltroVendas,
  Id,
  OfertaDto,
  OfertaEntrada,
  Ok,
  Paginacao,
  ParamId,
  ParticipanteDto,
  ParticipanteEntrada,
  ReabrirComissaoEntrada,
  RegraComissaoDto,
  RegraComissaoEntrada,
  VendaDto,
  VendaEntrada,
  moduloAtivo,
  pagina,
  temPermissao,
  type Acao,
  type Modulo,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { semPermissao } from "../../infra/erros.js";
import { exigirEmpresa, exigirEscopo, origemDe, type ContextoEmpresa } from "../acesso/acesso.js";
import { criarServicoOfertas } from "./ofertas.servico.js";
import { criarServicoVendas } from "./vendas.servico.js";

const acesso = (modulo: Modulo, acao: Acao) => ({ acesso: { modulo, acao } });

/** O catálogo é lido por quem vende e por quem entrega. */
function exigirCatalogo(ctx: ContextoEmpresa) {
  const pode = (m: Modulo) => moduloAtivo(m, ctx.modulos) && Boolean(temPermissao(ctx.permissoes, m, "ver"));
  if (!pode("vendas") && !pode("servicos")) throw semPermissao();
}

export const rotasReceita =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const ofertas = criarServicoOfertas(s);
    const vendas = criarServicoVendas(s);

    {
      const tags = ["Receita — ofertas e entregas"];
      app.get(
        "/api/ofertas",
        { config: { acesso: { autenticada: true } }, schema: { tags, summary: "Catálogo de ofertas (quem vende ou entrega)", querystring: FiltroOfertas, response: { 200: pagina(OfertaDto) } } },
        async (req) => {
          const ctx = exigirEmpresa(req);
          exigirCatalogo(ctx);
          return ofertas.listarOfertas(ctx, req.query);
        },
      );
      app.post(
        "/api/ofertas",
        { config: acesso("servicos", "criar"), schema: { tags, summary: "Criar oferta", body: OfertaEntrada, response: { 201: OfertaDto } } },
        async (req, reply) => reply.status(201).send(await ofertas.salvarOferta(exigirEmpresa(req), origemDe(req), null, req.body)),
      );
      app.patch(
        "/api/ofertas/:id",
        { config: acesso("servicos", "editar"), schema: { tags, summary: "Alterar, arquivar ou restaurar oferta", params: ParamId, body: AtualizarOfertaEntrada, response: { 200: OfertaDto } } },
        async (req) => ofertas.salvarOferta(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
      );
      app.get(
        "/api/entregas",
        { config: acesso("servicos", "ver"), schema: { tags, summary: "Entregas (turmas, agendas, projetos)", querystring: FiltroEntregas, response: { 200: pagina(EntregaDto) } } },
        async (req) => ofertas.listarEntregas(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.get(
        "/api/entregas/:id",
        { config: acesso("servicos", "ver"), schema: { tags, summary: "Ver entrega", params: ParamId, response: { 200: EntregaDto } } },
        async (req) => ofertas.obterEntrega(exigirEmpresa(req), exigirEscopo(req), req.params.id),
      );
      app.post(
        "/api/entregas",
        { config: acesso("servicos", "criar"), schema: { tags, summary: "Criar entrega", body: EntregaEntrada, response: { 201: EntregaDto } } },
        async (req, reply) => reply.status(201).send(await ofertas.salvarEntrega(exigirEmpresa(req), exigirEscopo(req), origemDe(req), null, req.body)),
      );
      app.patch(
        "/api/entregas/:id",
        { config: acesso("servicos", "editar"), schema: { tags, summary: "Alterar, encerrar ou arquivar entrega", params: ParamId, body: AtualizarEntregaEntrada, response: { 200: EntregaDto } } },
        async (req) => ofertas.salvarEntrega(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
      app.get(
        "/api/entregas/:id/participantes",
        { config: acesso("servicos", "ver"), schema: { tags, summary: "Participantes da entrega", params: ParamId, querystring: Paginacao, response: { 200: pagina(ParticipanteDto) } } },
        async (req) => ofertas.participantes(exigirEmpresa(req), exigirEscopo(req), req.params.id, req.query),
      );
      app.post(
        "/api/entregas/:id/participantes",
        { config: acesso("servicos", "editar"), schema: { tags, summary: "Incluir contato (ocupa vaga)", params: ParamId, body: ParticipanteEntrada, response: { 201: ParticipanteDto } } },
        async (req, reply) => reply.status(201).send(await ofertas.incluir(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.contatoId)),
      );
      app.post(
        "/api/entregas/:id/participantes/:participanteId/retirar",
        { config: acesso("servicos", "editar"), schema: { tags, summary: "Retirar participante (libera a vaga)", params: z.object({ id: Id, participanteId: Id }), response: { 200: Ok } } },
        async (req) => {
          await ofertas.retirar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.params.participanteId);
          return { ok: true as const };
        },
      );
    }

    {
      const tags = ["Receita — vendas e comissões"];
      app.get(
        "/api/vendas",
        { config: acesso("vendas", "ver"), schema: { tags, summary: "Vendas", querystring: FiltroVendas, response: { 200: pagina(VendaDto) } } },
        async (req) => vendas.listar(exigirEmpresa(req), exigirEscopo(req), req.query),
      );
      app.post(
        "/api/vendas",
        { config: acesso("vendas", "criar"), schema: { tags, summary: "Registrar venda (contato × oferta × vendedor)", body: VendaEntrada, response: { 201: VendaDto } } },
        async (req, reply) => reply.status(201).send(await vendas.criar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/vendas/:id",
        { config: acesso("vendas", "editar"), schema: { tags, summary: "Alterar, confirmar ou cancelar venda", params: ParamId, body: AtualizarVendaEntrada, response: { 200: VendaDto } } },
        async (req) => vendas.atualizar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
      app.get(
        "/api/comissoes/regras",
        { config: acesso("vendas", "ver"), schema: { tags, summary: "Regras de comissão ativas", response: { 200: z.object({ itens: z.array(RegraComissaoDto) }) } } },
        async (req) => vendas.regras(exigirEmpresa(req)),
      );
      app.post(
        "/api/comissoes/regras",
        { config: acesso("vendas", "editar"), schema: { tags, summary: "Criar regra (financeiro/administrador)", body: RegraComissaoEntrada, response: { 201: RegraComissaoDto } } },
        async (req, reply) => reply.status(201).send(await vendas.criarRegra(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/comissoes/regras/:id",
        { config: acesso("vendas", "editar"), schema: { tags, summary: "Renomear ou arquivar regra", params: ParamId, body: AtualizarRegraComissaoEntrada, response: { 200: Ok } } },
        async (req) => vendas.atualizarRegra(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body),
      );
      app.get(
        "/api/comissoes",
        { config: acesso("vendas", "ver"), schema: { tags, summary: "Comissões do mês (prévia ou fechadas)", querystring: FiltroComissoes, response: { 200: ComissoesDoMesDto } } },
        async (req) => vendas.doMes(exigirEmpresa(req), exigirEscopo(req), req.query.mes),
      );
      app.post(
        "/api/comissoes/fechamentos",
        { config: acesso("vendas", "editar"), schema: { tags, summary: "Fechar o mês (grava o retrato e trava as vendas)", body: FecharComissaoEntrada, response: { 201: ComissoesDoMesDto } } },
        async (req, reply) => reply.status(201).send(await vendas.fechar(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.body.mes)),
      );
      app.post(
        "/api/comissoes/fechamentos/:id/reabrir",
        { config: acesso("vendas", "editar"), schema: { tags, summary: "Reabrir mês (com motivo)", params: ParamId, body: ReabrirComissaoEntrada, response: { 200: Ok } } },
        async (req) => vendas.reabrir(exigirEmpresa(req), exigirEscopo(req), origemDe(req), req.params.id, req.body.motivo),
      );
    }
  };
