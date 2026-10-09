// Critério de aceite da fase 0 (Prompt Mestre, seção 87): A não acessa B e B não acessa A.
// O teste percorre TODAS as rotas registradas (rotas novas entram automaticamente), logado como Dono
// (o perfil com mais permissões) de uma empresa, trocando cada :id por cada identificador da outra.
// Este teste deve permanecer no projeto permanentemente.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { notificar } from "../../apps/api/src/modulos/notificacoes/notificar.js";
import {
  email,
  logado,
  montarTeste,
  semearDuasEmpresas,
  type AmbienteTeste,
  type EmpresasTeste,
} from "../apoio/app-teste.js";
import { semearCrm, type CrmSemeado } from "../apoio/crm.js";
import { criarCanalDemo, esperar, simular } from "../apoio/conversas.js";

type Lado = "a" | "b";

let t: AmbienteTeste;
let e: EmpresasTeste;

// Rotas que não fazem sentido na varredura (encerram a própria sessão ou ficam abertas).
const FORA = new Set(["POST /api/auth/sair", "GET /api/tempo-real"]);

interface Vitima {
  crm: CrmSemeado;
  ids: string[];
  marcas: string[];
  sessaoId: string;
}
const vitimas = {} as Record<Lado, Vitima>;

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);

  for (const lado of ["a", "b"] as const) {
    const v = e[lado];
    // Dados extras em cada empresa: uma notificação e uma sessão aberta.
    await comoSistema(t.banco, (tx) =>
      notificar(tx, { empresaId: v.empresaId, atorId: null, ip: null, dispositivo: null }, {
        usuarioId: v.pessoas.dono.usuarioId,
        titulo: `Segredo da empresa ${lado.toUpperCase()}`,
      }),
    );
    const dono = await logado(t.app, email(v, "dono"));
    // E um de cada coisa do CRM (contato, oportunidade, tarefa, nota, etiqueta, campo, importação…).
    const crm = await semearCrm(dono, t.banco, `secreto ${lado.toUpperCase()} ${v.empresaId.slice(0, 6)}`, lado === "a" ? "1001" : "2002");
    // E conversas: canal de demonstração, cliente que escreveu, resposta enviada, resposta rápida e automação.
    const canalId = await criarCanalDemo(dono, `Canal secreto ${lado.toUpperCase()}`);
    const telefoneConversa = lado === "a" ? "+5511966661001" : "+5511966662002";
    await simular(dono, canalId, { telefone: telefoneConversa, nome: `Conversa secreta ${lado.toUpperCase()}`, texto: `Mensagem secreta ${lado.toUpperCase()}` });
    const conversaId = await esperar(
      async () => (await t.banco.pool.query<{ id: string }>("SELECT id FROM conversa WHERE canal_id = $1", [canalId])).rows[0]?.id,
      "conversa criada",
    );
    const saida = await dono.post(`/api/conversas/${conversaId}/mensagens`, { texto: `Resposta secreta ${lado.toUpperCase()}` });
    // Espera o job entregar a resposta: o retrato da vítima precisa estar estável antes da varredura.
    await esperar(
      async () => (await t.banco.pool.query("SELECT status FROM mensagem WHERE id = $1", [saida.json().id])).rows[0]?.status === "entregue",
      "resposta entregue",
    );
    const resposta = await dono.post("/api/respostas-rapidas", { atalho: `segredo${lado}`, texto: `Atalho secreto ${lado.toUpperCase()}` });
    await dono.pedir("PUT", "/api/automacoes/boas_vindas", { texto: `Boas-vindas secretas ${lado.toUpperCase()}`, ativa: false });
    const mensagens = await t.banco.pool.query<{ id: string }>("SELECT id FROM mensagem WHERE conversa_id = $1", [conversaId]);
    // Fila e ligação: fila com o contato do CRM, item reservado, ligação encerrada.
    const filaV = (await dono.post("/api/filas", { nome: `Fila secreta ${lado.toUpperCase()}` })).json();
    await dono.post(`/api/filas/${filaV.id}/itens`, { contatoIds: [crm.contatoId] });
    const itemV = (await dono.post(`/api/filas/${filaV.id}/proximo`)).json().item;
    // Telefonia só existe no plano da empresa A (a B é "comercial", sem o módulo).
    const temTelefonia = (await dono.get("/api/telefonia/resultados")).statusCode === 200;
    const ligacaoV = temTelefonia ? (await dono.post("/api/ligacoes", { provedor: "treino", filaItemId: itemV.id })).json() : { id: undefined };
    if (temTelefonia) await dono.post(`/api/ligacoes/${ligacaoV.id}/estado`, { estado: "encerrada" });
    const resultadoV = temTelefonia ? (await dono.post("/api/telefonia/resultados", { nome: `Resultado secreto ${lado.toUpperCase()}`, acao: "nenhuma" })).json() : { id: undefined };
    const tipoV = (await dono.post("/api/tipos-base", { nome: `Base secreta ${lado.toUpperCase()}` })).json();
    // Operação: meta e check-list (plano das duas); agenda, horas, mapa e scripts só onde o plano tem.
    const L = lado.toUpperCase();
    const metaV = (await dono.post("/api/metas", { alvo: "empresa", indicador: "ligacoes", periodo: "dia", valor: 5 })).json();
    const checkV = (await dono.post("/api/checklist", { texto: `Checklist secreto ${L}` })).json();
    const temOperacao = (await dono.get("/api/scripts")).statusCode === 200;
    const operacao: string[] = [];
    if (temOperacao) {
      const agora = Date.now();
      operacao.push(
        (await dono.post("/api/scripts", { titulo: `Script secreto ${L}`, texto: `Roteiro secreto ${L}` })).json().id,
        (await dono.post("/api/compromissos", { titulo: `Compromisso secreto ${L}`, inicio: new Date(agora + 86_400_000).toISOString(), fim: new Date(agora + 90_000_000).toISOString() })).json().id,
        (await dono.post("/api/atividades", { tipo: "reuniao", descricao: `Atividade secreta ${L}`, inicio: new Date(agora - 7_200_000).toISOString(), fim: new Date(agora - 3_600_000).toISOString() })).json().id,
        (await dono.post("/api/horas", { entrada: new Date(agora - 50_000_000).toISOString(), saida: new Date(agora - 40_000_000).toISOString(), observacao: `Horas secretas ${L}` })).json().id,
        (await dono.post("/api/horas/fechamentos", { mes: "2024-01" })).json().id,
      );
      await dono.pedir("PUT", `/api/escalas/${v.pessoas.vendedor.usuarioId}`, { intervalos: [{ diaSemana: 1, inicio: "08:00", fim: "12:00" }] });
    }
    // White-label: regra de automação e domínio próprio.
    const regraV = (await dono.post("/api/automacoes-regras", { nome: `Automação secreta ${L}`, gatilho: "contato.criado", acao: "avisar", parametros: { texto: `Aviso secreto ${L}` } })).json();
    expect(regraV.id, JSON.stringify(regraV)).toBeTruthy();
    // Desligada: o job de automações (a cada minuto) não pode mexer no retrato da vítima no meio da varredura.
    expect((await dono.pedir("PATCH", `/api/automacoes-regras/${regraV.id}`, { ativa: false })).statusCode).toBe(200);
    await dono.pedir("PUT", "/api/empresa/dominio", { dominio: `secreto-${lado}-${v.empresaId.slice(0, 8)}.example` });
    // Receita e qualidade: oferta, entrega com participante, venda, regra e fechamento de comissão, avaliação e pesquisa.
    const receita: string[] = [];
    let tokenPesquisa = "";
    if ((await dono.get("/api/vendas")).statusCode === 200) {
      const ofertaV = (await dono.post("/api/ofertas", { nome: `Oferta secreta ${L}` })).json();
      const entregaV = (await dono.post("/api/entregas", { ofertaId: ofertaV.id, nome: `Turma secreta ${L}`, capacidade: 5 })).json();
      const vendaV = (await dono.post("/api/vendas", { contatoId: crm.contatoId, ofertaId: ofertaV.id, entregaId: entregaV.id, valorCentavos: 12345, formaPagamento: "pix", status: "confirmada", observacao: `Venda secreta ${L}` })).json();
      const participante = (await dono.get(`/api/entregas/${entregaV.id}/participantes`)).json().itens[0];
      const regraV = (await dono.post("/api/comissoes/regras", { nome: `Regra secreta ${L}`, tipo: "percentual", percentual: 5 })).json();
      const fechV = (await dono.post("/api/comissoes/fechamentos", { mes: "2024-02" })).json();
      const vendedorV = await logado(t.app, email(v, "vendedor"));
      const lig = (await vendedorV.post("/api/ligacoes", { provedor: "treino", numero: "(11) 95555-0000" })).json();
      const criterios = (await dono.get("/api/qualidade/criterios")).json().itens;
      const gestor = await logado(t.app, email(v, "gestor"));
      const avaliacaoV = (await gestor.post("/api/avaliacoes", { ligacaoId: lig.id, notas: [{ criterioId: criterios[0].id, nota: 9 }], feedback: `Feedback secreto ${L}` })).json();
      const pesquisaV = (await dono.post("/api/pesquisas", { titulo: `Pesquisa secreta ${L}`, perguntas: [{ id: "a", tipo: "texto", texto: "?" }] })).json();
      tokenPesquisa = pesquisaV.token;
      for (const x of [ofertaV, entregaV, vendaV, participante, regraV, lig, avaliacaoV, pesquisaV]) expect(x?.id, JSON.stringify(x)).toBeTruthy();
      receita.push(ofertaV.id, entregaV.id, vendaV.id, participante.id, regraV.id, fechV.fechamento.id, lig.id, criterios[0].id, avaliacaoV.id, pesquisaV.id);
    }
    const sessao = await t.banco.pool.query<{ id: string }>(
      "SELECT id FROM sessao WHERE usuario_id = $1 AND encerrada_em IS NULL LIMIT 1",
      [v.pessoas.dono.usuarioId],
    );
    const notif = await t.banco.pool.query<{ id: string }>("SELECT id FROM notificacao WHERE empresa_id = $1", [v.empresaId]);
    const slug = await t.banco.pool.query<{ slug: string }>("SELECT slug FROM empresa WHERE id = $1", [v.empresaId]);

    // A consultora pertence às duas empresas: os dados pessoais dela são legítimos nas duas.
    const pessoasSoDela = Object.entries(v.pessoas).filter(([chave]) => chave !== "consultor");
    const ids = [
      v.empresaId,
      ...Object.values(v.perfis),
      ...Object.values(v.unidades),
      ...Object.values(v.equipes),
      ...pessoasSoDela.flatMap(([, p]) => [p.usuarioId, p.vinculoId]),
      v.pessoas.consultor.vinculoId,
      ...notif.rows.map((n) => n.id),
      sessao.rows[0].id,
      crm.funilId,
      ...crm.etapas.map((et) => et.id),
      crm.motivoPerdaId,
      crm.etiquetaId,
      crm.campoId,
      crm.contatoId,
      crm.oportunidadeId,
      crm.tarefaId,
      crm.notaId,
      crm.importacaoId,
      crm.importadoId,
      canalId,
      conversaId,
      saida.json().id,
      resposta.json().id,
      ...mensagens.rows.map((m) => m.id),
      filaV.id,
      itemV.id,
      tipoV.id,
      ...(temTelefonia ? [ligacaoV.id as string, resultadoV.id as string] : []),
      metaV.id,
      checkV.id,
      ...operacao,
      ...receita,
      regraV.id,
    ];
    crm.canalId = canalId;
    crm.filaId = filaV.id;
    crm.filaItemId = itemV.id;
    crm.ligacaoId = ligacaoV.id;
    crm.resultadoId = resultadoV.id;
    crm.tipoBaseId = tipoV.id;
    vitimas[lado] = {
      crm,
      ids,
      sessaoId: sessao.rows[0].id,
      marcas: [
        ...ids,
        v.d.nome,
        slug.rows[0].slug,
        `Segredo da empresa ${lado.toUpperCase()}`,
        ...Object.keys(v.equipes),
        ...crm.marcas,
        `Canal secreto ${lado.toUpperCase()}`,
        `Conversa secreta ${lado.toUpperCase()}`,
        `Mensagem secreta ${lado.toUpperCase()}`,
        `Resposta secreta ${lado.toUpperCase()}`,
        `Atalho secreto ${lado.toUpperCase()}`,
        `Boas-vindas secretas ${lado.toUpperCase()}`,
        telefoneConversa,
        `Fila secreta ${lado.toUpperCase()}`,
        ...(temTelefonia ? [`Resultado secreto ${lado.toUpperCase()}`] : []),
        `Base secreta ${lado.toUpperCase()}`,
        `Checklist secreto ${L}`,
        `Automação secreta ${L}`,
        `Aviso secreto ${L}`,
        `secreto-${lado}-${v.empresaId.slice(0, 8)}.example`,
        ...(receita.length ? [`Oferta secreta ${L}`, `Turma secreta ${L}`, `Venda secreta ${L}`, `Regra secreta ${L}`, `Feedback secreto ${L}`, `Pesquisa secreta ${L}`, tokenPesquisa] : []),
        ...(temOperacao ? [`Script secreto ${L}`, `Roteiro secreto ${L}`, `Compromisso secreto ${L}`, `Atividade secreta ${L}`, `Horas secretas ${L}`] : []),
        ...v.d.pessoas.filter((p) => p.chave !== "consultor").flatMap((p) => [p.email, p.nome]),
      ],
    };
  }
});
afterAll(() => t.fechar());

