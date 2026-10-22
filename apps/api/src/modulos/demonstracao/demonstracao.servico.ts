// Tela /demonstracao: quem tem a chave do servidor (DEMONSTRACAO_CHAVE) gera empresas de exemplo por segmento e entra
// nelas com um clique. A chave vira um cookie httpOnly assinado (nada de segredo guardado no navegador). Só empresas
// marcadas como demonstração aceitam a entrada sem senha.
import { createHmac } from "node:crypto";
import { SEGMENTOS, type EmpresaDemonstracaoDto, type PainelDemonstracaoDto, type PapelDemonstracao } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comoSistema } from "../../infra/banco.js";
import { ErroApp, conflito, naoEncontrado } from "../../infra/erros.js";
import { registrarLog } from "../../infra/log.js";
import { iguaisSeguro } from "../../infra/seguranca/cripto.js";
import { ROTEIROS, type SegmentoDemonstracao } from "./roteiros.js";

export const FILA_DEMONSTRACAO = "demonstracao.gerar";
export const COOKIE_DEMONSTRACAO = "mg_demo";
export const VALIDADE_ACESSO_H = 12;

type Linha = {
  id: string;
  segmento: SegmentoDemonstracao;
  empresa_id: string | null;
  empresa_nome: string | null;
  status: EmpresaDemonstracaoDto["status"];
  erro: string | null;
  resumo: Record<string, number>;
  criado_em: Date;
};

const dto = (l: Linha): EmpresaDemonstracaoDto => ({
  id: l.id,
  segmento: l.segmento,
  empresaId: l.empresa_id,
  empresaNome: l.empresa_nome,
  status: l.status,
  erro: l.erro,
  resumo: l.resumo ?? {},
  criadoEm: new Date(l.criado_em).toISOString(),
});

