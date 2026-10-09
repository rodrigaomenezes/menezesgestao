// Rotas da fase 6: marca e domínio, vocabulário, cadastro aberto e assistente, automações e cobrança.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AssinaturaDto,
  AtualizarRegraAutomacaoEntrada,
  AvancarEntrada,
  CadastroEntrada,
  ConfigMarcaDto,
  DominioEntrada,
  Id,
  MarcaEntrada,
  MarcaPublicaDto,
  Ok,
  OnboardingDto,
  ParamId,
  RegraAutomacaoDto,
  RegraAutomacaoEntrada,
  SegmentoEntrada,
  TrocarPlanoEntrada,
  VocabularioEntrada,
} from "@mg/shared";
import type { Servicos } from "../../app.js";
import { invalido } from "../../infra/erros.js";
import { dispositivoDe, exigirEmpresa, origemDe } from "../acesso/acesso.js";
import type { ProvedorArquivos } from "../arquivos/armazenamento.js";
import { criarServicoAutomacoes } from "../automacoes/automacoes.servico.js";
import { criarServicoCobranca } from "../cobranca/cobranca.servico.js";
import type { ServicoEnvio } from "../conversas/envio.servico.js";
import { criarServicoOnboarding } from "../onboarding/onboarding.servico.js";
import { LIMITE_LOGO, TIPOS_LOGO, criarServicoMarca } from "./marca.servico.js";

const config = (acao: "ver" | "editar" | "administrar") => ({ acesso: { modulo: "configuracoes" as const, acao } });
const publica = { acesso: { publica: true as const } };
const ParamTipoLogo = z.object({ tipo: z.enum(TIPOS_LOGO) });
const ParamSlug = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) });

