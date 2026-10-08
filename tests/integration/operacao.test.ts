// Critérios de pronto da fase 4: metas, desempenho e mapa calculados só de eventos; fechamento de horas bloqueia
// a edição do período (no serviço e no banco); rotina diária junta o que a pessoa tem para hoje; scripts por etapa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "../../apps/api/src/infra/banco.js";
import { email, logado, montarTeste, semearDuasEmpresas, type AmbienteTeste, type Cliente, type EmpresasTeste } from "../apoio/app-teste.js";
import { esperar } from "../apoio/conversas.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let dono: Cliente;
let gestor: Cliente;
let vendedor: Cliente;
let vendedor2: Cliente;
let financeiro: Cliente;
let telefone = 0;
const id = (chave: string) => e.a.pessoas[chave].usuarioId;

/** Evento gravado direto na tabela (como se a ação tivesse acontecido naquele instante). */
async function evento(tipo: string, atorId: string, criadoEm: string, dados: Record<string, unknown> = {}, responsavelId: string | null = null) {
  await comoSistema(t.banco, (tx) =>
    tx.cliente.query("INSERT INTO evento (empresa_id, tipo, ator_id, responsavel_id, entidade, dados, criado_em) VALUES ($1, $2, $3, $4, 'teste', $5, $6)", [
      e.a.empresaId,
      tipo,
      atorId,
      responsavelId,
      JSON.stringify(dados),
      criadoEm,
    ]),
  );
}

async function novoContato(cliente: Cliente, nome: string): Promise<string> {
  const r = await cliente.post("/api/contatos", { nome, telefone: `(21) 9${String(7100_0000 + telefone++).padStart(8, "0")}` });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id;
}

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);
  dono = await logado(t.app, email(e.a, "dono"));
  gestor = await logado(t.app, email(e.a, "gestor"));
  vendedor = await logado(t.app, email(e.a, "vendedor"));
  vendedor2 = await logado(t.app, email(e.a, "vendedor2"));
  financeiro = await logado(t.app, email(e.a, "financeiro"));
});
afterAll(() => t.fechar());

