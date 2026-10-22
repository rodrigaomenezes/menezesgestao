// Gerador de empresa de exemplo (tela /demonstracao). Cria a empresa com o segmento aplicado pela mesma função do
// assistente, pessoas de cada perfil-base e ~90 dias de movimento coerente: contatos, funil, conversas, ligações,
// fila, tarefas, agenda, ponto, check-list, metas, vendas, comissão, qualidade, pesquisa, motor BRE e avisos.
// Os painéis (metas, mapa, ranking, BPI) leem a tabela evento: cada ação fictícia grava o evento que o sistema
// gravaria, com a data em que "aconteceu". Tudo numa transação: falhou, não sobra empresa pela metade.
import { randomBytes, randomUUID } from "node:crypto";
import { SEGMENTOS } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comoSistema, type Tx } from "../../infra/banco.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { criarEmpresa } from "../empresas/criar-empresa.js";
import { criarServicoOnboarding } from "../onboarding/onboarding.servico.js";
import { aceitarNoCadastro } from "../termos/termos.servico.js";
import { criarSorteio, sementeDe, type Sorteio } from "./aleatorio.js";
import { ROTEIROS, type Roteiro, type SegmentoDemonstracao } from "./roteiros.js";

const DIAS = 90;
const CONTATOS = 300;
const DIA = 86_400_000;

type Valor = string | number | boolean | Date | null | object;

/** INSERT em blocos (até ~60 mil parâmetros por comando). Objetos e listas vão como JSON (colunas jsonb). */
async function inserir(tx: Tx, tabela: string, colunas: string[], linhas: Valor[][]): Promise<void> {
  const porBloco = Math.floor(60_000 / colunas.length);
  for (let i = 0; i < linhas.length; i += porBloco) {
    const bloco = linhas.slice(i, i + porBloco);
    const valores: unknown[] = [];
    const tuplas = bloco.map((l) => `(${l.map((v) => (valores.push(v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v), `$${valores.length}`)).join(", ")})`);
    await tx.cliente.query(`INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES ${tuplas.join(", ")}`, valores);
  }
}

interface Pessoa {
  id: string;
  nome: string;
  papel: "dono" | "gestor" | "vendedor" | "operacao" | "financeiro";
  equipe: string | null;
}

const MARCOS_ABERTOS = ["LEAD_IDENTIFIED", "DIAGNOSIS", "PROPOSAL", "NEGOTIATION"] as const;
/** Empresas de exemplo ficam no fuso de São Paulo (UTC−3, sem horário de verão): "hoje" é o dia de lá. */
const FUSO_MS = 3 * 3_600_000;
const dia = (d: Date) => new Date(d.getTime() - FUSO_MS).toISOString().slice(0, 10);
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function gerarEmpresaDemonstracao(s: Servicos, segmento: SegmentoDemonstracao): Promise<{ empresaId: string; resumo: Record<string, number> }> {
  const r = ROTEIROS[segmento];
  const sorte = criarSorteio(sementeDe(segmento));
  const agora = Date.now();

  // 1) Empresa, equipes e pessoas (sem senha: entram pela demonstração).
  const { empresaId, pessoas, dono } = await comoSistema(s.banco, async (tx) => {
    const criada = await criarEmpresa(tx, { atorId: null, ip: null, dispositivo: "demonstracao" }, {
      nome: r.empresa,
      plano: "completo",
      marca: { corPrimaria: r.cor, nomeProduto: r.empresa },
    });
    await tx.cliente.query("UPDATE empresa SET demonstracao = true WHERE id = $1", [criada.empresaId]);
    const equipes = [randomUUID(), randomUUID()];
    const plano: [Pessoa["papel"], number | null][] = [
      ["dono", null],
      ["gestor", 0],
      ["gestor", 1],
      ...[0, 0, 0, 1, 1, 1].map((e) => ["vendedor", e] as [Pessoa["papel"], number]),
      ["operacao", null],
      ["financeiro", null],
    ];
    const lista: Pessoa[] = [];
    for (const [papel, eq] of plano) {
      const p = sorte.pessoa();
      const { rows } = await tx.cliente.query<{ id: string }>("INSERT INTO usuario (email, nome) VALUES ($1, $2) RETURNING id", [
        `${papel}.${randomBytes(4).toString("hex")}@${criada.slug}.example`,
        p.nome,
      ]);
      lista.push({ id: rows[0]!.id, nome: p.nome, papel, equipe: eq === null ? null : equipes[eq]! });
    }
    const gestores = lista.filter((p) => p.papel === "gestor");
    await inserir(tx, "equipe", ["id", "empresa_id", "nome", "gestor_id", "unidade_id"], [
      [equipes[0]!, criada.empresaId, "Equipe Norte", gestores[0]!.id, criada.unidadeId],
      [equipes[1]!, criada.empresaId, "Equipe Sul", gestores[1]!.id, criada.unidadeId],
    ]);
    await inserir(
      tx,
      "vinculo",
      ["empresa_id", "usuario_id", "perfil_id", "unidade_id", "equipe_id", "status"],
      lista.map((p) => [criada.empresaId, p.id, criada.perfis[p.papel], criada.unidadeId, p.equipe, "ativo"]),
    );
    for (const p of lista) await aceitarNoCadastro(tx, p.id, criada.empresaId, null);
    return { empresaId: criada.empresaId, pessoas: lista, dono: lista[0]! };
  });

  // 2) Segmento pela mesma função do assistente (funil, vocabulário, campos, motivos de perda).
  const onboarding = criarServicoOnboarding(s);
  await onboarding.aplicarSegmento({ empresaId, usuarioId: dono.id } as ContextoEmpresa, { empresaId, atorId: dono.id, ip: null, dispositivo: "demonstracao" }, segmento);

  // 3) Movimento de 90 dias.
  const resumo = await comoSistema(s.banco, (tx) => movimento(tx, { empresaId, pessoas, r, sorte, agora }));
  return { empresaId, resumo };
}

