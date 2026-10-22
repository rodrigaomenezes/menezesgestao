// Painel da plataforma (fase 9): a equipe dona do produto vê todas as empresas (assinatura, uso, atividade, saúde) e
// estende teste, troca plano, suspende e reativa. Acesso só para PLATAFORMA_ADMINS; tudo auditado na empresa alvo.
import { ficaSomenteLeitura, limitesDoPlano, type EmpresaPlataformaDto, type Pagina } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comoSistema, type Tx } from "../../infra/banco.js";
import { conflito, invalido, naoEncontrado } from "../../infra/erros.js";
import { lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Contexto } from "../acesso/acesso.js";
import { auditar } from "../auditoria/registro.js";
import { criarServicoCobranca } from "../cobranca/cobranca.servico.js";
import { hojeNoFuso } from "../operacao/comum.js";

const DIA = 86_400_000;

type Linha = {
  id: string;
  nome: string;
  slug: string;
  plano: string;
  criado_em: Date;
  status: EmpresaPlataformaDto["status"];
  teste_ate: string | null;
  dias_atraso: number;
  pessoas: number;
  canais: number;
  armazenamento: string;
  ultima_atividade: Date | null;
};

/** Saúde em uma palavra, para a equipe da plataforma saber com quem falar primeiro. */
export function saudeDaEmpresa(l: Pick<Linha, "status" | "dias_atraso" | "pessoas" | "canais" | "armazenamento" | "plano" | "ultima_atividade">, agora = Date.now()) {
  const parada = l.ultima_atividade ? Math.floor((agora - new Date(l.ultima_atividade).getTime()) / DIA) : null;
  if (ficaSomenteLeitura(l.status, l.dias_atraso)) return { saude: "risco" as const, motivo: l.status === "suspensa" ? "Suspensa." : "Só para consulta por atraso." };
  if (parada === null || parada >= 30) return { saude: "risco" as const, motivo: parada === null ? "Nunca usou." : `Parada há ${parada} dias.` };
  if (l.dias_atraso > 0) return { saude: "atencao" as const, motivo: `Pagamento ${l.dias_atraso} dia(s) atrasado.` };
  if (parada >= 7) return { saude: "atencao" as const, motivo: `Parada há ${parada} dias.` };
  const limites = limitesDoPlano(l.plano);
  const uso = { usuarios: l.pessoas, canais: l.canais, armazenamento: Number(l.armazenamento) };
  const perto = limites ? (Object.keys(uso) as (keyof typeof uso)[]).find((r) => uso[r] >= limites[r] * 0.9) : undefined;
  if (perto) return { saude: "atencao" as const, motivo: "Perto do limite do plano (chance de subir de plano)." };
  return { saude: "boa" as const, motivo: null };
}

const dto = (l: Linha): EmpresaPlataformaDto => {
  const s = saudeDaEmpresa(l);
  return {
    id: l.id,
    nome: l.nome,
    slug: l.slug,
    plano: l.plano,
    status: l.status,
    testeAte: l.teste_ate,
    diasAtraso: Math.max(l.dias_atraso, 0),
    pessoas: l.pessoas,
    canais: l.canais,
    armazenamentoBytes: Number(l.armazenamento),
    ultimaAtividade: l.ultima_atividade ? new Date(l.ultima_atividade).toISOString() : null,
    criadaEm: new Date(l.criado_em).toISOString(),
    saude: s.saude,
    motivoSaude: s.motivo,
  };
};

const CONSULTA = `
  SELECT e.id, e.nome, e.slug, e.plano, e.criado_em,
         coalesce(a.status, 'ativa') AS status, to_char(a.teste_ate, 'YYYY-MM-DD') AS teste_ate,
         coalesce(((now() AT TIME ZONE e.fuso)::date
           - (SELECT min(f.vencimento) FROM fatura f WHERE f.assinatura_id = a.id AND f.status = 'vencida')), 0)::int AS dias_atraso,
         (SELECT count(*)::int FROM vinculo v WHERE v.empresa_id = e.id AND v.arquivado_em IS NULL) AS pessoas,
         (SELECT count(*)::int FROM canal c WHERE c.empresa_id = e.id AND c.arquivado_em IS NULL) AS canais,
         (SELECT coalesce(sum(x.tamanho), 0) FROM arquivo x WHERE x.empresa_id = e.id AND x.arquivado_em IS NULL) AS armazenamento,
         (SELECT max(ev.criado_em) FROM evento ev WHERE ev.empresa_id = e.id) AS ultima_atividade
    FROM empresa e LEFT JOIN assinatura a ON a.empresa_id = e.id`;