describe("metas e desempenho saem só dos eventos", () => {
  it("o realizado da meta muda com eventos e não com mudanças feitas por fora", async () => {
    const m = await dono.post("/api/metas", { alvo: "pessoa", usuarioId: id("vendedor"), indicador: "ligacoes", periodo: "dia", valor: 4 });
    expect(m.statusCode, m.body).toBe(201);
    expect(m.json()).toMatchObject({ realizado: 0, percentual: 0, alvoNome: "Vendedor A1" });

    // Ligação gravada direto na tabela (sem evento): não conta.
    await comoSistema(t.banco, (tx) =>
      tx.cliente.query(
        "INSERT INTO ligacao (empresa_id, usuario_id, provedor, numero, estado, encerrada_em) VALUES ($1, $2, 'treino', '+5511999990000', 'encerrada', now())",
        [e.a.empresaId, id("vendedor")],
      ),
    );
    const metaDe = async () => (await vendedor.get("/api/metas")).json().itens.find((x: { id: string }) => x.id === m.json().id);
    expect((await metaDe()).realizado).toBe(0);

    // Ligação feita pelo sistema: o evento ligacao.encerrada conta.
    const l = await vendedor.post("/api/ligacoes", { provedor: "treino", numero: "(11) 98888-1111" });
    expect(l.statusCode, l.body).toBe(201);
    await vendedor.post(`/api/ligacoes/${l.json().id}/estado`, { estado: "encerrada" });
    expect(await metaDe()).toMatchObject({ realizado: 1, percentual: 25 });

    // Um evento (de qualquer origem) conta do mesmo jeito.
    await evento("ligacao.encerrada", id("vendedor"), new Date().toISOString(), { atendida: true, duracaoSegundos: 120 });
    expect(await metaDe()).toMatchObject({ realizado: 2, percentual: 50 });
  });

  it("painel por pessoa respeita o escopo e soma valores dos eventos", async () => {
    const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const instante = `${ontem}T15:00:00Z`;
    await evento("oportunidade.ganha", id("gestor"), instante, { valorCentavos: 250000 }, id("vendedor"));
    await evento("oportunidade.ganha", id("vendedor"), instante, { valorCentavos: 100050 }, id("vendedor"));
    await evento("contato.criado", id("vendedor"), instante, { importacaoId: "x" });
    await evento("contato.criado", id("vendedor"), instante);
    await evento("mensagem.criada", id("vendedor2"), instante);

    const p = (await gestor.get(`/api/desempenho?periodo=dia&data=${ontem}`)).json();
    expect(p.inicio).toBe(ontem);
    const nomes = p.itens.map((i: { nome: string }) => i.nome);
    // Gestor da equipe A1: ele e o vendedor A1; o vendedor A2 é de outra equipe.
    expect(nomes).toEqual(expect.arrayContaining(["Gestor A", "Vendedor A1"]));
    expect(nomes).not.toContain("Vendedor A2");
    const v = p.itens.find((i: { nome: string }) => i.nome === "Vendedor A1").valores;
    // A venda é de quem é dono da oportunidade, mesmo se outra pessoa moveu o card.
    expect(v).toMatchObject({ vendas: 2, valor_vendido: 3500.5, contatos_novos: 1 });

    const proprio = (await vendedor2.get(`/api/desempenho?periodo=semana&data=${ontem}`)).json();
    expect(proprio.itens.map((i: { nome: string }) => i.nome)).toEqual(["Vendedor A2"]);
    expect(proprio.itens[0].valores.mensagens).toBeGreaterThanOrEqual(1);

    const semana = (await dono.get(`/api/desempenho?periodo=semana&data=2026-10-08`)).json();
    expect(semana).toMatchObject({ inicio: "2026-10-05", fim: "2026-10-11" });
    const mes = (await dono.get(`/api/desempenho?periodo=mes&data=2026-02-10`)).json();
    expect(mes).toMatchObject({ inicio: "2026-02-01", fim: "2026-02-28" });
  });

  it("meta de equipe soma os membros; quem não gerencia não define metas", async () => {
    const equipeA1 = Object.entries(e.a.equipes).find(([nome]) => nome.startsWith("Equipe A1"))![1];
    const m = await gestor.post("/api/metas", { alvo: "equipe", equipeId: equipeA1, indicador: "mensagens", periodo: "mes", valor: 10 });
    expect(m.statusCode, m.body).toBe(201);
    await evento("mensagem.criada", id("vendedor"), new Date().toISOString());
    await evento("mensagem.criada", id("vendedor"), new Date().toISOString());
    await evento("mensagem.criada", id("vendedor2"), new Date().toISOString()); // outra equipe: não soma
    const meta = (await gestor.get("/api/metas?alvo=equipe")).json().itens.find((x: { id: string }) => x.id === m.json().id);
    expect(meta.realizado).toBe(2);

    expect((await vendedor.post("/api/metas", { alvo: "pessoa", usuarioId: id("vendedor"), indicador: "ligacoes", periodo: "dia", valor: 1 })).statusCode).toBe(403);
    expect((await gestor.post("/api/metas", { alvo: "pessoa", usuarioId: id("vendedor2"), indicador: "ligacoes", periodo: "dia", valor: 1 })).statusCode).toBe(403);
    expect((await gestor.post("/api/metas", { alvo: "empresa", indicador: "ligacoes", periodo: "dia", valor: 1 })).statusCode).toBe(403);
    const repetida = await gestor.post("/api/metas", { alvo: "equipe", equipeId: equipeA1, indicador: "mensagens", periodo: "mes", valor: 3 });
    expect(repetida.statusCode).toBe(409);
    const arquivada = await gestor.patch(`/api/metas/${m.json().id}`, { arquivar: true });
    expect(arquivada.json().arquivadoEm).not.toBeNull();
  });
});

