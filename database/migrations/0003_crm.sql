-- Fase 1 — CRM. Aditiva e idempotente.
-- Contatos (telefone E.164 único por empresa), funis/etapas configuráveis, oportunidades, tarefas, notas,
-- etiquetas, campos personalizados, importação de planilhas e arquivos (StorageProvider "banco").

-- Arquivos ---------------------------------------------------------------------------------------------
-- Metadados + conteúdo (provedor de armazenamento "banco"). Outros provedores (disco, S3) usam só os metadados.
CREATE TABLE IF NOT EXISTS arquivo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  nome         text NOT NULL,
  tipo_mime    text NOT NULL,
  tamanho      integer NOT NULL CHECK (tamanho >= 0),
  provedor     text NOT NULL DEFAULT 'banco',
  conteudo     bytea,
  criado_por   uuid REFERENCES usuario(id),
  criado_em    timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em timestamptz(3)
);

-- Configuração do CRM ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campo_personalizado (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  entidade      text NOT NULL CHECK (entidade IN ('contato', 'oportunidade')),
  chave         text NOT NULL CHECK (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  rotulo        text NOT NULL,
  tipo          text NOT NULL CHECK (tipo IN ('texto', 'numero', 'data', 'lista', 'sim_nao')),
  opcoes        jsonb NOT NULL DEFAULT '[]',
  obrigatorio   boolean NOT NULL DEFAULT false,
  ordem         integer NOT NULL DEFAULT 0,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  UNIQUE (empresa_id, entidade, chave)
);

CREATE TABLE IF NOT EXISTS etiqueta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL,
  cor           text NOT NULL DEFAULT '#5b6470' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS etiqueta_nome_uk ON etiqueta (empresa_id, lower(nome));

CREATE TABLE IF NOT EXISTS funil (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL,
  ordem         integer NOT NULL DEFAULT 0,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);

-- tipo: aberta (em andamento), ganha ou perdida. campos_obrigatorios: chaves que precisam estar preenchidas
-- para a oportunidade entrar na etapa ('valor', 'oferta' ou chave de campo personalizado).
CREATE TABLE IF NOT EXISTS etapa (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  funil_id            uuid NOT NULL REFERENCES funil(id),
  nome                text NOT NULL,
  cor                 text NOT NULL DEFAULT '#1f5fbf' CHECK (cor ~ '^#[0-9a-fA-F]{6}$'),
  ordem               integer NOT NULL DEFAULT 0,
  probabilidade       integer NOT NULL DEFAULT 0 CHECK (probabilidade BETWEEN 0 AND 100),
  tipo                text NOT NULL DEFAULT 'aberta' CHECK (tipo IN ('aberta', 'ganha', 'perdida')),
  campos_obrigatorios jsonb NOT NULL DEFAULT '[]',
  criado_em           timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em       timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em        timestamptz(3)
);
CREATE INDEX IF NOT EXISTS etapa_funil_idx ON etapa (funil_id, ordem);

CREATE TABLE IF NOT EXISTS motivo_perda (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL,
  ordem         integer NOT NULL DEFAULT 0,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);

-- Contatos -----------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS contato (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  tipo             text NOT NULL DEFAULT 'pessoa' CHECK (tipo IN ('pessoa', 'empresa')),
  nome             text NOT NULL,
  telefone         text CHECK (telefone ~ '^\+[1-9][0-9]{7,14}$'),
  email            text,
  organizacao_id   uuid REFERENCES contato(id),
  responsavel_id   uuid REFERENCES usuario(id),
  origem           text,
  campos           jsonb NOT NULL DEFAULT '{}',
  nao_contatar     boolean NOT NULL DEFAULT false,
  consentimento_em timestamptz(3),
  criado_por       uuid REFERENCES usuario(id),
  criado_em        timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em    timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em     timestamptz(3)
);
-- Telefone normalizado é a chave de deduplicação: único por empresa, mesmo entre arquivados.
CREATE UNIQUE INDEX IF NOT EXISTS contato_telefone_uk ON contato (empresa_id, telefone) WHERE telefone IS NOT NULL;
CREATE INDEX IF NOT EXISTS contato_lista_idx ON contato (empresa_id, criado_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS contato_responsavel_idx ON contato (empresa_id, responsavel_id);
CREATE INDEX IF NOT EXISTS contato_email_idx ON contato (empresa_id, lower(email));

CREATE TABLE IF NOT EXISTS contato_etiqueta (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  contato_id  uuid NOT NULL REFERENCES contato(id),
  etiqueta_id uuid NOT NULL REFERENCES etiqueta(id),
  criado_em   timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (contato_id, etiqueta_id)
);
CREATE INDEX IF NOT EXISTS contato_etiqueta_etiqueta_idx ON contato_etiqueta (etiqueta_id);

-- Oportunidades, tarefas e notas -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS oportunidade (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  contato_id      uuid NOT NULL REFERENCES contato(id),
  funil_id        uuid NOT NULL REFERENCES funil(id),
  etapa_id        uuid NOT NULL REFERENCES etapa(id),
  titulo          text NOT NULL,
  valor_centavos  bigint CHECK (valor_centavos >= 0),
  oferta          text,
  responsavel_id  uuid REFERENCES usuario(id),
  status          text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'ganha', 'perdida')),
  motivo_perda_id uuid REFERENCES motivo_perda(id),
  fechada_em      timestamptz(3),
  campos          jsonb NOT NULL DEFAULT '{}',
  criado_por      uuid REFERENCES usuario(id),
  criado_em       timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em   timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em    timestamptz(3)
);
CREATE INDEX IF NOT EXISTS oportunidade_funil_idx ON oportunidade (empresa_id, funil_id, etapa_id);
CREATE INDEX IF NOT EXISTS oportunidade_contato_idx ON oportunidade (contato_id);
CREATE INDEX IF NOT EXISTS oportunidade_responsavel_idx ON oportunidade (empresa_id, responsavel_id);

