// Dados de CRM criados pela própria API (como a pessoa faria na tela), para os testes de integração.
import { expect } from "vitest";
import type { Banco } from "../../apps/api/src/infra/banco.js";
import type { Cliente } from "./app-teste.js";

export interface CrmSemeado {
  /** Preenchido pelo teste de isolamento depois de criar o canal. */
  canalId?: string;
  funilId: string;
  etapas: { id: string; nome: string; tipo: string }[];
  motivoPerdaId: string;
  etiquetaId: string;
  campoId: string;
  contatoId: string;
  oportunidadeId: string;
  tarefaId: string;
  notaId: string;
  importacaoId: string;
  importadoId: string;
  /** Textos que só existem nesta empresa (para provar que não vazam). */
  marcas: string[];
}

function ok<T>(res: { statusCode: number; body: string; json(): unknown }, esperado = [200, 201]): T {
  expect(esperado, `${res.statusCode}: ${res.body}`).toContain(res.statusCode);
  return res.json() as T;
}

/** Espera o job de importação terminar (status final). */
export async function esperarImportacao(cliente: Cliente, id: string): Promise<{ status: string; novos: number; atualizados: number; inalterados: number; ignorados: number; erros: { linha: number; motivo: string }[] }> {
  for (let i = 0; i < 120; i++) {
    const r = ok<{ status: string; novos: number; atualizados: number; inalterados: number; ignorados: number; erros: { linha: number; motivo: string }[] }>(await cliente.get(`/api/importacoes/${id}`));
    if (["CONCLUIDA", "CONCLUIDA_COM_ERROS", "FALHOU"].includes(r.status)) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("a importação não terminou a tempo");
}

/** Importa um CSV de ponta a ponta (envio → confirmação → job) e devolve o relatório. */
export async function importarCsv(cliente: Cliente, csv: string, extra: Record<string, unknown> = {}) {
  const enviada = ok<{ id: string; colunas: string[] }>(await cliente.enviarArquivo("/api/importacoes", "contatos.csv", csv));
  ok(await cliente.post(`/api/importacoes/${enviada.id}/confirmar`, { mapeamento: { nome: "Nome", telefone: "Telefone" }, ...extra }));
  return { id: enviada.id, ...(await esperarImportacao(cliente, enviada.id)) };
}

/** Um de cada coisa do CRM, com textos marcados pelo rótulo da empresa. `sufixoTel`: 4 dígitos únicos. */
export async function semearCrm(dono: Cliente, banco: Banco, rotulo: string, sufixoTel: string): Promise<CrmSemeado> {
  const config = ok<{ funis: { id: string; etapas: { id: string; nome: string; tipo: string }[] }[]; motivosPerda: { id: string }[] }>(await dono.get("/api/crm/configuracao"));
  const funil = config.funis[0];
  const etiqueta = ok<{ id: string }>(await dono.post("/api/crm/etiquetas", { nome: `Etiqueta ${rotulo}` }));
  const campo = ok<{ id: string }>(await dono.post("/api/crm/campos", { entidade: "contato", chave: `segredo_${rotulo.toLowerCase().replace(/\W/g, "")}`.slice(0, 40), rotulo: `Campo ${rotulo}`, tipo: "texto" }));
  const contato = ok<{ id: string }>(await dono.post("/api/contatos", { nome: `Contato ${rotulo}`, telefone: `(11) 99876-${sufixoTel}`, email: `contato.${sufixoTel}@teste.example.com`, etiquetaIds: [etiqueta.id] }));
  const oportunidade = ok<{ id: string }>(await dono.post("/api/oportunidades", { contatoId: contato.id, funilId: funil.id, titulo: `Oportunidade ${rotulo}`, valorCentavos: 150000 }));
  const tarefa = ok<{ id: string }>(await dono.post("/api/tarefas", { contatoId: contato.id, titulo: `Tarefa ${rotulo}` }));
  const nota = ok<{ id: string }>(await dono.post(`/api/contatos/${contato.id}/notas`, { texto: `Nota ${rotulo}` }));
  const imp = await importarCsv(dono, `Nome;Telefone\nImportado ${rotulo};(21) 99876-${sufixoTel}\n`);
  expect(imp.status).toBe("CONCLUIDA");
  const { rows } = await banco.pool.query<{ id: string }>("SELECT id FROM contato WHERE nome = $1", [`Importado ${rotulo}`]);
  return {
    funilId: funil.id,
    etapas: funil.etapas,
    motivoPerdaId: config.motivosPerda[0].id,
    etiquetaId: etiqueta.id,
    campoId: campo.id,
    contatoId: contato.id,
    oportunidadeId: oportunidade.id,
    tarefaId: tarefa.id,
    notaId: nota.id,
    importacaoId: imp.id,
    importadoId: rows[0].id,
    marcas: [
      `Etiqueta ${rotulo}`,
      `Campo ${rotulo}`,
      `Contato ${rotulo}`,
      `Oportunidade ${rotulo}`,
      `Tarefa ${rotulo}`,
      `Nota ${rotulo}`,
      `Importado ${rotulo}`,
      `+551199876${sufixoTel}`,
      `+552199876${sufixoTel}`,
      `contato.${sufixoTel}@teste.example.com`,
    ],
  };
}
