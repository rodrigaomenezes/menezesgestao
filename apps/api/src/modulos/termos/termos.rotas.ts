// Documentos legais (públicos), aceite pela pessoa, canais de suporte e página de status.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { AceitarTermosEntrada, DocumentoLegalDto, IDS_DOCUMENTOS_LEGAIS, Ok, StatusPublicoDto, SuporteDto } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { exigirContexto } from "../acesso/acesso.js";
import { criarServicoTermos, documento } from "./termos.servico.js";

const publica = { acesso: { publica: true as const } };
const tags = ["Termos, suporte e status"];
/** Fila com trabalho vencido há mais que isto conta como instável. */
const ATRASO_FILA_MIN = 15;

export const rotasTermos =
  (s: Servicos): FastifyPluginAsyncZod =>
  async (app) => {
    const termos = criarServicoTermos(s.banco);

    app.get(
      "/api/publico/documentos/:id",
      { config: publica, schema: { tags, summary: "Termos de uso, política de privacidade ou contrato de dados (versão em vigor)", params: z.object({ id: z.enum(IDS_DOCUMENTOS_LEGAIS) }), response: { 200: DocumentoLegalDto } } },
      async (req) => documento(s.config, req.params.id),
    );
    app.post(
      "/api/termos/aceitar",
      { config: { acesso: { autenticada: true } }, schema: { tags, summary: "Aceitar a versão em vigor dos documentos", body: AceitarTermosEntrada, response: { 200: Ok } } },
      async (req) => termos.aceitar(exigirContexto(req), req.ip ?? null, req.body.documentos),
    );
    app.get(
      "/api/publico/suporte",
      { config: publica, schema: { tags, summary: "Canais de suporte e encarregado de dados", response: { 200: SuporteDto } } },
      async () => ({ ...s.config.suporte, encarregado: s.config.encarregadoDados }),
    );
    app.get(
      "/api/publico/status",
      { config: publica, schema: { tags, summary: "Situação do serviço (página de status)", response: { 200: StatusPublicoDto } } },
      async () => {
        const banco = await s.banco.pool.query("SELECT 1").then(
          () => true,
          () => false,
        );
        const fila = banco
          ? await s.banco.pool
              .query<{ n: number }>(`SELECT count(*)::int AS n FROM pgboss.job WHERE state = 'created' AND start_after < now() - make_interval(mins => $1)`, [ATRASO_FILA_MIN])
              .then(
                (r) => r.rows[0]!.n === 0,
                () => false,
              )
          : false;
        const avisos = s.avisos.status() !== "OFFLINE";
        const componentes = [
          { nome: "Aplicativo", ok: true },
          { nome: "Banco de dados", ok: banco },
          { nome: "Tarefas automáticas (mensagens, e-mails, rotinas)", ok: fila },
          { nome: "Avisos", ok: avisos },
        ];
        return { situacao: componentes.every((c) => c.ok) ? ("operando" as const) : ("instavel" as const), componentes, verificadoEm: new Date().toISOString() };
      },
    );
  };