/** Retrato de tudo o que pertence à empresa, para provar que nada mudou. */
async function retrato(empresaId: string): Promise<Record<string, string>> {
  const { rows: tabelas } = await t.banco.pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'empresa_id' ORDER BY table_name`,
  );
  const r: Record<string, string> = {};
  for (const { table_name: tabela } of tabelas) {
    const ignorar = tabela === "sessao" ? "- 'ultimo_uso'" : "";
    const { rows } = await t.banco.pool.query<{ h: string | null }>(
      `SELECT md5(string_agg((to_jsonb(x) ${ignorar})::text, '|' ORDER BY to_jsonb(x)::text)) AS h FROM ${tabela} x WHERE empresa_id = $1`,
      [empresaId],
    );
    r[tabela] = rows[0].h ?? "";
  }
  r.empresa = (await t.banco.pool.query("SELECT to_jsonb(x)::text AS j FROM empresa x WHERE id = $1", [empresaId])).rows[0].j;
  r.usuario = (
    await t.banco.pool.query(
      "SELECT md5(string_agg(to_jsonb(u)::text, '|' ORDER BY u.id)) AS h FROM usuario u WHERE id IN (SELECT usuario_id FROM vinculo WHERE empresa_id = $1)",
      [empresaId],
    )
  ).rows[0].h;
  return r;
}

/** Corpo genérico que tenta apontar tudo para a vítima. */
function corpoInvasor(v: EmpresasTeste[Lado], crm: CrmSemeado): Record<string, unknown> {
  return {
    // CRM: tudo apontando para registros da outra empresa.
    titulo: "Invasão",
    texto: "Invasão",
    rotulo: "Invasão",
    contatoId: crm.contatoId,
    oportunidadeId: crm.oportunidadeId,
    organizacaoId: crm.contatoId,
    funilId: crm.funilId,
    etapaId: crm.etapas[1].id,
    motivoPerdaId: crm.motivoPerdaId,
    etiquetaId: crm.etiquetaId,
    etiquetaIds: [crm.etiquetaId],
    ids: [crm.contatoId, crm.importadoId],
    acao: "arquivar",
    responsavelId: v.pessoas.dono.usuarioId,
    mapeamento: { nome: "Nome", telefone: "Telefone" },
    // Conversas
    canalId: crm.canalId,
    usuarioId: v.pessoas.dono.usuarioId,
    status: "resolvida",
    nota: false,
    atalho: "invasao",
    provedor: "demonstracao",
    telefone: "+5511966660000",
    // Fila e telefonia
    filaId: crm.filaId,
    filaItemId: crm.filaItemId,
    ligacaoId: crm.ligacaoId,
    resultadoId: crm.resultadoId,
    tipoBaseId: crm.tipoBaseId,
    contatoIds: [crm.contatoId],
    estado: "encerrada",
    login: "invasor",
    nome: "Invasão",
    slug: `invasao-${Date.now()}`,
    email: `invasao.${Date.now()}@teste.example.com`,
    senha: "uma senha qualquer longa",
    token: "x".repeat(43),
    empresaId: v.empresaId,
    perfilId: v.perfis.dono,
    copiarDe: v.perfis.dono,
    unidadeId: Object.values(v.unidades)[0],
    equipeId: Object.values(v.equipes)[0],
    gestorId: v.pessoas.gestor.usuarioId,
    permissoes: { usuarios: { ver: "empresa" } },
  };
}

function semVazamento(vitima: Vitima, rota: string, corpo: string) {
  for (const marca of vitima.marcas) expect(corpo.includes(marca), `${rota} vazou "${marca}"`).toBe(false);
}

it("a varredura cobre todas as rotas da API", () => {
  expect(t.rotas.length).toBeGreaterThanOrEqual(30);
  for (const r of t.rotas) expect(r.acesso, `${r.metodo} ${r.url}`).toBeDefined();
});

for (const [atacante, alvo] of [
  ["a", "b"],
  ["b", "a"],
] as const) {
  const A = atacante.toUpperCase();
  const B = alvo.toUpperCase();

  describe(`usuário de ${A} não acessa ${B}`, () => {
    it(`nenhuma rota devolve ou altera dados de ${B}, mesmo recebendo ids de ${B}`, async () => {
      const dono = await logado(t.app, email(e[atacante], "dono"));
      const vitima = vitimas[alvo];
      const antes = await retrato(e[alvo].empresaId);
      let chamadas = 0;

      for (const rota of t.rotas) {
        const nome = `${rota.metodo} ${rota.url}`;
        if (FORA.has(nome)) continue;
        // Todo parâmetro de caminho (:id, :canalId…) recebe cada identificador da outra empresa.
        const comId = /:\w+/.test(rota.url);
        const urls = comId ? vitima.ids.map((id) => rota.url.replace(/:\w+/g, id)) : [rota.url];
        for (const url of urls) {
          const res = await dono.pedir(rota.metodo as "GET", url, rota.metodo === "GET" ? undefined : corpoInvasor(e[alvo], vitima.crm));
          chamadas++;
          semVazamento(vitima, `${nome} (${url})`, res.body);
          if (comId) expect(res.statusCode, `${nome} com id de ${B} respondeu ${res.statusCode}: ${res.body}`).toBeGreaterThanOrEqual(400);
        }
      }

      expect(chamadas).toBeGreaterThan(200);
      expect(await retrato(e[alvo].empresaId)).toEqual(antes);
    }, 180_000); // a varredura cresce a cada rota nova: todas as rotas × todos os ids da outra empresa

    it(`listagens de ${A} devolvem só dados de ${A}`, async () => {
      const dono = await logado(t.app, email(e[atacante], "dono"));
      for (const url of ["/api/usuarios", "/api/equipes", "/api/unidades", "/api/perfis", "/api/auditoria", "/api/contatos", "/api/oportunidades", "/api/tarefas", "/api/importacoes", "/api/conversas", "/api/canais", "/api/respostas-rapidas", "/api/filas", "/api/ligacoes", "/api/telefonia/resultados"]) {
        const res = await dono.get(url);
        // Módulo fora do plano da empresa: a API recusa (e isso também não vaza nada).
        if (res.statusCode === 403 && res.json().error.code === "MODULO_INATIVO") continue;
        expect(res.statusCode, url).toBe(200);
        const corpo = res.json();
        expect((Array.isArray(corpo) ? corpo : corpo.itens).length, url).toBeGreaterThan(0);
        semVazamento(vitimas[alvo], url, res.body);
      }
    });

    it(`a sessão aberta em ${B} não é visível nem encerrável por ${A}`, async () => {
      const dono = await logado(t.app, email(e[atacante], "dono"));
      expect((await dono.delete(`/api/auth/sessoes/${vitimas[alvo].sessaoId}`)).statusCode).toBe(404);
      const { rows } = await t.banco.pool.query("SELECT encerrada_em FROM sessao WHERE id = $1", [vitimas[alvo].sessaoId]);
      expect(rows[0].encerrada_em).toBeNull();
    });
  });
}