export function criarServicoDemonstracao(s: Servicos, gerar: (segmento: SegmentoDemonstracao) => Promise<{ empresaId: string; resumo: Record<string, number> }>) {
  const { banco, config } = s;

  /** Sem a chave no servidor, a demonstração não existe (404, como qualquer rota desconhecida). */
  function chave(): string {
    if (!config.demonstracaoChave) throw naoEncontrado("Página");
    return config.demonstracaoChave;
  }

  /** Cookie = validade + HMAC(validade) com a própria chave: trocar a chave no servidor derruba os acessos. */
  function emitirAcesso(digitada: string): string {
    if (!iguaisSeguro(digitada.trim(), chave())) throw new ErroApp(403, "SEM_PERMISSAO", "Chave da demonstração incorreta.");
    const ate = String(Date.now() + VALIDADE_ACESSO_H * 3_600_000);
    return `${ate}.${createHmac("sha256", chave()).update(ate).digest("hex")}`;
  }

  function exigirAcesso(cookie: string | undefined): void {
    const k = chave();
    const [ate, assinatura] = (cookie ?? "").split(".");
    const valido = ate && assinatura && Number(ate) > Date.now() && iguaisSeguro(assinatura, createHmac("sha256", k).update(ate).digest("hex"));
    if (!valido) throw new ErroApp(401, "NAO_AUTENTICADO", "Digite a chave da demonstração para continuar.");
  }

  async function painel(): Promise<PainelDemonstracaoDto> {
    const linhas = await comoSistema(banco, async (tx) => {
      // Pedido parado há mais de 10 minutos (servidor reiniciou no meio): vira falha, para poder pedir de novo.
      await tx.cliente.query("UPDATE demonstracao SET status = 'falhou', erro = 'A geração não terminou. Tente de novo.' WHERE status = 'gerando' AND criado_em < now() - interval '10 minutes'");
      const { rows } = await tx.cliente.query<Linha>(
        `SELECT d.*, e.nome AS empresa_nome FROM demonstracao d LEFT JOIN empresa e ON e.id = d.empresa_id
          WHERE d.status <> 'arquivada' ORDER BY d.criado_em DESC LIMIT 50`,
      );
      return rows;
    });
    return {
      segmentos: (Object.keys(ROTEIROS) as SegmentoDemonstracao[]).map((id) => {
        const seg = SEGMENTOS.find((x) => x.id === id)!;
        return { id, nome: seg.nome, descricao: seg.descricao, empresa: ROTEIROS[id].empresa };
      }),
      empresas: linhas.map(dto),
    };
  }

  /** Pede a geração (fila de jobs). Um pedido por segmento de cada vez. */
  async function pedir(segmento: SegmentoDemonstracao): Promise<EmpresaDemonstracaoDto> {
    return comoSistema(banco, async (tx) => {
      try {
        const { rows } = await tx.cliente.query<Linha>("INSERT INTO demonstracao (segmento) VALUES ($1) RETURNING *, NULL::text AS empresa_nome", [segmento]);
        await s.jobs.enfileirar(tx, FILA_DEMONSTRACAO, { id: rows[0]!.id, segmento });
        return dto(rows[0]!);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflito("Este exemplo já está sendo gerado. Aguarde terminar.");
        throw e;
      }
    });
  }

  /** Trabalho da fila: reserva o pedido (job repetido não gera outra empresa), gera e registra o resultado. */
  async function processar(id: string, segmento: SegmentoDemonstracao): Promise<void> {
    const { rowCount } = await banco.pool.query("UPDATE demonstracao SET iniciado_em = now() WHERE id = $1 AND status = 'gerando' AND iniciado_em IS NULL", [id]);
    if (!rowCount) return;
    try {
      const { empresaId, resumo } = await gerar(segmento);
      await banco.pool.query("UPDATE demonstracao SET status = 'pronta', empresa_id = $2, resumo = $3, concluido_em = now() WHERE id = $1", [id, empresaId, resumo]);
    } catch (e) {
      registrarLog({ level: "error", event: "demonstracao.falhou", segmento, erro: e instanceof Error ? e.message : String(e) });
      await banco.pool.query("UPDATE demonstracao SET status = 'falhou', erro = $2, concluido_em = now() WHERE id = $1", [id, "Não foi possível gerar o exemplo. Tente de novo."]);
    }
  }

  async function arquivar(id: string): Promise<void> {
    await comoSistema(banco, async (tx) => {
      const { rows } = await tx.cliente.query<{ empresa_id: string | null }>("UPDATE demonstracao SET status = 'arquivada' WHERE id = $1 AND status <> 'gerando' RETURNING empresa_id", [id]);
      if (!rows[0]) throw naoEncontrado("Exemplo");
      // Nada some: a empresa de exemplo vai para o arquivo (fora da lista e sem login).
      if (rows[0].empresa_id) await tx.cliente.query("UPDATE empresa SET arquivado_em = now() WHERE id = $1 AND demonstracao", [rows[0].empresa_id]);
    });
  }

  /** Pessoa da empresa de exemplo com o perfil-base pedido (a entrada sem senha só existe aqui). */
  async function pessoaPara(id: string, papel: PapelDemonstracao): Promise<{ usuarioId: string; empresaId: string }> {
    const { rows } = await banco.pool.query<{ usuario_id: string; empresa_id: string }>(
      `SELECT v.usuario_id, e.id AS empresa_id
         FROM demonstracao d
         JOIN empresa e ON e.id = d.empresa_id AND e.demonstracao AND e.arquivado_em IS NULL
         JOIN vinculo v ON v.empresa_id = e.id AND v.status = 'ativo' AND v.arquivado_em IS NULL
         JOIN perfil p ON p.id = v.perfil_id AND p.base = $2
        WHERE d.id = $1 AND d.status = 'pronta'
        ORDER BY v.criado_em LIMIT 1`,
      [id, papel],
    );
    if (!rows[0]) throw naoEncontrado("Pessoa de exemplo");
    return { usuarioId: rows[0].usuario_id, empresaId: rows[0].empresa_id };
  }

  return { emitirAcesso, exigirAcesso, painel, pedir, processar, arquivar, pessoaPara };
}
