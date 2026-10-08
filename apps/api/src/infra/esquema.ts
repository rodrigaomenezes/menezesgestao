// Espelho em Drizzle das tabelas criadas em migracoes/*.sql (as migrações SQL são a fonte da verdade).
import { bigint, boolean, customType, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
});
