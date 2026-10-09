// Espelho em Drizzle das tabelas criadas em migracoes/*.sql (as migrações SQL são a fonte da verdade).
import { bigint, boolean, customType, date, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, time, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (nome: string) => timestamp(nome, { withTimezone: true, precision: 3 });
const criadoEm = () => ts("criado_em").notNull().defaultNow();
const atualizadoEm = () => ts("atualizado_em").notNull().defaultNow();

export const empresa = pgTable("empresa", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  slug: text("slug").notNull(),
  marca: jsonb("marca").notNull().default({}),
  dominio: text("dominio"),
  fuso: text("fuso").notNull().default("America/Sao_Paulo"),
  plano: text("plano").notNull().default("essencial"),
  modulos: jsonb("modulos").$type<string[]>().notNull().default([]),
  vocabulario: jsonb("vocabulario").notNull().default({}),
  onboarding: jsonb("onboarding").$type<{ passo?: number; segmento?: string; concluidoEm?: string }>().notNull().default({}),
  exigirDuasEtapas: text("exigir_duas_etapas").$type<"nao" | "admins" | "todos">().notNull().default("nao"),
  retencao: jsonb("retencao").$type<{ mensagensMeses?: number | null; arquivadosMeses?: number | null }>().notNull().default({}),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const usuario = pgTable("usuario", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  nome: text("nome").notNull(),
  senhaHash: text("senha_hash"),
  tentativasFalhas: integer("tentativas_falhas").notNull().default(0),
  bloqueadoAte: ts("bloqueado_ate"),
  duasEtapasMetodo: text("duas_etapas_metodo").$type<"totp" | "email">(),
  duasEtapasSegredo: text("duas_etapas_segredo"),
  duasEtapasUltimoPasso: bigint("duas_etapas_ultimo_passo", { mode: "number" }),
  duasEtapasRecuperacao: text("duas_etapas_recuperacao").array().notNull().default([]),
  duasEtapasAtivadaEm: ts("duas_etapas_ativada_em"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const unidade = pgTable("unidade", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  endereco: text("endereco"),
  horario: jsonb("horario").notNull().default({}),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const equipe = pgTable("equipe", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  unidadeId: uuid("unidade_id"),
  nome: text("nome").notNull(),
  gestorId: uuid("gestor_id"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const perfil = pgTable("perfil", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  base: text("base"),
  protegido: boolean("protegido").notNull().default(false),
  /** Obsoleta desde a migração 0002 (ADR-006): as permissões ficam na tabela permissao. */
  permissoes: jsonb("permissoes").notNull().default({}),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const permissao = pgTable("permissao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  perfilId: uuid("perfil_id").notNull(),
  modulo: text("modulo").notNull(),
  acao: text("acao").notNull(),
  escopo: text("escopo").notNull(),
  criadoEm: criadoEm(),
});

export const vinculo = pgTable("vinculo", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  perfilId: uuid("perfil_id").notNull(),
  unidadeId: uuid("unidade_id"),
  equipeId: uuid("equipe_id"),
  status: text("status").$type<"convidado" | "ativo">().notNull().default("convidado"),
  convidadoPor: uuid("convidado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const sessao = pgTable("sessao", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  empresaId: uuid("empresa_id"),
  ip: text("ip"),
  dispositivo: text("dispositivo"),
  criadoEm: criadoEm(),
  ultimoUso: ts("ultimo_uso").notNull().defaultNow(),
  expiraEm: ts("expira_em").notNull(),
  encerradaEm: ts("encerrada_em"),
});

export const tokenAcesso = pgTable("token_acesso", {
  id: uuid("id").primaryKey().defaultRandom(),
  tipo: text("tipo").$type<"convite" | "recuperacao">().notNull(),
  tokenHash: text("token_hash").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  empresaId: uuid("empresa_id"),
  criadoEm: criadoEm(),
  expiraEm: ts("expira_em").notNull(),
  usadoEm: ts("usado_em"),
});

export const desafioLogin = pgTable("desafio_login", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash"),
  usuarioId: uuid("usuario_id").notNull(),
  empresaId: uuid("empresa_id"),
  finalidade: text("finalidade").$type<"entrar" | "configurar">().notNull(),
  metodo: text("metodo").$type<"totp" | "email">().notNull(),
  codigoHash: text("codigo_hash"),
  segredoNovo: text("segredo_novo"),
  tentativas: integer("tentativas").notNull().default(0),
  envios: integer("envios").notNull().default(1),
  criadoEm: criadoEm(),
  expiraEm: ts("expira_em").notNull(),
  usadoEm: ts("usado_em"),
});

export const evento = pgTable("evento", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  tipo: text("tipo").notNull(),
  atorId: uuid("ator_id"),
  entidade: text("entidade").notNull(),
  entidadeId: uuid("entidade_id"),
  responsavelId: uuid("responsavel_id"),
  paraUsuarioId: uuid("para_usuario_id"),
  contatoId: uuid("contato_id"),
  dados: jsonb("dados").notNull().default({}),
  criadoEm: criadoEm(),
});

export const auditoria = pgTable("auditoria", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id"),
  atorId: uuid("ator_id"),
  acao: text("acao").notNull(),
  entidade: text("entidade").notNull(),
  entidadeId: uuid("entidade_id"),
  antes: jsonb("antes"),
  depois: jsonb("depois"),
  ip: text("ip"),
  dispositivo: text("dispositivo"),
  criadoEm: criadoEm(),
});

export const notificacao = pgTable("notificacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  titulo: text("titulo").notNull(),
  texto: text("texto"),
  link: text("link"),
  lidaEm: ts("lida_em"),
  criadoEm: criadoEm(),
});

export const avisoSaida = pgTable("aviso_saida", {
  id: uuid("id").primaryKey().defaultRandom(),
  canal: text("canal").notNull().default("email"),
  para: text("para").notNull(),
  assunto: text("assunto").notNull(),
  texto: text("texto").notNull(),
  criadoEm: criadoEm(),
});

// Fase 1 — CRM -------------------------------------------------------------------------------------

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const arquivo = pgTable("arquivo", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  tipoMime: text("tipo_mime").notNull(),
  tamanho: integer("tamanho").notNull(),
  provedor: text("provedor").notNull().default("banco"),
  conteudo: bytea("conteudo"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const campoPersonalizado = pgTable("campo_personalizado", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  entidade: text("entidade").$type<"contato" | "oportunidade">().notNull(),
  chave: text("chave").notNull(),
  rotulo: text("rotulo").notNull(),
  tipo: text("tipo").$type<"texto" | "numero" | "data" | "lista" | "sim_nao">().notNull(),
  opcoes: jsonb("opcoes").$type<string[]>().notNull().default([]),
  obrigatorio: boolean("obrigatorio").notNull().default(false),
  ordem: integer("ordem").notNull().default(0),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const etiqueta = pgTable("etiqueta", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  cor: text("cor").notNull().default("#5b6470"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const funil = pgTable("funil", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  ordem: integer("ordem").notNull().default(0),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const etapa = pgTable("etapa", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  funilId: uuid("funil_id").notNull(),
  nome: text("nome").notNull(),
  cor: text("cor").notNull().default("#1f5fbf"),
  ordem: integer("ordem").notNull().default(0),
  probabilidade: integer("probabilidade").notNull().default(0),
  tipo: text("tipo").$type<"aberta" | "ganha" | "perdida">().notNull().default("aberta"),
  camposObrigatorios: jsonb("campos_obrigatorios").$type<string[]>().notNull().default([]),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const motivoPerda = pgTable("motivo_perda", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  ordem: integer("ordem").notNull().default(0),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const contato = pgTable("contato", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  tipo: text("tipo").$type<"pessoa" | "empresa">().notNull().default("pessoa"),
  nome: text("nome").notNull(),
  telefone: text("telefone"),
  email: text("email"),
  organizacaoId: uuid("organizacao_id"),
  responsavelId: uuid("responsavel_id"),
  origem: text("origem"),
  campos: jsonb("campos").$type<Record<string, unknown>>().notNull().default({}),
  naoContatar: boolean("nao_contatar").notNull().default(false),
  consentimentoEm: ts("consentimento_em"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  anonimizadoEm: ts("anonimizado_em"),
  arquivadoEm: ts("arquivado_em"),
});

export const contatoEtiqueta = pgTable(
  "contato_etiqueta",
  {
    empresaId: uuid("empresa_id").notNull(),
    contatoId: uuid("contato_id").notNull(),
    etiquetaId: uuid("etiqueta_id").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [primaryKey({ columns: [t.contatoId, t.etiquetaId] })],
);

export const oportunidade = pgTable("oportunidade", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  contatoId: uuid("contato_id").notNull(),
  funilId: uuid("funil_id").notNull(),
  etapaId: uuid("etapa_id").notNull(),
  titulo: text("titulo").notNull(),
  valorCentavos: bigint("valor_centavos", { mode: "number" }),
  oferta: text("oferta"),
  responsavelId: uuid("responsavel_id"),
  status: text("status").$type<"aberta" | "ganha" | "perdida">().notNull().default("aberta"),
  motivoPerdaId: uuid("motivo_perda_id"),
  fechadaEm: ts("fechada_em"),
  campos: jsonb("campos").$type<Record<string, unknown>>().notNull().default({}),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const tarefa = pgTable("tarefa", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  contatoId: uuid("contato_id"),
  oportunidadeId: uuid("oportunidade_id"),
  titulo: text("titulo").notNull(),
  descricao: text("descricao"),
  responsavelId: uuid("responsavel_id"),
  venceEm: ts("vence_em"),
  concluidaEm: ts("concluida_em"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const nota = pgTable("nota", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  contatoId: uuid("contato_id").notNull(),
  oportunidadeId: uuid("oportunidade_id"),
  texto: text("texto").notNull(),
  autorId: uuid("autor_id"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const importacao = pgTable("importacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  arquivoId: uuid("arquivo_id").notNull(),
  nomeArquivo: text("nome_arquivo").notNull(),
  status: text("status")
    .$type<"PRONTA" | "PENDENTE" | "PROCESSANDO" | "CONCLUIDA" | "CONCLUIDA_COM_ERROS" | "FALHOU">()
    .notNull()
    .default("PRONTA"),
  colunas: jsonb("colunas").$type<string[]>().notNull().default([]),
  amostra: jsonb("amostra").$type<string[][]>().notNull().default([]),
  totalLinhas: integer("total_linhas").notNull().default(0),
  mapeamento: jsonb("mapeamento").$type<Record<string, string>>(),
  opcoes: jsonb("opcoes").$type<Record<string, unknown>>(),
  novos: integer("novos").notNull().default(0),
  atualizados: integer("atualizados").notNull().default(0),
  inalterados: integer("inalterados").notNull().default(0),
  ignorados: integer("ignorados").notNull().default(0),
  erros: jsonb("erros").$type<{ linha: number; motivo: string }[]>().notNull().default([]),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  concluidaEm: ts("concluida_em"),
  filaId: uuid("fila_id"),
});

// Conversas (fase 2) -------------------------------------------------------------------------------

export type ProvedorCanal = "demonstracao" | "cloud_api" | "qr";
export type StatusCanal = "desconectado" | "conectando" | "aguardando_qr" | "conectado" | "erro";
export interface HorarioCanal {
  dias: number[];
  inicio: string;
  fim: string;
}

export const canal = pgTable("canal", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  provedor: text("provedor").$type<ProvedorCanal>().notNull(),
  numero: text("numero"),
  identificadorExterno: text("identificador_externo"),
  credenciais: text("credenciais"),
  status: text("status").$type<StatusCanal>().notNull().default("desconectado"),
  statusDetalhe: text("status_detalhe"),
  statusEm: ts("status_em").notNull().defaultNow(),
  horario: jsonb("horario").$type<HorarioCanal>().notNull(),
  equipeId: uuid("equipe_id"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const canalSessao = pgTable(
  "canal_sessao",
  {
    canalId: uuid("canal_id").notNull(),
    empresaId: uuid("empresa_id").notNull(),
    chave: text("chave").notNull(),
    valor: text("valor").notNull(),
    atualizadoEm: atualizadoEm(),
  },
  (t) => [primaryKey({ columns: [t.canalId, t.chave] })],
);

export type StatusConversa = "aberta" | "aguardando" | "resolvida";

export const conversa = pgTable("conversa", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  canalId: uuid("canal_id").notNull(),
  contatoId: uuid("contato_id"),
  telefone: text("telefone"),
  idsExternos: text("ids_externos").array().notNull().default([]),
  atribuidaA: uuid("atribuida_a"),
  equipeId: uuid("equipe_id"),
  status: text("status").$type<StatusConversa>().notNull().default("aberta"),
  naoLidas: integer("nao_lidas").notNull().default(0),
  ultimaMensagemEm: ts("ultima_mensagem_em"),
  ultimaMensagem: text("ultima_mensagem"),
  ultimaEntradaEm: ts("ultima_entrada_em"),
  mescladaEmId: uuid("mesclada_em_id"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export type DirecaoMensagem = "entrada" | "saida" | "nota";
export type TipoMensagem = "texto" | "imagem" | "audio" | "video" | "documento" | "sistema";
export type StatusMensagem = "pendente" | "enviada" | "entregue" | "lida" | "falhou" | "recebida";

export const mensagem = pgTable("mensagem", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  conversaId: uuid("conversa_id").notNull(),
  canalId: uuid("canal_id").notNull(),
  direcao: text("direcao").$type<DirecaoMensagem>().notNull(),
  tipo: text("tipo").$type<TipoMensagem>().notNull(),
  texto: text("texto"),
  arquivoId: uuid("arquivo_id"),
  midiaNome: text("midia_nome"),
  midiaMime: text("midia_mime"),
  midiaPendente: jsonb("midia_pendente").$type<Record<string, unknown>>(),
  status: text("status").$type<StatusMensagem>().notNull(),
  erro: text("erro"),
  idExterno: text("id_externo"),
  autorId: uuid("autor_id"),
  automacao: text("automacao"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const respostaRapida = pgTable("resposta_rapida", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  atalho: text("atalho").notNull(),
  texto: text("texto").notNull(),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export type TipoAutomacao = "boas_vindas" | "fora_horario" | "follow_up";

export const automacao = pgTable("automacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  tipo: text("tipo").$type<TipoAutomacao>().notNull(),
  texto: text("texto").notNull(),
  horas: integer("horas"),
  ativa: boolean("ativa").notNull().default(true),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

// Ligações e fila (fase 3) ---------------------------------------------------------------------------

export const telefoniaConfig = pgTable("telefonia_config", {
  empresaId: uuid("empresa_id").primaryKey(),
  sipServidor: text("sip_servidor"),
  sipDominio: text("sip_dominio"),
  gravacaoAtiva: boolean("gravacao_ativa").notNull().default(false),
  avisoGravacao: text("aviso_gravacao").notNull(),
  retencaoDias: integer("retencao_dias").notNull().default(90),
  atualizadoEm: atualizadoEm(),
});

export const ramal = pgTable("ramal", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  login: text("login").notNull(),
  senha: text("senha").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export type AcaoResultado = "nenhuma" | "reagendar" | "encerrar" | "descartar" | "converter";

export const resultadoLigacao = pgTable("resultado_ligacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  acao: text("acao").$type<AcaoResultado>().notNull(),
  horas: integer("horas"),
  atendida: boolean("atendida").notNull().default(false),
  ordem: integer("ordem").notNull().default(0),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const tipoBase = pgTable("tipo_base", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  criadoEm: criadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export type StatusFila = "ativa" | "pausada" | "encerrada";

export const fila = pgTable("fila", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  tipoBaseId: uuid("tipo_base_id"),
  status: text("status").$type<StatusFila>().notNull().default("ativa"),
  funilId: uuid("funil_id"),
  etapaId: uuid("etapa_id"),
  reservaMinutos: integer("reserva_minutos").notNull().default(15),
  maxTentativas: integer("max_tentativas").notNull().default(5),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const filaLote = pgTable("fila_lote", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  filaId: uuid("fila_id").notNull(),
  importacaoId: uuid("importacao_id"),
  novos: integer("novos").notNull().default(0),
  atualizados: integer("atualizados").notNull().default(0),
  emOutraFila: integer("em_outra_fila").notNull().default(0),
  jaLigados: integer("ja_ligados").notNull().default(0),
  ignorados: integer("ignorados").notNull().default(0),
  criadoEm: criadoEm(),
});

export type StatusItemFila = "pendente" | "reservado" | "concluido" | "descartado";

export const filaItem = pgTable("fila_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  filaId: uuid("fila_id").notNull(),
  contatoId: uuid("contato_id").notNull(),
  loteId: uuid("lote_id"),
  prioridade: integer("prioridade").notNull().default(0),
  ordem: bigint("ordem", { mode: "number" }).generatedAlwaysAsIdentity(),
  status: text("status").$type<StatusItemFila>().notNull().default("pendente"),
  reservadoPor: uuid("reservado_por"),
  reservadoAte: ts("reservado_ate"),
  tentativas: integer("tentativas").notNull().default(0),
  ultimoResultadoId: uuid("ultimo_resultado_id"),
  retornarEm: ts("retornar_em"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export type ProvedorTelefone = "treino" | "celular" | "sip";
export type EstadoLigacao = "criada" | "discando" | "tocando" | "em_ligacao" | "em_espera" | "encerrada";

export const ligacao = pgTable("ligacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  contatoId: uuid("contato_id"),
  oportunidadeId: uuid("oportunidade_id"),
  filaItemId: uuid("fila_item_id"),
  provedor: text("provedor").$type<ProvedorTelefone>().notNull(),
  direcao: text("direcao").$type<"saida" | "entrada">().notNull().default("saida"),
  numero: text("numero").notNull(),
  estado: text("estado").$type<EstadoLigacao>().notNull().default("criada"),
  idExterno: text("id_externo"),
  iniciadaEm: ts("iniciada_em").notNull().defaultNow(),
  atendidaEm: ts("atendida_em"),
  encerradaEm: ts("encerrada_em"),
  duracaoSegundos: integer("duracao_segundos"),
  motivoFim: text("motivo_fim"),
  resultadoId: uuid("resultado_id"),
  observacao: text("observacao"),
  gravacaoArquivoId: uuid("gravacao_arquivo_id"),
  gravacaoExpiraEm: ts("gravacao_expira_em"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const ligacaoEvento = pgTable("ligacao_evento", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  ligacaoId: uuid("ligacao_id").notNull(),
  estado: text("estado").notNull(),
  detalhe: text("detalhe"),
  criadoEm: criadoEm(),
});

// Fase 4 — Operação ----------------------------------------------------------------------------------------

export const compromisso = pgTable("compromisso", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  contatoId: uuid("contato_id"),
  titulo: text("titulo").notNull(),
  descricao: text("descricao"),
  local: text("local"),
  inicio: ts("inicio").notNull(),
  fim: ts("fim").notNull(),
  lembreteMinutos: integer("lembrete_minutos"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const escala = pgTable("escala", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  diaSemana: smallint("dia_semana").notNull(),
  inicio: time("inicio").notNull(),
  fim: time("fim").notNull(),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export type StatusRegistroHoras = "aberto" | "pendente" | "validado" | "recusado";

export const registroHoras = pgTable("registro_horas", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  data: date("data", { mode: "string" }).notNull(),
  entrada: ts("entrada").notNull(),
  saida: ts("saida"),
  observacao: text("observacao"),
  status: text("status").$type<StatusRegistroHoras>().notNull().default("pendente"),
  validadoPor: uuid("validado_por"),
  validadoEm: ts("validado_em"),
  motivo: text("motivo"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const fechamentoHoras = pgTable("fechamento_horas", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  mes: date("mes", { mode: "string" }).notNull(),
  fechadoPor: uuid("fechado_por"),
  fechadoEm: ts("fechado_em").notNull().defaultNow(),
  reabertoPor: uuid("reaberto_por"),
  reabertoEm: ts("reaberto_em"),
  motivoReabertura: text("motivo_reabertura"),
});

export const atividadeManual = pgTable("atividade_manual", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  tipo: text("tipo").notNull(),
  descricao: text("descricao"),
  inicio: ts("inicio").notNull(),
  fim: ts("fim").notNull(),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const meta = pgTable("meta", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  alvo: text("alvo").$type<"pessoa" | "equipe" | "empresa">().notNull(),
  usuarioId: uuid("usuario_id"),
  equipeId: uuid("equipe_id"),
  indicador: text("indicador").notNull(),
  periodo: text("periodo").$type<"dia" | "semana" | "mes">().notNull(),
  valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const checklistItem = pgTable("checklist_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  perfilId: uuid("perfil_id"),
  texto: text("texto").notNull(),
  ordem: integer("ordem").notNull().default(0),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const checklistMarcacao = pgTable("checklist_marcacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  itemId: uuid("item_id").notNull(),
  usuarioId: uuid("usuario_id").notNull(),
  data: date("data", { mode: "string" }).notNull(),
  feito: boolean("feito").notNull(),
  atualizadoEm: atualizadoEm(),
});

export const script = pgTable("script", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  titulo: text("titulo").notNull(),
  texto: text("texto").notNull(),
  uso: text("uso").$type<"todos" | "conversa" | "ligacao">().notNull().default("todos"),
  funilId: uuid("funil_id"),
  etapaId: uuid("etapa_id"),
  ordem: integer("ordem").notNull().default(0),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

// Fase 5 — Receita e qualidade -------------------------------------------------------------------------------

export const oferta = pgTable("oferta", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  precoCentavos: bigint("preco_centavos", { mode: "number" }),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const entrega = pgTable("entrega", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  ofertaId: uuid("oferta_id").notNull(),
  nome: text("nome").notNull(),
  prestadorId: uuid("prestador_id"),
  capacidade: integer("capacidade"),
  inicio: date("inicio", { mode: "string" }),
  fim: date("fim", { mode: "string" }),
  horario: text("horario"),
  status: text("status").$type<"aberta" | "encerrada">().notNull().default("aberta"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const entregaParticipante = pgTable("entrega_participante", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  entregaId: uuid("entrega_id").notNull(),
  contatoId: uuid("contato_id").notNull(),
  vendaId: uuid("venda_id"),
  status: text("status").$type<"ativo" | "cancelado">().notNull().default("ativo"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export type StatusVenda = "pendente" | "confirmada" | "cancelada";

export const venda = pgTable("venda", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  contatoId: uuid("contato_id").notNull(),
  ofertaId: uuid("oferta_id").notNull(),
  vendedorId: uuid("vendedor_id").notNull(),
  oportunidadeId: uuid("oportunidade_id"),
  entregaId: uuid("entrega_id"),
  valorCentavos: bigint("valor_centavos", { mode: "number" }).notNull(),
  formaPagamento: text("forma_pagamento").notNull(),
  parcelas: integer("parcelas").notNull().default(1),
  status: text("status").$type<StatusVenda>().notNull().default("pendente"),
  dataVenda: date("data_venda", { mode: "string" }).notNull(),
  observacao: text("observacao"),
  motivoCancelamento: text("motivo_cancelamento"),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const regraComissao = pgTable("regra_comissao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  ofertaId: uuid("oferta_id"),
  tipo: text("tipo").$type<"percentual" | "faixa">().notNull(),
  percentual: numeric("percentual", { precision: 5, scale: 2 }),
  faixas: jsonb("faixas").$type<{ ateCentavos: number | null; percentual: number }[] | null>(),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const fechamentoComissao = pgTable("fechamento_comissao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  mes: date("mes", { mode: "string" }).notNull(),
  totalCentavos: bigint("total_centavos", { mode: "number" }).notNull().default(0),
  fechadoPor: uuid("fechado_por"),
  fechadoEm: ts("fechado_em").notNull().defaultNow(),
  reabertoPor: uuid("reaberto_por"),
  reabertoEm: ts("reaberto_em"),
  motivoReabertura: text("motivo_reabertura"),
});

export const comissao = pgTable("comissao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  fechamentoId: uuid("fechamento_id").notNull(),
  vendedorId: uuid("vendedor_id").notNull(),
  regraId: uuid("regra_id"),
  regraNome: text("regra_nome").notNull(),
  vendas: integer("vendas").notNull(),
  baseCentavos: bigint("base_centavos", { mode: "number" }).notNull(),
  percentual: numeric("percentual", { precision: 5, scale: 2 }).notNull(),
  valorCentavos: bigint("valor_centavos", { mode: "number" }).notNull(),
  criadoEm: criadoEm(),
});

export const criterioQualidade = pgTable("criterio_qualidade", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  descricao: text("descricao"),
  peso: integer("peso").notNull().default(1),
  ordem: integer("ordem").notNull().default(0),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export interface NotaCriterio {
  criterioId: string;
  nome: string;
  peso: number;
  nota: number;
}

export const avaliacao = pgTable("avaliacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  avaliadoId: uuid("avaliado_id").notNull(),
  avaliadorId: uuid("avaliador_id").notNull(),
  conversaId: uuid("conversa_id"),
  ligacaoId: uuid("ligacao_id"),
  notas: jsonb("notas").$type<NotaCriterio[]>().notNull(),
  notaFinal: numeric("nota_final", { precision: 4, scale: 2 }).notNull(),
  feedback: text("feedback"),
  lidaEm: ts("lida_em"),
  criadoEm: criadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export interface PerguntaPesquisa {
  id: string;
  tipo: "texto" | "escolha" | "nota";
  texto: string;
  opcoes?: string[];
  obrigatoria: boolean;
}

export const pesquisa = pgTable("pesquisa", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  titulo: text("titulo").notNull(),
  descricao: text("descricao"),
  perguntas: jsonb("perguntas").$type<PerguntaPesquisa[]>().notNull(),
  token: text("token").notNull(),
  aberta: boolean("aberta").notNull().default(true),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const respostaPesquisa = pgTable("resposta_pesquisa", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  pesquisaId: uuid("pesquisa_id").notNull(),
  respostas: jsonb("respostas").$type<Record<string, string | number>>().notNull(),
  criadoEm: criadoEm(),
});

// Fase 6 — White-label ----------------------------------------------------------------------------------------

export interface CondicaoAutomacao {
  campo: string;
  operador: "igual" | "diferente" | "contem" | "tem" | "vazio" | "preenchido";
  valor?: string;
}

export const regraAutomacao = pgTable("regra_automacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  nome: text("nome").notNull(),
  gatilho: text("gatilho").notNull(),
  condicoes: jsonb("condicoes").$type<CondicaoAutomacao[]>().notNull().default([]),
  acao: text("acao").$type<"criar_tarefa" | "mover_etapa" | "avisar" | "enviar_mensagem">().notNull(),
  parametros: jsonb("parametros").$type<Record<string, string | number | null>>().notNull().default({}),
  ativa: boolean("ativa").notNull().default(true),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
});

export const automacaoExecucao = pgTable("automacao_execucao", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  regraId: uuid("regra_id").notNull(),
  eventoId: uuid("evento_id").notNull(),
  status: text("status").$type<"executada" | "ignorada" | "falhou">().notNull(),
  detalhe: text("detalhe"),
  criadoEm: criadoEm(),
});

export type StatusAssinatura = "teste" | "ativa" | "atrasada" | "cancelada";

export const assinatura = pgTable("assinatura", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  plano: text("plano").notNull(),
  status: text("status").$type<StatusAssinatura>().notNull(),
  valorCentavos: bigint("valor_centavos", { mode: "number" }).notNull(),
  provedor: text("provedor").notNull(),
  idExterno: text("id_externo"),
  testeAte: date("teste_ate", { mode: "string" }),
  proximaCobranca: date("proxima_cobranca", { mode: "string" }),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const fatura = pgTable("fatura", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  assinaturaId: uuid("assinatura_id").notNull(),
  plano: text("plano").notNull(),
  valorCentavos: bigint("valor_centavos", { mode: "number" }).notNull(),
  vencimento: date("vencimento", { mode: "string" }).notNull(),
  status: text("status").$type<"pendente" | "paga" | "vencida" | "cancelada">().notNull().default("pendente"),
  link: text("link"),
  idExterno: text("id_externo"),
  pagaEm: ts("paga_em"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});