describe("mapa de atividades", () => {
  it("conta eventos por hora no fuso da empresa e soma lançamentos manuais corrigíveis", async () => {
    const dia = "2026-01-15"; // São Paulo = UTC-3
    await evento("ligacao.encerrada", id("vendedor"), `${dia}T13:15:00Z`);
    await evento("ligacao.encerrada", id("vendedor"), `${dia}T13:40:00Z`);
    await evento("mensagem.criada", id("vendedor"), `${dia}T13:50:00Z`);
    await evento("fila.resultado_registrado", id("vendedor"), `${dia}T19:05:00Z`);
    await evento("sessao.encerrada", id("vendedor"), `${dia}T13:20:00Z`); // não é atividade
    await evento("ligacao.encerrada", id("vendedor"), `${dia}T02:30:00Z`); // 23h30 do dia anterior

    const a = await vendedor.post("/api/atividades", { tipo: "reuniao", descricao: "Reunião de equipe", inicio: `${dia}T17:00:00Z`, fim: `${dia}T18:30:00Z` });
    expect(a.statusCode, a.body).toBe(201);

    const mapaDe = async (c: Cliente) => (await c.get(`/api/mapa?data=${dia}`)).json();
    const m = await mapaDe(vendedor);
    expect(m.itens).toHaveLength(1);
    const horas = m.itens[0].horas;
    expect(horas[10]).toMatchObject({ ligacoes: 2, mensagens: 1, acoes: 3 });
    expect(horas[16]).toMatchObject({ fila: 1, acoes: 1 });
    expect(horas[14]).toMatchObject({ manualMinutos: 60, manualTipos: ["reuniao"] });
    expect(horas[15]).toMatchObject({ manualMinutos: 30 });
    expect(horas[23].acoes).toBe(0);
    expect(horas.reduce((s: number, h: { acoes: number }) => s + h.acoes, 0)).toBe(4);

    // Corrigir o lançamento (fica na auditoria com o antes) muda o mapa.
    const c = await vendedor.patch(`/api/atividades/${a.json().id}`, { fim: `${dia}T17:30:00Z` });
    expect(c.statusCode, c.body).toBe(200);
    const depois = (await mapaDe(vendedor)).itens[0].horas;
    expect(depois[14].manualMinutos).toBe(30);
    expect(depois[15].manualMinutos).toBe(0);
    const aud = await t.banco.pool.query("SELECT antes FROM auditoria WHERE acao = 'atividade.corrigida' AND entidade_id = $1", [a.json().id]);
    expect(aud.rows[0].antes.descricao).toBe("Reunião de equipe");

    // Escopo: o vendedor A2 não lança nem vê atividades de outra pessoa.
    expect((await vendedor2.post("/api/atividades", { usuarioId: id("vendedor"), tipo: "visita", inicio: `${dia}T12:00:00Z`, fim: `${dia}T13:00:00Z` })).statusCode).toBe(403);
    expect((await vendedor2.patch(`/api/atividades/${a.json().id}`, { tipo: "pausa" })).statusCode).toBe(404);
    expect((await mapaDe(gestor)).itens.map((i: { nome: string }) => i.nome)).toContain("Vendedor A1");
    expect((await vendedor.post("/api/atividades", { tipo: "pausa", inicio: `${dia}T10:00:00Z`, fim: `${dia}T09:00:00Z` })).statusCode).toBe(400);
  });
});

