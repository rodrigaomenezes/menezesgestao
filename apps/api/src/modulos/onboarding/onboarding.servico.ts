// Cadastro aberto (a empresa cria a própria conta) e assistente de primeiro acesso em 5 passos:
// empresa e marca → segmento (pré-carrega vocabulário e funil) → equipe → canais → contatos (ou exemplos).
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { SEGMENTOS, normalizarTelefone, type OnboardingDto } from "@mg/shared";
import { comEmpresa, comoSistema } from "../../infra/banco.js";
import { contato, empresa, etapa, funil, motivoPerda, oportunidade, usuario, vinculo } from "../../infra/esquema.js";
import { ErroApp, conflito, invalido } from "../../infra/erros.js";
import { gerarHashSenha } from "../../infra/seguranca/senha.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { auditar, registrar, type Origem } from "../auditoria/registro.js";
import { criarServicoCobranca } from "../cobranca/cobranca.servico.js";
import { criarEmpresa } from "../empresas/criar-empresa.js";
import { hojeNoFuso } from "../operacao/comum.js";

const CORES_ETAPA = { aberta: ["#5b6470", "#1f5fbf", "#7a3fbf", "#e07a1f", "#0f766e"], ganha: "#1e6b34", perdida: "#b3261e" };
const EXEMPLOS = [
  ["Ana Exemplo", "(11) 90000-0001", 0],
  ["Bruno Exemplo", "(11) 90000-0002", 1],
  ["Carla Exemplo", "(11) 90000-0003", 1],
  ["Diego Exemplo", "(11) 90000-0004", 2],
  ["Elisa Exemplo", "(11) 90000-0005", 0],
] as const;