interface Contexto {
  empresaId: string;
  pessoas: Pessoa[];
  r: Roteiro;
  sorte: Sorteio;
  agora: number;
}

async function movimento(tx: Tx, c: Contexto): Promise<Record<string, number>> {
  const { empresaId, pessoas, r, sorte, agora } = c;
  /** Momento em São Paulo: `desloc` dias a partir de hoje, às `hora`:`min` de lá. */
  const noDia = (desloc: number, hora: number, min = 0) => {
    const d = new Date(agora - FUSO_MS + desloc * DIA);
    d.setUTCHours(hora + 3, min, 0, 0);
    return d;
  };
  /** Puxa para o expediente (8h–19h em São Paulo) e nunca para depois de agora: atividade fictícia não acontece de madrugada. */
  const expediente = (d: Date): Date => {
    const local = new Date(d.getTime() - FUSO_MS);
    const h = local.getUTCHours();
    if (h >= 8 && h < 19) return d;
    const ajustado = new Date(local);
    if (h >= 19) ajustado.setUTCDate(ajustado.getUTCDate() + 1);
    ajustado.setUTCHours(8 + sorte.inteiro(0, 2), sorte.inteiro(0, 59), 0, 0);
    const t = ajustado.getTime() + FUSO_MS;
    if (t <= agora) return new Date(t);
    // O próximo expediente ainda não chegou: usa um horário de expediente que já passou (hoje ou ontem).
    const hoje = noDia(0, sorte.inteiro(8, 18), sorte.inteiro(0, 59));
    return hoje.getTime() <= agora ? hoje : new Date(hoje.getTime() - DIA);
  };
  const fimDeSemana = (desloc: number) => [0, 6].includes(new Date(agora - FUSO_MS + desloc * DIA).getUTCDay());
  const q = async <T>(sql: string, v: unknown[] = []) => (await tx.cliente.query(sql, v)).rows as T[];
  const vendedores = pessoas.filter((p) => p.papel === "vendedor");
  const gestores = pessoas.filter((p) => p.papel === "gestor");
  const gestorDe = (p: Pessoa) => gestores.find((g) => g.equipe === p.equipe) ?? gestores[0]!;
  const eventos: Valor[][] = [];
  const evento = (tipo: string, quando: Date, e: { ator?: string | null; entidade: string; entidadeId?: string | null; responsavel?: string | null; contato?: string | null; dados?: object }) =>
    eventos.push([randomUUID(), empresaId, tipo, e.ator ?? null, e.entidade, e.entidadeId ?? null, e.responsavel ?? null, e.contato ?? null, e.dados ?? {}, quando]);

  // Funil do segmento: etapas com marco do método BRE (o pacote não traz; a demonstração mostra o motor completo).
  const [funil] = await q<{ id: string }>("SELECT id FROM funil WHERE empresa_id = $1 AND arquivado_em IS NULL ORDER BY ordem, criado_em DESC LIMIT 1", [empresaId]);
  const etapas = await q<{ id: string; nome: string; tipo: "aberta" | "ganha" | "perdida"; ordem: number }>("SELECT id, nome, tipo, ordem FROM etapa WHERE funil_id = $1 ORDER BY ordem", [funil!.id]);
  const abertas = etapas.filter((e) => e.tipo === "aberta");
  const ganha = etapas.find((e) => e.tipo === "ganha")!;
  const perdida = etapas.find((e) => e.tipo === "perdida")!;
  for (const [i, e] of abertas.entries()) await q("UPDATE etapa SET marco_bre = $2 WHERE id = $1", [e.id, MARCOS_ABERTOS[Math.min(i, MARCOS_ABERTOS.length - 1)]]);
  await q("UPDATE etapa SET marco_bre = 'SALE' WHERE id = $1", [ganha.id]);
  await q("UPDATE etapa SET marco_bre = 'CLOSED' WHERE id = $1", [perdida.id]);
  const motivosPerda = await q<{ id: string; nome: string }>("SELECT id, nome FROM motivo_perda WHERE empresa_id = $1 AND arquivado_em IS NULL", [empresaId]);
  const campos = await q<{ entidade: string; chave: string; tipo: string }>("SELECT entidade, chave, tipo FROM campo_personalizado WHERE empresa_id = $1 AND arquivado_em IS NULL", [empresaId]);
  const resultados = await q<{ id: string; nome: string; atendida: boolean; acao: string }>("SELECT id, nome, atendida, acao FROM resultado_ligacao WHERE empresa_id = $1 ORDER BY ordem", [empresaId]);
  const criterios = await q<{ id: string; nome: string; peso: number }>("SELECT id, nome, peso FROM criterio_qualidade WHERE empresa_id = $1", [empresaId]);

  const valorCampo = (chave: string, tipo: string): string | number | boolean | null => {
    if (tipo === "data") return `${sorte.inteiro(1960, 2008)}-${String(sorte.inteiro(1, 12)).padStart(2, "0")}-${String(sorte.inteiro(1, 28)).padStart(2, "0")}`;
    const opcoes = r.campos[chave];
    if (!opcoes) return null;
    const v = sorte.um(opcoes);
    return tipo === "sim_nao" ? v === "sim" : v;
  };
  const camposDe = (entidade: string) =>
    Object.fromEntries(
      campos
        .filter((x) => x.entidade === entidade && sorte.chance(0.8))
        .map((x) => [x.chave, valorCampo(x.chave, x.tipo)])
        .filter(([, v]) => v !== null),
    );

  // Catálogo e entregas.
  const ofertas = r.catalogo.map((i) => ({ ...i, id: randomUUID() }));
  await inserir(
    tx,
    "oferta",
    ["id", "empresa_id", "nome", "preco_centavos", "categoria", "estoque", "lancamento_em", "criado_por"],
    ofertas.map((o, i) => [o.id, empresaId, o.nome, o.precoCentavos, o.categoria, o.estoque ?? null, i === ofertas.length - 1 ? dia(new Date(agora + 5 * DIA)) : null, pessoas[0]!.id]),
  );
  const entregas = ofertas.slice(0, 3).map((o, i) => ({ id: randomUUID(), ofertaId: o.id, nome: `${o.nome} — ${["Turma A", "Turma B", "Turma C"][i]}` }));
  await inserir(
    tx,
    "entrega",
    ["id", "empresa_id", "oferta_id", "nome", "prestador_id", "capacidade", "inicio", "horario"],
    entregas.map((e, i) => [e.id, empresaId, e.ofertaId, e.nome, gestores[i % 2]!.id, 20, dia(new Date(agora + (i + 3) * DIA)), ["Seg e qua, 19h", "Ter e qui, 14h", "Sábado, 9h"][i]!]),
  );
  await inserir(tx, "regra_comissao", ["empresa_id", "nome", "tipo", "percentual"], [[empresaId, "Comissão padrão", "percentual", 5]]);

  // Canal de demonstração conectado.
  const canalId = randomUUID();
  await inserir(tx, "canal", ["id", "empresa_id", "nome", "provedor", "status", "status_em", "numero"], [[canalId, empresaId, "WhatsApp da empresa (exemplo)", "demonstracao", "conectado", new Date(agora), "+5511940000000"]]);

  // Contatos.
  const origens = [["Instagram", 30], ["Indicação", 20], ["Site", 18], ["WhatsApp", 17], ["Google", 10], ["Evento", 5]] as const;
  const contatos = Array.from({ length: CONTATOS }, () => {
    const p = sorte.pessoa();
    const criadoEm = sorte.momento(DIAS, agora);
    const resp = sorte.um(vendedores);
    return { id: randomUUID(), ...p, criadoEm, resp, origem: sorte.pesado(origens), naoContatar: sorte.chance(0.02), compras: [] as string[] };
  });
  await inserir(
    tx,
    "contato",
    ["id", "empresa_id", "nome", "telefone", "email", "origem", "responsavel_id", "campos", "nao_contatar", "criado_por", "criado_em", "atualizado_em"],
    contatos.map((x) => [x.id, empresaId, x.nome, x.telefone, sorte.chance(0.7) ? x.email : null, x.origem, x.resp.id, camposDe("contato"), x.naoContatar, x.resp.id, x.criadoEm, x.criadoEm]),
  );
  for (const x of contatos) evento("contato.criado", x.criadoEm, { ator: x.resp.id, entidade: "contato", entidadeId: x.id, responsavel: x.resp.id, contato: x.id, dados: { nome: x.nome, origem: x.origem } });

  // Oportunidades: andam pelo funil com eventos de cada passo; ganhas viram venda.
  const oportunidades: Valor[][] = [];
  const vendas: Valor[][] = [];
  const participantes: Valor[][] = [];
  let ganhas = 0;
  for (const x of contatos.filter(() => sorte.chance(0.72))) {
    const o = sorte.um(ofertas);
    const id = randomUUID();
    const inicio = new Date(x.criadoEm.getTime() + sorte.inteiro(0, 2) * DIA);
    if (inicio.getTime() > agora) continue;
    const idade = (agora - inicio.getTime()) / DIA;
    const destino = sorte.pesado<"aberta" | "ganha" | "perdida">([
      ["aberta", idade < 20 ? 60 : 30],
      ["ganha", 30],
      ["perdida", 25],
    ]);
    const ateIndice = destino === "aberta" ? sorte.inteiro(0, abertas.length - 1) : sorte.inteiro(1, abertas.length - 1);
    const valor = Math.round(o.precoCentavos * (sorte.chance(0.3) ? 0.9 : 1) * (r.segmento === "varejo" ? sorte.inteiro(2, 12) : 1));
    const titulo = `${o.nome} — ${x.nome.split(" ")[0]}`;
    evento("oportunidade.criada", inicio, { ator: x.resp.id, entidade: "oportunidade", entidadeId: id, responsavel: x.resp.id, contato: x.id, dados: { titulo, valorCentavos: valor } });
    let quando = inicio;
    let anterior = abertas[0]!;
    const passo = (para: (typeof etapas)[number]) => {
      quando = new Date(Math.min(agora - 3_600_000, quando.getTime() + sorte.inteiro(1, 6) * DIA));
      evento("oportunidade.etapa_alterada", quando, {
        ator: x.resp.id,
        entidade: "oportunidade",
        entidadeId: id,
        responsavel: x.resp.id,
        contato: x.id,
        dados: { titulo, etapaAnterior: anterior.nome, etapaNova: para.nome, valorCentavos: valor, oportunidadeId: id, etapaAnteriorId: anterior.id, etapaNovaId: para.id },
      });
      anterior = para;
    };
    for (let i = 1; i <= ateIndice; i++) passo(abertas[i]!);
    let etapa = abertas[ateIndice]!;
    let motivo: { id: string; nome: string } | null = null;
    if (destino !== "aberta") {
      etapa = destino === "ganha" ? ganha : perdida;
      passo(etapa);
      if (destino === "perdida") motivo = sorte.um(motivosPerda);
      evento(`oportunidade.${destino}`, quando, {
        ator: x.resp.id,
        entidade: "oportunidade",
        entidadeId: id,
        responsavel: x.resp.id,
        contato: x.id,
        dados: { titulo, etapaAnterior: abertas[ateIndice]!.nome, etapaNova: etapa.nome, valorCentavos: valor, motivo: motivo?.nome ?? null },
      });
    }
    oportunidades.push([id, empresaId, x.id, funil!.id, etapa.id, titulo, destino, valor, o.nome, x.resp.id, motivo?.id ?? null, destino === "aberta" ? null : quando, camposDe("oportunidade"), x.resp.id, inicio, quando]);
    if (destino === "ganha") {
      ganhas++;
      const recente = agora - quando.getTime() < 4 * DIA;
      const status = recente && sorte.chance(0.5) ? "pendente" : sorte.chance(0.05) ? "cancelada" : "confirmada";
      const vendaId = randomUUID();
      const entrega = entregas.find((e) => e.ofertaId === o.id && sorte.chance(0.6));
      vendas.push([vendaId, empresaId, x.id, o.id, x.resp.id, id, entrega?.id ?? null, valor, sorte.pesado([["pix", 40], ["cartao", 35], ["boleto", 20], ["transferencia", 5]] as const), sorte.chance(0.3) ? sorte.inteiro(2, 10) : 1, status, dia(quando), status === "cancelada" ? "Desistiu antes do início" : null, x.resp.id, quando]);
      if (entrega && status !== "cancelada") participantes.push([empresaId, entrega.id, x.id, vendaId, "ativo", x.resp.id]);
      evento("venda.registrada", quando, { ator: x.resp.id, entidade: "venda", entidadeId: vendaId, responsavel: x.resp.id, contato: x.id, dados: { valorCentavos: valor, oferta: o.nome, titulo: `Venda: ${o.nome}` } });
      if (status === "confirmada") {
        x.compras.push(dia(quando));
        evento("venda.confirmada", quando, { ator: pessoas.find((p) => p.papel === "financeiro")!.id, entidade: "venda", entidadeId: vendaId, responsavel: x.resp.id, contato: x.id, dados: { valorCentavos: valor, oferta: o.nome, titulo: `Venda: ${o.nome}` } });
      }
    }
  }
  await inserir(
    tx,
    "oportunidade",
    ["id", "empresa_id", "contato_id", "funil_id", "etapa_id", "titulo", "status", "valor_centavos", "oferta", "responsavel_id", "motivo_perda_id", "fechada_em", "campos", "criado_por", "criado_em", "atualizado_em"],
    oportunidades,
  );
  await inserir(
    tx,
    "venda",
    ["id", "empresa_id", "contato_id", "oferta_id", "vendedor_id", "oportunidade_id", "entrega_id", "valor_centavos", "forma_pagamento", "parcelas", "status", "data_venda", "motivo_cancelamento", "criado_por", "criado_em"],
    vendas,
  );
  await inserir(tx, "entrega_participante", ["empresa_id", "entrega_id", "contato_id", "venda_id", "status", "criado_por"], participantes);

  // Estado do cliente no método BRE, igual ao que a rotina diária calcularia a partir das vendas confirmadas.
  for (const x of contatos.filter((y) => y.compras.length)) {
    const ultima = x.compras.sort().at(-1)!;
    const diasDesde = (agora - Date.parse(`${ultima}T12:00:00Z`)) / DIA;
    const estado = diasDesde > 120 ? "INACTIVE" : x.compras.length === 1 ? (diasDesde <= 45 ? "RECENT" : "ABOUT_TO_SLEEP") : diasDesde <= 60 ? "ACTIVE" : "ABOUT_TO_SLEEP";
    await q("UPDATE contato SET compras_qtd = $2, ultima_entrega_em = $3, estado_bre = $4, estado_bre_em = now() WHERE id = $1", [x.id, x.compras.length, ultima, estado]);
  }

  // Conversas de WhatsApp: troca de mensagens do ramo; parte espera resposta (aparece no Início de quem atende).
  const conversas: Valor[][] = [];
  const mensagens: Valor[][] = [];
  const conversasIds: { id: string; resp: Pessoa; contato: string; quando: Date }[] = [];
  const preencher = (t: string) => {
    const o = sorte.um(ofertas);
    return t.replaceAll("{produto}", o.nome).replaceAll("{preco}", reais(o.precoCentavos));
  };
  for (const x of contatos.filter(() => sorte.chance(0.62))) {
    const id = randomUUID();
    let quando = expediente(new Date(Math.max(x.criadoEm.getTime(), agora - DIAS * DIA)));
    const n = sorte.inteiro(3, 11);
    let ultimaEntrada: Date | null = null;
    let ultima = "";
    let ultimaEm = quando;
    for (let i = 0; i < n; i++) {
      const entrada = i % 2 === 0;
      quando = expediente(new Date(Math.min(agora - 60_000 * (n - i), quando.getTime() + sorte.inteiro(2, 240) * 60_000 + (sorte.chance(0.15) ? DIA : 0))));
      const texto = preencher(entrada ? (i === 0 ? sorte.um(r.entrada) : sorte.um(r.respostas)) : sorte.um(r.saida));
      const msgId = randomUUID();
      mensagens.push([msgId, empresaId, id, canalId, entrada ? "entrada" : "saida", "texto", entrada ? "recebida" : sorte.pesado([["lida", 70], ["entregue", 25], ["enviada", 5]] as const), texto, entrada ? null : x.resp.id, quando]);
      if (entrada) {
        ultimaEntrada = quando;
        evento("mensagem.recebida", quando, { entidade: "conversa", entidadeId: id, responsavel: x.resp.id, contato: x.id, dados: { mensagemId: msgId, tipo: "texto", resumo: texto.slice(0, 120) } });
      } else {
        evento("mensagem.criada", quando, { ator: x.resp.id, entidade: "conversa", entidadeId: id, responsavel: x.resp.id, contato: x.id, dados: { mensagemId: msgId, tipo: "texto", automacao: null, resumo: texto.slice(0, 120) } });
      }
      ultima = texto.slice(0, 120);
      ultimaEm = quando;
    }
    const recente = agora - ultimaEm.getTime() < 3 * DIA;
    const status = recente ? (n % 2 === 1 ? "aberta" : "aguardando") : sorte.pesado([["resolvida", 75], ["aguardando", 15], ["aberta", 10]] as const);
    if (status === "resolvida") evento("conversa.resolvida", expediente(new Date(Math.min(agora - 60_000, ultimaEm.getTime() + 3_600_000))), { ator: x.resp.id, entidade: "conversa", entidadeId: id, responsavel: x.resp.id, contato: x.id });
    conversas.push([id, empresaId, canalId, x.id, x.telefone, x.resp.id, x.resp.equipe, status, status === "aberta" && n % 2 === 1 ? sorte.inteiro(1, 3) : 0, ultima, ultimaEm, ultimaEntrada, x.criadoEm]);
    conversasIds.push({ id, resp: x.resp, contato: x.id, quando: ultimaEm });
  }
  await inserir(
    tx,
    "conversa",
    ["id", "empresa_id", "canal_id", "contato_id", "telefone", "atribuida_a", "equipe_id", "status", "nao_lidas", "ultima_mensagem", "ultima_mensagem_em", "ultima_entrada_em", "criado_em"],
    conversas,
  );
  await inserir(tx, "mensagem", ["id", "empresa_id", "conversa_id", "canal_id", "direcao", "tipo", "status", "texto", "autor_id", "criado_em"], mensagens);

  // Ligações: rotina diária de cada vendedor, com resultado e duração.
  const ligacoes: Valor[][] = [];
  const ligacoesIds: { id: string; vendedor: Pessoa; quando: Date }[] = [];
  const pesoResultado = (nome: string) => (/Atendeu/.test(nome) ? 40 : /Não atendeu/.test(nome) ? 30 : /Caixa/.test(nome) ? 12 : /Retornar/.test(nome) ? 8 : /Convertido/.test(nome) ? 4 : 3);
  for (const v of vendedores) {
    for (let d = DIAS; d >= 0; d--) {
      if (fimDeSemana(-d)) continue;
      for (let k = sorte.inteiro(4, 14); k > 0; k--) {
        const quando = new Date(noDia(-d, sorte.inteiro(8, 18), sorte.inteiro(0, 59)).getTime() + sorte.inteiro(0, 59) * 1000);
        if (quando.getTime() > agora) continue;
        const x = sorte.um(contatos);
        const res = sorte.pesado(resultados.map((y) => [y, pesoResultado(y.nome)] as const));
        const duracao = res.atendida ? sorte.inteiro(45, 720) : sorte.inteiro(5, 35);
        const id = randomUUID();
        const fim = new Date(quando.getTime() + duracao * 1000);
        ligacoes.push([id, empresaId, v.id, x.id, "treino", "saida", x.telefone, "encerrada", quando, res.atendida ? new Date(quando.getTime() + 8000) : null, fim, duracao, res.atendida ? "desligada" : "sem_resposta", res.id, sorte.chance(0.3) ? sorte.um(r.notasLigacao) : null]);
        evento("ligacao.encerrada", fim, { ator: v.id, entidade: "ligacao", entidadeId: id, responsavel: v.id, contato: x.id, dados: { numero: x.telefone, provedor: "treino", atendida: res.atendida, duracaoSegundos: duracao, motivo: res.atendida ? "desligada" : "sem_resposta" } });
        ligacoesIds.push({ id, vendedor: v, quando: fim });
      }
    }
  }
  await inserir(
    tx,
    "ligacao",
    ["id", "empresa_id", "usuario_id", "contato_id", "provedor", "direcao", "numero", "estado", "iniciada_em", "atendida_em", "encerrada_em", "duracao_segundos", "motivo_fim", "resultado_id", "observacao"],
    ligacoes,
  );

  // Fila de ligações: itens trabalhados (com retorno para hoje no Início) e pendentes.
  const filaId = randomUUID();
  const [tipoBase] = await q<{ id: string }>("SELECT id FROM tipo_base WHERE empresa_id = $1 ORDER BY criado_em LIMIT 1", [empresaId]);
  await inserir(tx, "fila", ["id", "empresa_id", "nome", "status", "tipo_base_id", "criado_por"], [[filaId, empresaId, "Leads da semana", "ativa", tipoBase?.id ?? null, gestores[0]!.id]]);
  const naFila = contatos.filter((x) => !x.naoContatar).slice(0, 60);
  const itens: Valor[][] = [];
  const reagendar = resultados.find((y) => y.acao === "reagendar") ?? resultados[0]!;
  for (const [i, x] of naFila.entries()) {
    const id = randomUUID();
    const trabalhado = i < 25;
    itens.push([id, empresaId, filaId, x.id, trabalhado ? "pendente" : "pendente", trabalhado ? sorte.inteiro(1, 3) : 0, trabalhado ? reagendar.id : null, trabalhado ? noDia(0, sorte.inteiro(9, 17), sorte.chance(0.5) ? 0 : 30) : null, sorte.inteiro(0, 5)]);
    if (trabalhado) {
      evento("fila.resultado_registrado", expediente(new Date(agora - sorte.inteiro(1, 48) * 3_600_000)), {
        ator: x.resp.id,
        entidade: "fila_item",
        entidadeId: id,
        responsavel: x.resp.id,
        contato: x.id,
        dados: { titulo: x.nome, resultado: reagendar.nome, acao: reagendar.acao, filaId, observacao: sorte.um(r.notasLigacao) },
      });
    }
  }
  await inserir(tx, "fila_item", ["id", "empresa_id", "fila_id", "contato_id", "status", "tentativas", "ultimo_resultado_id", "retornar_em", "prioridade"], itens);
  for (let k = 0; k < 220; k++) {
    const x = sorte.um(naFila);
    evento("fila.resultado_registrado", sorte.momento(DIAS, agora), { ator: x.resp.id, entidade: "fila_item", entidadeId: randomUUID(), responsavel: x.resp.id, contato: x.id, dados: { titulo: x.nome, resultado: sorte.um(resultados).nome, filaId } });
  }

  // Tarefas: concluídas no passado, atrasadas, de hoje e futuras para cada vendedor.
  const tarefas: Valor[][] = [];
  for (const v of vendedores) {
    const carteira = contatos.filter((x) => x.resp.id === v.id);
    for (let k = 0; k < 40; k++) {
      const x = sorte.um(carteira);
      const tipo = k < 28 ? "feita" : k < 31 ? "atrasada" : k < 36 ? "hoje" : "futura";
      const vence =
        tipo === "feita" ? sorte.momento(DIAS, agora) : tipo === "atrasada" ? noDia(-sorte.inteiro(1, 4), sorte.inteiro(9, 17)) : tipo === "hoje" ? noDia(0, sorte.inteiro(9, 18), 0) : noDia(sorte.inteiro(1, 10), sorte.inteiro(9, 17));
      const id = randomUUID();
      const concluida = tipo === "feita" ? expediente(new Date(vence.getTime() - sorte.inteiro(0, 20) * 3_600_000)) : null;
      tarefas.push([id, empresaId, x.id, sorte.um(r.tarefas), v.id, vence, concluida, v.id, new Date(vence.getTime() - 2 * DIA)]);
      if (concluida) evento("tarefa.concluida", concluida, { ator: v.id, entidade: "tarefa", entidadeId: id, responsavel: v.id, contato: x.id });
    }
  }
  await inserir(tx, "tarefa", ["id", "empresa_id", "contato_id", "titulo", "responsavel_id", "vence_em", "concluida_em", "criado_por", "criado_em"], tarefas);

  // Agenda: compromissos de hoje e da semana para todos.
  const compromissos: Valor[][] = [];
  for (const p of pessoas) {
    for (let k = 0; k < 8; k++) {
      const offset = k < 2 ? 0 : sorte.inteiro(-10, 7);
      const ini = noDia(offset, sorte.inteiro(9, 17), sorte.chance(0.5) ? 0 : 30);
      const x = sorte.um(contatos);
      compromissos.push([empresaId, p.id, x.id, `${sorte.um(["Reunião com", "Retorno para", "Apresentação para", "Visita a"])} ${x.nome.split(" ")[0]}`, ini, new Date(ini.getTime() + sorte.inteiro(1, 3) * 1_800_000)]);
    }
  }
  await inserir(tx, "compromisso", ["empresa_id", "usuario_id", "contato_id", "titulo", "inicio", "fim"], compromissos);

  // Ponto dos últimos 30 dias (validado); hoje, quem atende já bateu a entrada.
  const horas: Valor[][] = [];
  for (const p of pessoas) {
    for (let d = 30; d >= 1; d--) {
      if (fimDeSemana(-d)) continue;
      const entrada = noDia(-d, 8, sorte.inteiro(0, 40));
      const saida = new Date(entrada.getTime() + (8 * 60 + sorte.inteiro(30, 90)) * 60_000);
      horas.push([empresaId, p.id, dia(entrada), entrada, saida, "validado"]);
    }
    if (p.papel === "vendedor" || p.papel === "gestor") {
      const entrada = noDia(0, 8, sorte.inteiro(0, 30));
      if (entrada.getTime() < agora) horas.push([empresaId, p.id, dia(entrada), entrada, null, "aberto"]);
    }
  }
  await inserir(tx, "registro_horas", ["empresa_id", "usuario_id", "data", "entrada", "saida", "status"], horas);

  // Check-list do dia.
  const itensCheck = ["Responder conversas da manhã", "Ligar para os retornos do dia", "Atualizar o funil", "Registrar as conversas no método BRE"].map((texto, ordem) => ({ id: randomUUID(), texto, ordem }));
  await inserir(tx, "checklist_item", ["id", "empresa_id", "texto", "ordem", "perfil_id"], itensCheck.map((i) => [i.id, empresaId, i.texto, i.ordem, null]));
  const marcacoes: Valor[][] = [];
  for (const v of vendedores) {
    for (let d = 20; d >= 1; d--) {
      if (fimDeSemana(-d)) continue;
      for (const i of itensCheck) marcacoes.push([empresaId, i.id, v.id, dia(noDia(-d, 12)), sorte.chance(0.85)]);
    }
  }
  await inserir(tx, "checklist_marcacao", ["empresa_id", "item_id", "usuario_id", "data", "feito"], marcacoes);

  // Metas: empresa, equipes e cada vendedor.
  const ticket = Math.round(r.catalogo.reduce((t, i) => t + i.precoCentavos, 0) / r.catalogo.length / 100);
  const metas: Valor[][] = [
    [empresaId, "empresa", null, null, "valor_vendido", "mes", ticket * 45],
    [empresaId, "empresa", null, null, "vendas", "mes", 45],
    ...[...new Set(vendedores.map((v) => v.equipe!))].map((eq) => [empresaId, "equipe", null, eq, "ligacoes", "semana", 180] as Valor[]),
    ...vendedores.flatMap((v) => [
      [empresaId, "pessoa", v.id, null, "ligacoes", "dia", 12],
      [empresaId, "pessoa", v.id, null, "mensagens", "dia", 15],
      [empresaId, "pessoa", v.id, null, "vendas", "mes", 8],
    ]),
  ];
  await inserir(tx, "meta", ["empresa_id", "alvo", "usuario_id", "equipe_id", "indicador", "periodo", "valor"], metas);

  // Qualidade: gestores avaliam conversas e ligações da equipe.
  const avaliacoes: Valor[][] = [];
  for (let k = 0; k < 45; k++) {
    const porLigacao = k % 2 === 0;
    const alvo = porLigacao ? sorte.um(ligacoesIds) : sorte.um(conversasIds);
    const avaliado = porLigacao ? (alvo as (typeof ligacoesIds)[number]).vendedor : (alvo as (typeof conversasIds)[number]).resp;
    const notas = criterios.map((cr) => ({ criterioId: cr.id, nome: cr.nome, peso: cr.peso, nota: sorte.inteiro(6, 10) }));
    const final = notas.reduce((t, n) => t + n.nota * n.peso, 0) / notas.reduce((t, n) => t + n.peso, 0);
    avaliacoes.push([empresaId, porLigacao ? null : alvo.id, porLigacao ? alvo.id : null, avaliado.id, gestorDe(avaliado).id, notas, Math.round(final * 100) / 100, sorte.um(["Boa abordagem, faltou confirmar o próximo passo.", "Excelente escuta.", "Apresentou o valor antes do preço, muito bem.", "Pode ser mais objetivo no fechamento."]), new Date(alvo.quando.getTime() + DIA)]);
  }
  await inserir(tx, "avaliacao", ["empresa_id", "conversa_id", "ligacao_id", "avaliado_id", "avaliador_id", "notas", "nota_final", "feedback", "criado_em"], avaliacoes);

  // Pesquisa de satisfação com respostas.
  const pesquisaId = randomUUID();
  await inserir(tx, "pesquisa", ["id", "empresa_id", "titulo", "perguntas", "token", "aberta", "criado_por"], [
    [
      pesquisaId,
      empresaId,
      "Como foi o seu atendimento?",
      [
        { id: "nota", tipo: "nota", texto: "De 0 a 10, quanto você recomendaria a gente?", obrigatoria: true },
        { id: "canal", tipo: "escolha", texto: "Como nos conheceu?", opcoes: ["Instagram", "Indicação", "Google", "Outro"], obrigatoria: false },
        { id: "comentario", tipo: "texto", texto: "Quer deixar um comentário?", obrigatoria: false },
      ],
      randomBytes(24).toString("base64url"),
      true,
      pessoas[0]!.id,
    ],
  ]);
  await inserir(
    tx,
    "resposta_pesquisa",
    ["empresa_id", "pesquisa_id", "respostas", "criado_em"],
    Array.from({ length: 70 }, () => [empresaId, pesquisaId, { nota: sorte.pesado([[10, 35], [9, 25], [8, 15], [7, 10], [6, 6], [5, 4], [3, 5]] as const), canal: sorte.um(["Instagram", "Indicação", "Google", "Outro"]), ...(sorte.chance(0.4) ? { comentario: sorte.um(["Atendimento rápido!", "Gostei muito.", "Poderiam responder mais rápido.", "Equipe muito atenciosa."]) } : {}) }, sorte.momento(DIAS, agora)]),
  );

  // Motor BRE: meta de receita, registros de conversa e reentradas combinadas.
  await inserir(tx, "bre_config", ["empresa_id", "config"], [[empresaId, { metaReceitaCentavos: ticket * 100 * 8 }]]);
  const registros: Valor[][] = [];
  for (const conv of conversasIds.filter(() => sorte.chance(0.7))) {
    const resultado = sorte.pesado([["ADVANCED", 35], ["REPLIED_NO_ADVANCE", 25], ["NO_REPLY", 20], ["PURCHASED", 15], ["OPTED_OUT", 5]] as const);
    const of = sorte.um(ofertas);
    const proxima = resultado === "OPTED_OUT" ? "CLOSE_NO_INTEREST" : sorte.um(["SEND_CATALOG", "CALL_BACK", "REMINDER", "SCHEDULE_TALK"] as const);
    const retorno = proxima === "CLOSE_NO_INTEREST" ? null : dia(new Date(conv.quando.getTime() + sorte.inteiro(2, 15) * DIA));
    registros.push([
      empresaId,
      conv.contato,
      conv.resp.id,
      conv.id,
      resultado,
      sorte.pesado([["WARM", 35], ["HOT", 30], ["COLD", 25], ["READY_TO_BUY", 10]] as const),
      sorte.um(["CURIOUS", "INTERESTED", "WARY", "EXCITED", "CONVINCED"]),
      proxima,
      sorte.chance(0.6) ? ["CONFIRMATION", "AGREEMENT"] : ["CONFIRMATION"],
      of.id,
      retorno,
      sorte.inteiro(15, 45),
      new Date(conv.quando.getTime() + 600_000),
    ]);
  }
  await inserir(tx, "registro_bre", ["empresa_id", "contato_id", "autor_id", "conversa_id", "resultado", "temperatura", "estado_emocional", "proxima_acao", "sins", "interesse_oferta_id", "retorno_em", "segundos", "criado_em"], registros);
  await inserir(
    tx,
    "reentrada",
    ["empresa_id", "contato_id", "tipo", "motivo", "prevista_para", "status"],
    contatos.filter((x) => !x.naoContatar).slice(100, 125).map((x, i) => [empresaId, x.id, "TIME", sorte.um(["Pediu para falar no próximo mês", "Aguardando o resultado do orçamento", "Volta das férias"]), dia(new Date(agora - (i % 5) * DIA)), "pendente"]),
  );

  // Avisos no sino.
  const avisos: Valor[][] = [];
  for (const p of pessoas) {
    for (let k = 0; k < 6; k++) {
      const quando = expediente(new Date(agora - sorte.inteiro(0, 72) * 3_600_000));
      const [titulo, link] = sorte.um([
        ["Nova conversa atribuída a você", "/conversas"],
        ["Retorno de ligação para hoje", "/filas"],
        ["Meta do dia quase batida", "/desempenho"],
        ["Venda confirmada pelo financeiro", "/vendas"],
        ["Nova avaliação de qualidade", "/qualidade"],
      ] as const);
      avisos.push([empresaId, p.id, titulo, link, k < 3 ? null : quando, quando]);
    }
  }
  await inserir(tx, "notificacao", ["empresa_id", "usuario_id", "titulo", "link", "lida_em", "criado_em"], avisos);

  await inserir(tx, "evento", ["id", "empresa_id", "tipo", "ator_id", "entidade", "entidade_id", "responsavel_id", "contato_id", "dados", "criado_em"], eventos);

  return {
    pessoas: pessoas.length,
    contatos: contatos.length,
    oportunidades: oportunidades.length,
    vendas: ganhas,
    conversas: conversas.length,
    mensagens: mensagens.length,
    ligacoes: ligacoes.length,
    tarefas: tarefas.length,
    eventos: eventos.length,
  };
}

/** Nome do segmento para a tela (o pacote do sistema). */
export const nomeSegmento = (id: SegmentoDemonstracao) => SEGMENTOS.find((x) => x.id === id)?.nome ?? id;