CREATE TABLE IF NOT EXISTS tarefa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  contato_id      uuid REFERENCES contato(id),
  oportunidade_id uuid REFERENCES oportunidade(id),
  titulo          text NOT NULL,
  descricao       text,
  responsavel_id  uuid REFERENCES usuario(id),
  vence_em        timestamptz(3),
  concluida_em    timestamptz(3),
  criado_por      uuid REFERENCES usuario(id),
  criado_em       timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em   timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em    timestamptz(3),
  CHECK (contato_id IS NOT NULL OR oportunidade_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS tarefa_responsavel_idx ON tarefa (empresa_id, responsavel_id, concluida_em, vence_em);
CREATE INDEX IF NOT EXISTS tarefa_contato_idx ON tarefa (contato_id);

CREATE TABLE IF NOT EXISTS nota (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  contato_id      uuid NOT NULL REFERENCES contato(id),
  oportunidade_id uuid REFERENCES oportunidade(id),
  texto           text NOT NULL,
  autor_id        uuid REFERENCES usuario(id),
  criado_em       timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em   timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em    timestamptz(3)
);
CREATE INDEX IF NOT EXISTS nota_contato_idx ON nota (contato_id, criado_em DESC);

-- Importação --------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS importacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  arquivo_id    uuid NOT NULL REFERENCES arquivo(id),
  nome_arquivo  text NOT NULL,
  status        text NOT NULL DEFAULT 'PRONTA'
                CHECK (status IN ('PRONTA', 'PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'CONCLUIDA_COM_ERROS', 'FALHOU')),
  colunas       jsonb NOT NULL DEFAULT '[]',
  amostra       jsonb NOT NULL DEFAULT '[]',
  total_linhas  integer NOT NULL DEFAULT 0,
  mapeamento    jsonb,
  opcoes        jsonb,
  novos         integer NOT NULL DEFAULT 0,
  atualizados   integer NOT NULL DEFAULT 0,
  inalterados   integer NOT NULL DEFAULT 0,
  ignorados     integer NOT NULL DEFAULT 0,
  erros         jsonb NOT NULL DEFAULT '[]',
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  concluida_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS importacao_lista_idx ON importacao (empresa_id, criado_em DESC, id DESC);

-- Histórico do contato: eventos ligados a um contato (contato, oportunidade, tarefa, nota, conversa, ligação…).
ALTER TABLE evento ADD COLUMN IF NOT EXISTS contato_id uuid;
CREATE INDEX IF NOT EXISTS evento_contato_idx ON evento (empresa_id, contato_id, criado_em DESC) WHERE contato_id IS NOT NULL;

-- Row Level Security e permissões ---------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['arquivo', 'campo_personalizado', 'etiqueta', 'funil', 'etapa', 'motivo_perda', 'contato',
                           'contato_etiqueta', 'oportunidade', 'tarefa', 'nota', 'importacao'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
-- Tirar uma etiqueta de um contato remove a ligação (auditada); nenhum outro DELETE.
GRANT DELETE ON contato_etiqueta TO mg_app;

-- Funil inicial para empresas que ainda não têm nenhum (as novas recebem o mesmo em criarEmpresa).
-- Pacotes por segmento chegam na fase 6; este é o genérico, editável pela empresa.
DO $$
DECLARE
  e record;
  f uuid;
BEGIN
  FOR e IN SELECT id FROM empresa WHERE NOT EXISTS (SELECT 1 FROM funil WHERE funil.empresa_id = empresa.id) LOOP
    INSERT INTO funil (empresa_id, nome, ordem) VALUES (e.id, 'Vendas', 0) RETURNING id INTO f;
    INSERT INTO etapa (empresa_id, funil_id, nome, cor, ordem, probabilidade, tipo) VALUES
      (e.id, f, 'Novo contato', '#5b6470', 0, 10, 'aberta'),
      (e.id, f, 'Em conversa',  '#1f5fbf', 1, 30, 'aberta'),
      (e.id, f, 'Proposta',     '#7a3fbf', 2, 60, 'aberta'),
      (e.id, f, 'Negociação',   '#e07a1f', 3, 80, 'aberta'),
      (e.id, f, 'Ganho',        '#1e6b34', 4, 100, 'ganha'),
      (e.id, f, 'Perdido',      '#b3261e', 5, 0, 'perdida');
  END LOOP;
  FOR e IN SELECT id FROM empresa WHERE NOT EXISTS (SELECT 1 FROM motivo_perda m WHERE m.empresa_id = empresa.id) LOOP
    INSERT INTO motivo_perda (empresa_id, nome, ordem) VALUES
      (e.id, 'Preço', 0), (e.id, 'Sem interesse', 1), (e.id, 'Escolheu a concorrência', 2), (e.id, 'Não respondeu', 3);
  END LOOP;
END $$;