describe("escala, horas e fechamento do mês", () => {
  it("ponto: entrada e saída viram um registro aguardando validação", async () => {
    const entrada = await vendedor.post("/api/horas/ponto");
    expect(entrada.json()).toMatchObject({ status: "aberto", saida: null });
    expect((await vendedor.get("/api/horas/ponto")).json().registro.id).toBe(entrada.json().id);
    const saida = await vendedor.post("/api/horas/ponto");
    expect(saida.json()).toMatchObject({ id: entrada.json().id, status: "pendente" });
    expect(saida.json().minutos).toBeGreaterThanOrEqual(0);
    expect((await vendedor.get("/api/horas/ponto")).json().registro).toBeNull();
  });

  it("escala é montada pelo gestor e vira o previsto do mês", async () => {
    const semana = [1, 2, 3, 4, 5].flatMap((d) => [
      { diaSemana: d, inicio: "08:00", fim: "12:00" },
      { diaSemana: d, inicio: "13:00", fim: "17:00" },
    ]);
    expect((await vendedor.pedir("PUT", `/api/escalas/${id("vendedor")}`, { intervalos: semana })).statusCode).toBe(403);
    const r = await gestor.pedir("PUT", `/api/escalas/${id("vendedor")}`, { intervalos: semana });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().minutosSemana).toBe(2400);
    const cruzada = await gestor.pedir("PUT", `/api/escalas/${id("vendedor")}`, { intervalos: [{ diaSemana: 1, inicio: "08:00", fim: "12:00" }, { diaSemana: 1, inicio: "11:00", fim: "14:00" }] });
    expect(cruzada.statusCode).toBe(400);
    expect((await gestor.pedir("PUT", `/api/escalas/${id("vendedor2")}`, { intervalos: semana })).statusCode).toBe(403);
    // Novembro de 2025 tem 20 dias úteis: 20 × 8 h.
    const resumo = (await gestor.get("/api/horas/resumo?mes=2025-11")).json().itens.find((i: { nome: string }) => i.nome === "Vendedor A1");
    expect(resumo.previstoMinutos).toBe(20 * 480);
    // A troca anterior ficou arquivada (nada some).
    const { rows } = await t.banco.pool.query("SELECT count(*) FILTER (WHERE arquivado_em IS NULL) AS ativas, count(*) AS todas FROM escala WHERE usuario_id = $1", [id("vendedor")]);
    expect(Number(rows[0].ativas)).toBe(10);
  });

  it("validação é do gestor; mês fechado não aceita mudança nenhuma (serviço e banco)", async () => {
    const lancar = (c: Cliente, dia: string, usuarioId?: string) =>
      c.post("/api/horas", { usuarioId, entrada: `${dia}T11:00:00Z`, saida: `${dia}T20:00:00Z`, observacao: "Plantão" });
    const r1 = await lancar(vendedor, "2025-11-03");
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json()).toMatchObject({ data: "2025-11-03", minutos: 540, status: "pendente" });
    expect((await lancar(vendedor, "2025-11-03")).statusCode).toBe(409); // mesmo horário
    const r2 = (await lancar(gestor, "2025-11-04", id("vendedor"))).json();

    expect((await vendedor.post(`/api/horas/${r1.json().id}/validacao`, { aprovar: true })).statusCode).toBe(400);
    expect((await vendedor2.post(`/api/horas/${r1.json().id}/validacao`, { aprovar: true })).statusCode).toBe(404);
    expect((await gestor.post(`/api/horas/${r1.json().id}/validacao`, { aprovar: false })).statusCode).toBe(400);
    const ok = await gestor.post(`/api/horas/${r1.json().id}/validacao`, { aprovar: true });
    expect(ok.json()).toMatchObject({ status: "validado", validadoPorNome: "Gestor A" });
    expect((await vendedor.patch(`/api/horas/${r1.json().id}`, { observacao: "mudei" })).statusCode).toBe(409);

    // Fechar com registro pendente: recusa e diz quantos faltam.
    const cedo = await dono.post("/api/horas/fechamentos", { mes: "2025-11" });
    expect(cedo.statusCode).toBe(409);
    expect(cedo.json().error.details.pendentes).toBe(1);
    expect((await gestor.post("/api/horas/fechamentos", { mes: "2025-11" })).statusCode).toBe(403);
    await gestor.post(`/api/horas/${r2.id}/validacao`, { aprovar: false, motivo: "Sem escala neste dia" });

    const f = await dono.post("/api/horas/fechamentos", { mes: "2025-11" });
    expect(f.statusCode, f.body).toBe(201);
    expect((await dono.post("/api/horas/fechamentos", { mes: "2025-11" })).statusCode).toBe(409);

    const bloqueios = [
      await gestor.patch(`/api/horas/${r1.json().id}`, { observacao: "corrigido" }),
      await vendedor.patch(`/api/horas/${r2.id}`, { saida: "2025-11-04T19:00:00Z" }),
      await vendedor.patch(`/api/horas/${r2.id}`, { arquivar: true }),
      await lancar(vendedor, "2025-11-10"),
    ];
    for (const b of bloqueios) {
      expect(b.statusCode, b.body).toBe(409);
      expect(b.json().error.code).toBe("PERIODO_FECHADO");
    }
    // A trava vale também fora da API: o gatilho do banco recusa.
    await expect(
      comoSistema(t.banco, (tx) => tx.cliente.query("UPDATE registro_horas SET observacao = 'por fora' WHERE id = $1", [r1.json().id])),
    ).rejects.toThrow(/PERIODO_FECHADO/);
    await expect(
      comoSistema(t.banco, (tx) =>
        tx.cliente.query("INSERT INTO registro_horas (empresa_id, usuario_id, data, entrada, saida) VALUES ($1, $2, '2025-11-20', '2025-11-20T12:00:00Z', '2025-11-20T13:00:00Z')", [
          e.a.empresaId,
          id("vendedor"),
        ]),
      ),
    ).rejects.toThrow(/PERIODO_FECHADO/);
    const lista = (await vendedor.get("/api/horas?mes=2025-11")).json().itens;
    expect(lista.every((r: { fechado: boolean }) => r.fechado)).toBe(true);

    // Reabrir (com motivo, auditado) libera a correção.
    expect((await dono.post(`/api/horas/fechamentos/${f.json().id}/reabrir`, {})).statusCode).toBe(400);
    const re = await dono.post(`/api/horas/fechamentos/${f.json().id}/reabrir`, { motivo: "Ajuste de plantão" });
    expect(re.json()).toMatchObject({ reabertoPorNome: "Dona A", motivoReabertura: "Ajuste de plantão" });
    expect((await vendedor.patch(`/api/horas/${r2.id}`, { saida: "2025-11-04T19:00:00Z" })).json()).toMatchObject({ status: "pendente", minutos: 480 });
  });
});