export const rotasWhiteLabel =
  (s: Servicos, arquivos: ProvedorArquivos, envio: ServicoEnvio | null): FastifyPluginAsyncZod =>
  async (app) => {
    const marca = criarServicoMarca(s, arquivos);
    const onboarding = criarServicoOnboarding(s);
    const automacoes = criarServicoAutomacoes(s, envio);
    const cobranca = criarServicoCobranca(s);

    // Marca --------------------------------------------------------------------------------------------
    {
      const tags = ["Marca e domínio"];
      app.get(
        "/api/marca",
        { config: publica, schema: { tags, summary: "Marca da empresa ativa ou do endereço (subdomínio/domínio próprio)", response: { 200: MarcaPublicaDto } } },
        async (req) => marca.publica(req.ctx, req.headers.host),
      );
      app.get(
        "/api/publico/logo/:slug/:tipo",
        { config: publica, schema: { tags, summary: "Logo da empresa", params: ParamSlug.merge(ParamTipoLogo) } },
        async (req, reply) => {
          const l = await marca.logo(req.params.slug, req.params.tipo);
          reply.header("cache-control", "public, max-age=86400").header("x-content-type-options", "nosniff").type(l.tipoMime);
          return reply.send(l.conteudo);
        },
      );
      app.get(
        "/api/publico/icone/:slug",
        { config: publica, schema: { tags, summary: "Ícone do app gerado da marca (SVG)", params: ParamSlug } },
        async (req, reply) => {
          reply.header("cache-control", "public, max-age=3600").type("image/svg+xml");
          return reply.send(await marca.icone(req.params.slug));
        },
      );
      app.get("/api/empresa/marca", { config: config("ver"), schema: { tags, summary: "Marca, domínio e vocabulário", response: { 200: ConfigMarcaDto } } }, async (req) =>
        marca.configuracao(exigirEmpresa(req)),
      );
      app.put(
        "/api/empresa/marca",
        { config: config("editar"), schema: { tags, summary: "Nome do produto e cores (contraste conferido)", body: MarcaEntrada, response: { 200: ConfigMarcaDto } } },
        async (req) => marca.salvarCores(exigirEmpresa(req), origemDe(req), req.body),
      );
      app.post(
        "/api/empresa/marca/logo/:tipo",
        { config: config("editar"), schema: { tags, summary: "Enviar logo (PNG, JPG ou WebP, até 512 KB)", consumes: ["multipart/form-data"], params: ParamTipoLogo, response: { 200: ConfigMarcaDto } } },
        async (req) => {
          if (!req.isMultipart()) throw invalido("Envie o logo como arquivo (campo \"arquivo\").");
          const parte = await req.file({ limits: { fileSize: LIMITE_LOGO, files: 1 } });
          if (!parte) throw invalido("Nenhuma imagem recebida.");
          let conteudo: Buffer;
          try {
            conteudo = await parte.toBuffer();
          } catch {
            throw invalido("O logo pode ter no máximo 512 KB.");
          }
          return marca.salvarLogo(exigirEmpresa(req), origemDe(req), req.params.tipo, { nome: parte.filename, mime: parte.mimetype, conteudo });
        },
      );
      app.post(
        "/api/empresa/marca/logo/:tipo/remover",
        { config: config("editar"), schema: { tags, summary: "Tirar o logo", params: ParamTipoLogo, response: { 200: ConfigMarcaDto } } },
        async (req) => marca.removerLogo(exigirEmpresa(req), origemDe(req), req.params.tipo),
      );
      app.put(
        "/api/empresa/dominio",
        { config: config("administrar"), schema: { tags, summary: "Domínio próprio (ou nenhum)", body: DominioEntrada, response: { 200: ConfigMarcaDto } } },
        async (req) => marca.salvarDominio(exigirEmpresa(req), origemDe(req), req.body.dominio),
      );
      app.put(
        "/api/empresa/vocabulario",
        { config: config("editar"), schema: { tags, summary: "Termos da empresa (aluno, curso, turma…)", body: VocabularioEntrada, response: { 200: ConfigMarcaDto } } },
        async (req) => marca.salvarVocabulario(exigirEmpresa(req), origemDe(req), req.body),
      );
    }

    // Cadastro aberto e assistente ----------------------------------------------------------------------
    {
      const tags = ["Primeiro acesso"];
      app.post(
        "/api/cadastro",
        {
          config: { ...publica, rateLimit: { max: Math.max(3, Math.floor(s.config.limiteLoginMinuto / 2)), timeWindow: "1 minute" } },
          schema: { tags, summary: "Criar a conta da empresa (cadastro aberto)", body: CadastroEntrada, response: { 201: Ok } },
        },
        async (req, reply) => {
          await onboarding.cadastrar({ ip: req.ip ?? null, dispositivo: dispositivoDe(req) }, req.body);
          return reply.status(201).send({ ok: true as const });
        },
      );
      app.get("/api/primeiros-passos", { config: config("ver"), schema: { tags, summary: "Andamento do assistente", response: { 200: OnboardingDto } } }, async (req) =>
        onboarding.estado(exigirEmpresa(req)),
      );
      app.post(
        "/api/primeiros-passos/avancar",
        { config: config("editar"), schema: { tags, summary: "Marcar passo concluído (6 = terminou)", body: AvancarEntrada, response: { 200: OnboardingDto } } },
        async (req) => onboarding.avancar(exigirEmpresa(req), origemDe(req), req.body.passo),
      );
      app.post(
        "/api/primeiros-passos/segmento",
        { config: config("administrar"), schema: { tags, summary: "Aplicar o pacote do segmento (vocabulário, funil, motivos)", body: SegmentoEntrada, response: { 200: OnboardingDto } } },
        async (req) => onboarding.aplicarSegmento(exigirEmpresa(req), origemDe(req), req.body.segmento),
      );
      app.post(
        "/api/primeiros-passos/exemplos",
        { config: config("administrar"), schema: { tags, summary: "Criar dados de exemplo", response: { 200: OnboardingDto } } },
        async (req) => onboarding.criarExemplos(exigirEmpresa(req), origemDe(req)),
      );
      app.post(
        "/api/primeiros-passos/exemplos/limpar",
        { config: config("administrar"), schema: { tags, summary: "Mandar os dados de exemplo para a lixeira", response: { 200: OnboardingDto } } },
        async (req) => onboarding.limparExemplos(exigirEmpresa(req), origemDe(req)),
      );
    }

    // Automações ---------------------------------------------------------------------------------------
    {
      const tags = ["Automações"];
      app.get(
        "/api/automacoes-regras",
        { config: config("ver"), schema: { tags, summary: "Regras quando/se/então", response: { 200: z.object({ itens: z.array(RegraAutomacaoDto) }) } } },
        async (req) => automacoes.listar(exigirEmpresa(req)),
      );
      app.post(
        "/api/automacoes-regras",
        { config: config("editar"), schema: { tags, summary: "Criar regra", body: RegraAutomacaoEntrada, response: { 201: z.object({ id: Id }) } } },
        async (req, reply) => reply.status(201).send(await automacoes.criar(exigirEmpresa(req), origemDe(req), req.body)),
      );
      app.patch(
        "/api/automacoes-regras/:id",
        { config: config("editar"), schema: { tags, summary: "Ligar, desligar ou arquivar regra", params: ParamId, body: AtualizarRegraAutomacaoEntrada, response: { 200: Ok } } },
        async (req) => automacoes.atualizar(exigirEmpresa(req), origemDe(req), req.params.id, req.body),
      );
    }

    // Plano e cobrança ---------------------------------------------------------------------------------
    {
      const tags = ["Plano e cobrança"];
      app.get("/api/assinatura", { config: config("ver"), schema: { tags, summary: "Plano, situação e faturas", response: { 200: AssinaturaDto } } }, async (req) =>
        cobranca.obter(exigirEmpresa(req)),
      );
      app.put(
        "/api/assinatura/plano",
        { config: config("administrar"), schema: { tags, summary: "Trocar de plano (desligar módulo esconde, não apaga)", body: TrocarPlanoEntrada, response: { 200: AssinaturaDto } } },
        async (req) => cobranca.trocarPlano(exigirEmpresa(req), origemDe(req), req.body.plano),
      );
      app.post(
        "/api/faturas/:id/pagar-simulado",
        { config: config("administrar"), schema: { tags, summary: "Pagar fatura (só no provedor de demonstração)", params: ParamId, response: { 200: AssinaturaDto } } },
        async (req) => cobranca.pagarDemonstracao(exigirEmpresa(req), origemDe(req), req.params.id),
      );
    }
  };