export function criarServicoOnboarding(s: Servicos) {
  const { banco, config } = s;
  const cobranca = criarServicoCobranca(s);

  /** Cria usuário dono + empresa (plano completo em teste) e devolve o e-mail para o login. */
  async function cadastrar(origemBase: { ip: string | null; dispositivo: string | null }, d: { empresa: string; nome: string; email: string; senha: string }): Promise<void> {
    if (!config.cadastroAberto) {
      throw new ErroApp(403, "SEM_PERMISSAO", "O cadastro de novas empresas está fechado. Fale com quem administra a plataforma.");
    }
    const hash = await gerarHashSenha(d.senha);
    await comoSistema(banco, async (tx) => {
      const [existe] = await tx.db.select({ id: usuario.id }).from(usuario).where(sql`lower(${usuario.email}) = lower(${d.email})`);
      if (existe) throw conflito("Esse e-mail já tem conta. Entre com ele (ou use “Esqueci a senha”).");
      const [u] = await tx.db.insert(usuario).values({ email: d.email.trim().toLowerCase(), nome: d.nome, senhaHash: hash }).returning({ id: usuario.id });
      const origem = { atorId: u.id, ...origemBase };
      const criada = await criarEmpresa(tx, origem, { nome: d.empresa, plano: "completo", assistente: true });
      await tx.db.insert(vinculo).values({ empresaId: criada.empresaId, usuarioId: u.id, perfilId: criada.perfis.dono, unidadeId: criada.unidadeId, status: "ativo" });
      await cobranca.iniciarTeste(tx, criada.empresaId, "completo", hojeNoFuso("America/Sao_Paulo"));
      await auditar(tx, { ...origem, empresaId: criada.empresaId }, { acao: "empresa.cadastrada", entidade: "empresa", entidadeId: criada.empresaId, depois: { nome: d.empresa, email: d.email } });
    });
  }

  async function estado(ctx: ContextoEmpresa): Promise<OnboardingDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ onboarding: empresa.onboarding }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      const [ex] = await tx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(contato)
        .where(and(eq(contato.empresaId, ctx.empresaId), eq(contato.origem, "exemplo"), isNull(contato.arquivadoEm)));
      const o = e?.onboarding ?? {};
      return { passo: o.passo ?? 6, segmento: o.segmento ?? null, concluido: Boolean(o.concluidoEm) || (o.passo ?? 6) >= 6, temExemplos: ex.n > 0 };
    });
  }

  async function avancar(ctx: ContextoEmpresa, origem: Origem, passo: number): Promise<OnboardingDto> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ onboarding: empresa.onboarding }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      const atual = e?.onboarding ?? {};
      const novo = { ...atual, passo: Math.max(atual.passo ?? 1, passo), ...(passo >= 6 && !atual.concluidoEm ? { concluidoEm: new Date().toISOString() } : {}) };
      await tx.db.update(empresa).set({ onboarding: novo }).where(eq(empresa.id, ctx.empresaId));
      if (passo >= 6 && !atual.concluidoEm) await registrar(tx, origem, { acao: "empresa.assistente_concluido", entidade: "empresa", entidadeId: ctx.empresaId });
    });
    return estado(ctx);
  }

  /**
   * Aplica o pacote do segmento: vocabulário, funil típico e motivos de perda. O funil inicial genérico, se
   * ainda não tem nenhuma oportunidade, vai para o arquivo (nada é apagado).
   */
  async function aplicarSegmento(ctx: ContextoEmpresa, origem: Origem, segmentoId: string): Promise<OnboardingDto> {
    const seg = SEGMENTOS.find((x) => x.id === segmentoId);
    if (!seg) throw invalido("Segmento desconhecido.");
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [e] = await tx.db.select({ onboarding: empresa.onboarding, vocabulario: empresa.vocabulario }).from(empresa).where(eq(empresa.id, ctx.empresaId));
      if (e?.onboarding?.segmento) throw conflito("O segmento já foi aplicado. Ajuste funil e vocabulário em Configurar CRM e Empresa e marca.");
      const vazios = await tx.db
        .select({ id: funil.id })
        .from(funil)
        .where(and(eq(funil.empresaId, ctx.empresaId), isNull(funil.arquivadoEm), sql`NOT EXISTS (SELECT 1 FROM oportunidade o WHERE o.funil_id = ${funil.id})`));
      for (const f of vazios) await tx.db.update(funil).set({ arquivadoEm: new Date() }).where(eq(funil.id, f.id));
      const funilId = randomUUID();
      await tx.db.insert(funil).values({ id: funilId, empresaId: ctx.empresaId, nome: seg.funil.nome, ordem: 0 });
      let abertas = 0;
      await tx.db.insert(etapa).values(
        seg.funil.etapas.map((et, i) => ({
          empresaId: ctx.empresaId,
          funilId,
          nome: et.nome,
          cor: et.tipo === "aberta" ? CORES_ETAPA.aberta[abertas++ % CORES_ETAPA.aberta.length] : CORES_ETAPA[et.tipo],
          ordem: i * 10,
          probabilidade: et.probabilidade,
          tipo: et.tipo,
        })),
      );
      const existentes = new Set((await tx.db.select({ nome: motivoPerda.nome }).from(motivoPerda).where(eq(motivoPerda.empresaId, ctx.empresaId))).map((m) => m.nome.toLowerCase()));
      const novos = seg.motivosPerda.filter((m) => !existentes.has(m.toLowerCase()));
      if (novos.length) await tx.db.insert(motivoPerda).values(novos.map((nome, i) => ({ empresaId: ctx.empresaId, nome, ordem: 100 + i })));
      const vocabulario = { ...((e?.vocabulario ?? {}) as Record<string, string>), ...seg.vocabulario };
      await tx.db
        .update(empresa)
        .set({ vocabulario, onboarding: { ...(e?.onboarding ?? {}), segmento: seg.id, passo: Math.max(e?.onboarding?.passo ?? 1, 3) }, atualizadoEm: new Date() })
        .where(eq(empresa.id, ctx.empresaId));
      await registrar(tx, origem, { acao: "empresa.segmento_aplicado", entidade: "empresa", entidadeId: ctx.empresaId, depois: { segmento: seg.id, funil: seg.funil.nome, vocabulario } });
    });
    return estado(ctx);
  }

  /** Dados de exemplo (contatos com uma oportunidade cada), para ver o sistema funcionando antes de importar. */
  async function criarExemplos(ctx: ContextoEmpresa, origem: Origem): Promise<OnboardingDto> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [f] = await tx.db.select({ id: funil.id }).from(funil).where(and(eq(funil.empresaId, ctx.empresaId), isNull(funil.arquivadoEm))).orderBy(funil.ordem).limit(1);
      const etapas = f ? await tx.db.select({ id: etapa.id }).from(etapa).where(and(eq(etapa.funilId, f.id), eq(etapa.tipo, "aberta"), isNull(etapa.arquivadoEm))).orderBy(etapa.ordem) : [];
      for (const [nome, telefone, i] of EXEMPLOS) {
        const tel = normalizarTelefone(telefone);
        const [c] = await tx.db
          .insert(contato)
          .values({ empresaId: ctx.empresaId, nome, telefone: tel, origem: "exemplo", responsavelId: ctx.usuarioId, criadoPor: ctx.usuarioId })
          .onConflictDoNothing()
          .returning({ id: contato.id });
        if (!c) continue;
        await registrar(tx, origem, { acao: "contato.criado", entidade: "contato", entidadeId: c.id, contatoId: c.id, responsavelId: ctx.usuarioId, silencioso: true, dados: { exemplo: true, importacaoId: "exemplo" } });
        const et = etapas[Math.min(i, etapas.length - 1)];
        if (f && et) {
          await tx.db.insert(oportunidade).values({ empresaId: ctx.empresaId, contatoId: c.id, funilId: f.id, etapaId: et.id, titulo: `Exemplo — ${nome.split(" ")[0]}`, responsavelId: ctx.usuarioId, criadoPor: ctx.usuarioId });
        }
      }
    });
    return estado(ctx);
  }

  /** "Apagar" os exemplos com um clique: vão para a lixeira (nada some de verdade). */
  async function limparExemplos(ctx: ContextoEmpresa, origem: Origem): Promise<OnboardingDto> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const arquivados = await tx.db
        .update(contato)
        .set({ arquivadoEm: new Date(), atualizadoEm: new Date() })
        .where(and(eq(contato.empresaId, ctx.empresaId), eq(contato.origem, "exemplo"), isNull(contato.arquivadoEm)))
        .returning({ id: contato.id });
      if (arquivados.length) {
        await tx.db
          .update(oportunidade)
          .set({ arquivadoEm: new Date(), atualizadoEm: new Date() })
          .where(and(eq(oportunidade.empresaId, ctx.empresaId), sql`${oportunidade.contatoId} IN (${sql.join(arquivados.map((a) => sql`${a.id}::uuid`), sql`, `)})`));
      }
      await registrar(tx, origem, { acao: "empresa.exemplos_removidos", entidade: "empresa", entidadeId: ctx.empresaId, dados: { contatos: arquivados.length } });
    });
    return estado(ctx);
  }

  return { cadastrar, estado, avancar, aplicarSegmento, criarExemplos, limparExemplos };
}
