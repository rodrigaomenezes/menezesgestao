// Espelho em Drizzle das tabelas criadas em migracoes/*.sql (as migrações SQL são a fonte da verdade).
import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (nome: string) => timestamp(nome, { withTimezone: true, precision: 3 });
const criadoEm = () => ts("criado_em").notNull().defaultNow();
const atualizadoEm = () => ts("atualizado_em").notNull().defaultNow();

export const empresa = pgTable("empresa", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
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
  permissoes: jsonb("permissoes").notNull().default({}),
  criadoPor: uuid("criado_por"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
  arquivadoEm: ts("arquivado_em"),
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
