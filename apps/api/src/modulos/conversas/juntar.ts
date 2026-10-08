// Junção de conversas duplicadas antigas (no mesmo canal): mesmo contato, ids do provedor em comum, ou o mesmo
// telefone com e sem o nono dígito. A mais antiga fica; as outras passam as mensagens para ela e apontam para
// ela (mesclada_em_id) — nada é apagado. Roda todo dia (job) e sob demanda pelo administrador.
import { eq, sql } from "drizzle-orm";
import { comEmpresa, comoSistema, type Banco } from "../../infra/banco.js";
import { conversa, empresa, mensagem } from "../../infra/esquema.js";
import { registrar } from "../auditoria/registro.js";

/** Telefone sem o nono dígito (forma de comparação: as duas variantes viram a mesma). */
const SEM_NONO = sql.raw(`'^\\+55(\\d{2})9(\\d{8})$'`);

export async function juntarDuplicadas(banco: Banco, empresaId: string, atorId: string | null = null): Promise<number> {
  return comEmpresa(banco, empresaId, async (tx) => {
    const { rows: pares } = await tx.db.execute<{ a: string; b: string }>(sql`
      SELECT a.id AS a, b.id AS b
        FROM conversa a
        JOIN conversa b ON b.canal_id = a.canal_id AND (a.criado_em, a.id) < (b.criado_em, b.id)
       WHERE a.empresa_id = ${empresaId} AND b.empresa_id = ${empresaId}
         AND a.mesclada_em_id IS NULL AND b.mesclada_em_id IS NULL
         AND (a.contato_id = b.contato_id
              OR a.ids_externos && b.ids_externos
              OR regexp_replace(a.telefone, ${SEM_NONO}, '+55\\1\\2') = regexp_replace(b.telefone, ${SEM_NONO}, '+55\\1\\2'))`);
    if (!pares.length) return 0;

    // Grupos ligados (A~B e B~C juntam os três); a mais antiga de cada grupo fica.
    const pai = new Map<string, string>();
    const raiz = (x: string): string => {
      const p = pai.get(x) ?? x;
      if (p === x) return x;
      const r = raiz(p);
      pai.set(x, r);
      return r;
    };
    const ordem = new Map<string, Date>();
    const todos = [...new Set(pares.flatMap((p) => [p.a, p.b]))];
    for (const c of await tx.db.select({ id: conversa.id, criadoEm: conversa.criadoEm }).from(conversa).where(sql`${conversa.id} IN (${sql.join(todos.map((i) => sql`${i}`), sql`, `)})`)) {
      ordem.set(c.id, c.criadoEm);
    }
    const maisAntiga = (x: string, y: string) => {
      const dx = ordem.get(x)?.getTime() ?? 0;
      const dy = ordem.get(y)?.getTime() ?? 0;
      return dx < dy || (dx === dy && x < y) ? x : y;
    };
    for (const { a, b } of pares) {
      const ra = raiz(a);
      const rb = raiz(b);
      if (ra === rb) continue;
      const fica = maisAntiga(ra, rb);
      pai.set(fica === ra ? rb : ra, fica);
    }

    let juntadas = 0;
    for (const id of todos) {
      const principalId = raiz(id);
      if (principalId === id) continue;
      const [dup] = await tx.db.select().from(conversa).where(eq(conversa.id, id));
      if (!dup || dup.mescladaEmId) continue;
      // Libera o telefone da duplicada antes (índice único por canal + telefone entre as ativas).
      await tx.db.update(conversa).set({ mescladaEmId: principalId, status: "resolvida", naoLidas: 0, arquivadoEm: new Date(), atualizadoEm: new Date() }).where(eq(conversa.id, id));
      await tx.db.update(mensagem).set({ conversaId: principalId }).where(eq(mensagem.conversaId, id));
      await tx.db.execute(sql`
        UPDATE conversa p SET
          ids_externos = ARRAY(SELECT DISTINCT unnest(p.ids_externos || ${dup.idsExternos}::text[])),
          telefone = COALESCE(p.telefone, ${dup.telefone}),
          contato_id = COALESCE(p.contato_id, ${dup.contatoId}::uuid),
          atribuida_a = COALESCE(p.atribuida_a, ${dup.atribuidaA}::uuid),
          nao_lidas = p.nao_lidas + ${dup.naoLidas},
          ultima_mensagem = CASE WHEN ${dup.ultimaMensagemEm}::timestamptz > p.ultima_mensagem_em OR p.ultima_mensagem_em IS NULL THEN ${dup.ultimaMensagem} ELSE p.ultima_mensagem END,
          ultima_mensagem_em = GREATEST(p.ultima_mensagem_em, ${dup.ultimaMensagemEm}::timestamptz),
          ultima_entrada_em = GREATEST(p.ultima_entrada_em, ${dup.ultimaEntradaEm}::timestamptz),
          status = CASE WHEN ${dup.status} <> 'resolvida' THEN 'aberta' ELSE p.status END,
          atualizado_em = now()
        WHERE p.id = ${principalId}`);
      await registrar(tx, { empresaId, atorId, ip: null, dispositivo: "junção de duplicadas" }, {
        acao: "conversa.mesclada",
        entidade: "conversa",
        entidadeId: principalId,
        contatoId: dup.contatoId,
        dados: { absorvida: id },
        depois: { absorvida: id },
      });
      juntadas++;
    }
    return juntadas;
  });
}

/** Job diário: todas as empresas, uma por vez. */
export async function juntarEmTodas(banco: Banco): Promise<number> {
  const empresas = await comoSistema(banco, (tx) => tx.db.select({ id: empresa.id }).from(empresa).where(sql`${empresa.arquivadoEm} IS NULL`));
  let total = 0;
  for (const e of empresas) total += await juntarDuplicadas(banco, e.id);
  return total;
}