describe("rotina diária", () => {
  it("junta tarefas vencidas, retornos da fila, compromissos, metas e o check-list do perfil", async () => {
    const contatoId = await novoContato(vendedor, "Cliente da rotina");
    await vendedor.post("/api/tarefas", { titulo: "Ligar de volta", contatoId, venceEm: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await vendedor.post("/api/compromissos", { titulo: "Visita ao cliente", contatoId, inicio: new Date(Date.now() + 60_000).toISOString(), fim: new Date(Date.now() + 120_000).toISOString() });

    // Retorno da fila: o último resultado foi do vendedor A1.
    const fila = (await dono.post("/api/filas", { nome: "Fila da rotina" })).json();
    await dono.post(`/api/filas/${fila.id}/itens`, { contatoIds: [contatoId] });
    const item = (await vendedor.post(`/api/filas/${fila.id}/proximo`)).json().item;
    const resultados = (await dono.get("/api/telefonia/resultados")).json();
    const naoAtendeu = resultados.find((r: { nome: string }) => r.nome === "Não atendeu").id;
    expect((await vendedor.post(`/api/fila-itens/${item.id}/resultado`, { resultadoId: naoAtendeu })).statusCode).toBe(200);
    await comoSistema(t.banco, (tx) => tx.cliente.query("UPDATE fila_item SET retornar_em = now() - interval '1 minute' WHERE id = $1", [item.id]));

    const todos = await dono.post("/api/checklist", { texto: "Conferir a agenda" });
    const soVendedor = await dono.post("/api/checklist", { texto: "Bater 30 ligações", perfilId: e.a.perfis.vendedor });
    expect(soVendedor.statusCode, soVendedor.body).toBe(201);
    expect((await vendedor.post("/api/checklist", { texto: "Não pode" })).statusCode).toBe(403);

    const r = (await vendedor.get("/api/rotina")).json();
    expect(r.tarefas.vencidas).toBeGreaterThanOrEqual(1);
    expect(r.tarefas.itens.map((x: { titulo: string }) => x.titulo)).toContain("Ligar de volta");
    expect(r.retornos.map((x: { itemId: string }) => x.itemId)).toContain(item.id);
    expect(r.compromissos.map((x: { titulo: string }) => x.titulo)).toContain("Visita ao cliente");
    expect(r.checklist.map((x: { texto: string }) => x.texto)).toEqual(expect.arrayContaining(["Conferir a agenda", "Bater 30 ligações"]));
    expect(r.metas.some((m: { indicador: string }) => m.indicador === "ligacoes")).toBe(true);
    // O retorno é de quem registrou o resultado.
    expect((await vendedor2.get("/api/rotina")).json().retornos.map((x: { itemId: string }) => x.itemId)).not.toContain(item.id);

    expect((await vendedor.pedir("PUT", `/api/rotina/checklist/${soVendedor.json().id}`, { feito: true })).statusCode).toBe(200);
    const marcado = (await vendedor.get("/api/rotina")).json().checklist.find((x: { itemId: string }) => x.itemId === soVendedor.json().id);
    expect(marcado.feito).toBe(true);
    // Item de outro perfil não pode ser marcado; o gestor não vê o item só do vendedor.
    expect((await gestor.pedir("PUT", `/api/rotina/checklist/${soVendedor.json().id}`, { feito: true })).statusCode).toBe(404);
    expect((await gestor.get("/api/rotina")).json().checklist.map((x: { itemId: string }) => x.itemId)).toEqual([todos.json().id]);
    // Financeiro não tem rotina no perfil-base.
    expect((await financeiro.get("/api/rotina")).statusCode).toBe(403);
  });
});

describe("agenda", () => {
  it("compromisso com contato entra no histórico e o lembrete chega no sino", async () => {
    const contatoId = await novoContato(vendedor, "Cliente da agenda");
    const inicio = new Date(Date.now() + 2000);
    const c = await vendedor.post("/api/compromissos", {
      titulo: "Apresentação da proposta",
      contatoId,
      local: "Sala 2",
      inicio: inicio.toISOString(),
      fim: new Date(inicio.getTime() + 3_600_000).toISOString(),
      lembreteMinutos: 0,
    });
    expect(c.statusCode, c.body).toBe(201);
    const hist = (await vendedor.get(`/api/contatos/${contatoId}/historico`)).json().itens.map((h: { tipo: string }) => h.tipo);
    expect(hist).toContain("compromisso.criado");
    await esperar(
      async () =>
        (await t.banco.pool.query("SELECT 1 FROM notificacao WHERE usuario_id = $1 AND titulo LIKE '%Apresentação da proposta%'", [id("vendedor")])).rowCount,
      "lembrete do compromisso",
    );

    const hoje = new Date().toISOString().slice(0, 10);
    const lista = (await vendedor.get(`/api/compromissos?de=${hoje}&ate=${hoje}`)).json().itens;
    expect(lista.map((x: { id: string }) => x.id)).toContain(c.json().id);
    expect((await vendedor.get(`/api/compromissos?de=2026-01-01&ate=2026-06-01`)).statusCode).toBe(400);
    expect((await vendedor2.get(`/api/compromissos?de=${hoje}&ate=${hoje}&usuarioId=${id("vendedor")}`)).json().itens).toEqual([]);
    expect((await vendedor2.patch(`/api/compromissos/${c.json().id}`, { titulo: "Invasão" })).statusCode).toBe(404);
    expect((await vendedor2.post("/api/compromissos", { usuarioId: id("vendedor"), titulo: "x", inicio: inicio.toISOString(), fim: new Date(inicio.getTime() + 1000).toISOString() })).statusCode).toBe(403);
    const arq = await vendedor.patch(`/api/compromissos/${c.json().id}`, { arquivar: true });
    expect(arq.json().arquivadoEm).not.toBeNull();
  });
});

describe("biblioteca de scripts", () => {
  it("no contexto do contato, os da etapa vêm primeiro; uso por canal e permissões", async () => {
    const config = (await dono.get("/api/crm/configuracao")).json();
    const funil = config.funis[0];
    const [etapa1, etapa2] = funil.etapas;
    const contatoId = await novoContato(dono, "Cliente com script");
    await dono.post("/api/oportunidades", { contatoId, funilId: funil.id, titulo: "Proposta" });

    const geral = (await dono.post("/api/scripts", { titulo: "Abertura geral", texto: "Oi {nome}, aqui é {vendedor}." })).json();
    const daEtapa = (await dono.post("/api/scripts", { titulo: "Primeiro contato", texto: "Roteiro da etapa", etapaId: etapa1.id })).json();
    const outraEtapa = (await dono.post("/api/scripts", { titulo: "Fechamento", texto: "Roteiro de fechamento", etapaId: etapa2.id })).json();
    const soLigacao = (await dono.post("/api/scripts", { titulo: "Só ao telefone", texto: "Alô", uso: "ligacao" })).json();
    expect(daEtapa.funilId).toBe(funil.id);

    const conversa = (await vendedor.get(`/api/scripts?contatoId=${contatoId}&uso=conversa`)).json().itens.map((s: { id: string }) => s.id);
    expect(conversa[0]).toBe(daEtapa.id);
    expect(conversa).toContain(geral.id);
    expect(conversa).not.toContain(outraEtapa.id);
    expect(conversa).not.toContain(soLigacao.id);
    expect((await vendedor.get(`/api/scripts?contatoId=${contatoId}&uso=ligacao`)).json().itens.map((s: { id: string }) => s.id)).toContain(soLigacao.id);

    expect((await vendedor.post("/api/scripts", { titulo: "x", texto: "y" })).statusCode).toBe(403);
    const outroFunil = (await dono.post("/api/crm/funis", { nome: `Pós-venda ${Date.now()}` })).json();
    expect((await dono.post("/api/scripts", { titulo: "x", texto: "y", funilId: outroFunil.id, etapaId: etapa1.id })).statusCode).toBe(400);
    const arq = await dono.patch(`/api/scripts/${geral.id}`, { arquivar: true });
    expect(arq.json().arquivadoEm).not.toBeNull();
    expect((await vendedor.get(`/api/scripts?contatoId=${contatoId}`)).json().itens.map((s: { id: string }) => s.id)).not.toContain(geral.id);
  });
});
