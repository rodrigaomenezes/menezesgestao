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