export function criarServicoPlataforma(s: Servicos) {
  const { banco } = s;
  const cobranca = criarServicoCobranca(s);

  async function listar(f: { busca?: string; cursor?: string; limite: number }): Promise<Pagina<EmpresaPlataformaDto>> {
    const cursor = lerCursor(f.cursor);
    const linhas = await comoSistema(banco, async (tx) => {
      const { rows } = await tx.cliente.query<Linha>(
        `${CONSULTA}
          WHERE e.arquivado_em IS NULL AND NOT e.demonstracao
            AND ($1::text IS NULL OR e.nome ILIKE '%' || $1 || '%' OR e.slug ILIKE '%' || $1 || '%')
            AND ($2::timestamptz IS NULL OR (e.criado_em, e.id) < ($2::timestamptz, $3::uuid))
          ORDER BY e.criado_em DESC, e.id DESC LIMIT $4`,
        [f.busca || null, cursor?.criadoEm ?? null, cursor?.id ?? null, f.limite + 1],
      );
      return rows;
    });
    return montarPagina(
      linhas.map((l) => ({ ...l, criadoEm: new Date(l.criado_em) })),
      f.limite,
      dto,
    );
  }

  async function uma(tx: Tx, id: string): Promise<EmpresaPlataformaDto> {
    const { rows } = await tx.cliente.query<Linha>(`${CONSULTA} WHERE e.id = $1`, [id]);
    if (!rows[0]) throw naoEncontrado("Empresa");
    return dto(rows[0]);
  }

  /** Ação da plataforma numa empresa: trava a assinatura, aplica e audita na própria empresa. */
  async function agir(ctx: Contexto, empresaId: string, acao: string, fn: (tx: Tx, a: { id: string; status: string } | null) => Promise<object>) {
    return comoSistema(banco, async (tx) => {
      await uma(tx, empresaId);
      const { rows } = await tx.cliente.query<{ id: string; status: string }>("SELECT id, status FROM assinatura WHERE empresa_id = $1 FOR UPDATE", [empresaId]);
      const depois = await fn(tx, rows[0] ?? null);
      await auditar(tx, { empresaId, atorId: ctx.usuarioId, ip: null, dispositivo: "plataforma" }, { acao, entidade: "empresa", entidadeId: empresaId, depois });
      return uma(tx, empresaId);
    });
  }

  const estenderTeste = (ctx: Contexto, empresaId: string, dias: number) =>
    agir(ctx, empresaId, "plataforma.teste_estendido", async (tx, a) => {
      if (!a || a.status !== "teste") throw conflito("Só dá para estender o teste de empresa em teste.");
      await tx.cliente.query(
        "UPDATE assinatura SET teste_ate = teste_ate + $2::int, proxima_cobranca = proxima_cobranca + $2::int, atualizado_em = now() WHERE id = $1",
        [a.id, dias],
      );
      return { dias };
    });

  const trocarPlano = (ctx: Contexto, empresaId: string, plano: "essencial" | "comercial" | "completo") =>
    agir(ctx, empresaId, "plataforma.plano_alterado", async (tx) => {
      await cobranca.aplicarPlano(tx, empresaId, plano, hojeNoFuso("America/Sao_Paulo"));
      return { plano };
    });

  const suspender = (ctx: Contexto, empresaId: string, motivo: string) =>
    agir(ctx, empresaId, "plataforma.suspensa", async (tx, a) => {
      if (!a) throw invalido("Empresa sem assinatura (sob medida): ajuste pela equipe comercial.");
      if (a.status === "suspensa") throw conflito("A empresa já está suspensa.");
      await tx.cliente.query("UPDATE assinatura SET status = 'suspensa', motivo_suspensao = $2, atualizado_em = now() WHERE id = $1", [a.id, motivo]);
      return { motivo };
    });

  /** Reativar volta para "atrasada" se ainda houver fatura vencida (o bloqueio por atraso continua valendo). */
  const reativar = (ctx: Contexto, empresaId: string) =>
    agir(ctx, empresaId, "plataforma.reativada", async (tx, a) => {
      if (!a || a.status !== "suspensa") throw conflito("A empresa não está suspensa.");
      await tx.cliente.query(
        `UPDATE assinatura SET motivo_suspensao = NULL, atualizado_em = now(),
           status = CASE WHEN EXISTS (SELECT 1 FROM fatura f WHERE f.assinatura_id = $1 AND f.status = 'vencida') THEN 'atrasada' ELSE 'ativa' END
         WHERE id = $1`,
        [a.id],
      );
      return {};
    });

  return { listar, estenderTeste, trocarPlano, suspender, reativar };
}
