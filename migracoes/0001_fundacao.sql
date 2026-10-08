-- Fase 0 — Fundação. Idempotente: rodar duas vezes não muda nada.
--
-- Isolamento entre empresas em duas barreiras:
--   1. O código de negócio só acessa o banco por comEmpresa(), que assume o papel mg_app e define app.empresa_id.
--   2. Row Level Security: mg_app só enxerga linhas com empresa_id = app.empresa_id. Sem contexto, nada.
-- O dono das tabelas (usuário da conexão) não passa pelo RLS: é o "caminho do sistema" (login, migrações, jobs).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mg_app') THEN
    CREATE ROLE mg_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT pg_has_role(current_user, 'mg_app', 'MEMBER') THEN
    EXECUTE format('GRANT mg_app TO %I', current_user);
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO mg_app;

CREATE OR REPLACE FUNCTION app_empresa_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.empresa_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION bloquear_alteracao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é somente inserção: registros não podem ser alterados nem apagados', TG_TABLE_NAME;
END $$;

-- Núcleo -------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS empresa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  marca         jsonb NOT NULL DEFAULT '{}',
  dominio       text,
  fuso          text NOT NULL DEFAULT 'America/Sao_Paulo',
  plano         text NOT NULL DEFAULT 'essencial',
  modulos       jsonb NOT NULL DEFAULT '[]',
  vocabulario   jsonb NOT NULL DEFAULT '{}',
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);

-- Usuário é global (pode pertencer a várias empresas); o vínculo liga usuário × empresa × perfil.
CREATE TABLE IF NOT EXISTS usuario (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  nome              text NOT NULL,
  senha_hash        text,
  tentativas_falhas integer NOT NULL DEFAULT 0,
  bloqueado_ate     timestamptz(3),
  criado_em         timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_uk ON usuario (lower(email));

CREATE TABLE IF NOT EXISTS unidade (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL,
  endereco      text,
  horario       jsonb NOT NULL DEFAULT '{}',
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS unidade_empresa_idx ON unidade (empresa_id, criado_em DESC, id DESC);

CREATE TABLE IF NOT EXISTS equipe (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  unidade_id    uuid REFERENCES unidade(id),
  nome          text NOT NULL,
  gestor_id     uuid REFERENCES usuario(id),
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS equipe_empresa_idx ON equipe (empresa_id, criado_em DESC, id DESC);

-- Permissões do perfil em JSON: {"modulo": {"acao": "escopo"}}.
CREATE TABLE IF NOT EXISTS perfil (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL,
  base          text,
  protegido     boolean NOT NULL DEFAULT false,
  permissoes    jsonb NOT NULL DEFAULT '{}',
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS perfil_empresa_idx ON perfil (empresa_id, criado_em DESC, id DESC);

CREATE TABLE IF NOT EXISTS vinculo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  perfil_id     uuid NOT NULL REFERENCES perfil(id),
  unidade_id    uuid REFERENCES unidade(id),
  equipe_id     uuid REFERENCES equipe(id),
  status        text NOT NULL DEFAULT 'convidado' CHECK (status IN ('convidado', 'ativo')),
  convidado_por uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS vinculo_empresa_usuario_uk ON vinculo (empresa_id, usuario_id);
CREATE INDEX IF NOT EXISTS vinculo_lista_idx ON vinculo (empresa_id, criado_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS vinculo_usuario_idx ON vinculo (usuario_id);

-- Sessões e tokens: só o caminho do sistema acessa. Guardam o HMAC do token, nunca o token.
CREATE TABLE IF NOT EXISTS sessao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  usuario_id   uuid NOT NULL REFERENCES usuario(id),
  empresa_id   uuid REFERENCES empresa(id),
  ip           text,
  dispositivo  text,
  criado_em    timestamptz(3) NOT NULL DEFAULT now(),
  ultimo_uso   timestamptz(3) NOT NULL DEFAULT now(),
  expira_em    timestamptz(3) NOT NULL,
  encerrada_em timestamptz(3)
);
CREATE INDEX IF NOT EXISTS sessao_usuario_idx ON sessao (usuario_id);

CREATE TABLE IF NOT EXISTS token_acesso (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo       text NOT NULL CHECK (tipo IN ('convite', 'recuperacao')),
  token_hash text NOT NULL UNIQUE,
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  empresa_id uuid REFERENCES empresa(id),
  criado_em  timestamptz(3) NOT NULL DEFAULT now(),
  expira_em  timestamptz(3) NOT NULL,
  usado_em   timestamptz(3)
);

-- Barramento de eventos: só inserção. Base do histórico, do mapa de atividades, das metas e do tempo real.
CREATE TABLE IF NOT EXISTS evento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  tipo            text NOT NULL,
  ator_id         uuid REFERENCES usuario(id),
  entidade        text NOT NULL,
  entidade_id     uuid,
  responsavel_id  uuid,
  para_usuario_id uuid,
  dados           jsonb NOT NULL DEFAULT '{}',
  criado_em       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evento_empresa_idx ON evento (empresa_id, criado_em DESC, id DESC);
CREATE INDEX IF NOT EXISTS evento_entidade_idx ON evento (empresa_id, entidade, entidade_id);

-- Auditoria: só inserção. empresa_id vazio = acontecimento fora de uma empresa (ex.: login com e-mail inexistente).
CREATE TABLE IF NOT EXISTS auditoria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid REFERENCES empresa(id),
  ator_id     uuid REFERENCES usuario(id),
  acao        text NOT NULL,
  entidade    text NOT NULL,
  entidade_id uuid,
  antes       jsonb,
  depois      jsonb,
  ip          text,
  dispositivo text,
  criado_em   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_empresa_idx ON auditoria (empresa_id, criado_em DESC, id DESC);

CREATE TABLE IF NOT EXISTS notificacao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa(id),
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  titulo     text NOT NULL,
  texto      text,
  link       text,
  lida_em    timestamptz(3),
  criado_em  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notificacao_usuario_idx ON notificacao (empresa_id, usuario_id, criado_em DESC, id DESC);

-- Caixa de saída do provedor de avisos de demonstração (sem SMTP). Só o caminho do sistema acessa.
CREATE TABLE IF NOT EXISTS aviso_saida (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal     text NOT NULL DEFAULT 'email',
  para      text NOT NULL,
  assunto   text NOT NULL,
  texto     text NOT NULL,
  criado_em timestamptz(3) NOT NULL DEFAULT now()
);

-- Somente inserção ---------------------------------------------------------------------------------

DROP TRIGGER IF EXISTS evento_somente_insercao ON evento;
CREATE TRIGGER evento_somente_insercao BEFORE UPDATE OR DELETE ON evento
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao();
DROP TRIGGER IF EXISTS evento_sem_truncate ON evento;
CREATE TRIGGER evento_sem_truncate BEFORE TRUNCATE ON evento
  FOR EACH STATEMENT EXECUTE FUNCTION bloquear_alteracao();

DROP TRIGGER IF EXISTS auditoria_somente_insercao ON auditoria;
CREATE TRIGGER auditoria_somente_insercao BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao();
DROP TRIGGER IF EXISTS auditoria_sem_truncate ON auditoria;
CREATE TRIGGER auditoria_sem_truncate BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION bloquear_alteracao();

-- Row Level Security -------------------------------------------------------------------------------

ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento ON empresa;
CREATE POLICY isolamento ON empresa USING (id = app_empresa_id()) WITH CHECK (id = app_empresa_id());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['unidade', 'equipe', 'perfil', 'vinculo', 'evento', 'auditoria', 'notificacao'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;

-- Usuários: a empresa só enxerga quem tem vínculo com ela, e nunca a senha (permissão por coluna).
ALTER TABLE usuario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento ON usuario;
CREATE POLICY isolamento ON usuario USING (
  EXISTS (SELECT 1 FROM vinculo v WHERE v.usuario_id = usuario.id AND v.empresa_id = app_empresa_id())
);

-- Sem política = mg_app não enxerga nada.
ALTER TABLE sessao ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_acesso ENABLE ROW LEVEL SECURITY;
-- Convites nascem dentro de uma empresa: mg_app só pode inserir (nunca ler) tokens da própria empresa.
DROP POLICY IF EXISTS convite_da_empresa ON token_acesso;
CREATE POLICY convite_da_empresa ON token_acesso FOR INSERT
  WITH CHECK (tipo = 'convite' AND empresa_id = app_empresa_id());
ALTER TABLE aviso_saida ENABLE ROW LEVEL SECURITY;

-- Permissões do papel da aplicação. Sem DELETE em lugar nenhum: excluir é arquivar.
REVOKE ALL ON empresa, usuario, unidade, equipe, perfil, vinculo, sessao, token_acesso, evento, auditoria,
  notificacao, aviso_saida FROM mg_app;
GRANT SELECT, UPDATE ON empresa TO mg_app;
GRANT SELECT (id, email, nome, criado_em, atualizado_em) ON usuario TO mg_app;
GRANT SELECT, INSERT, UPDATE ON unidade, equipe, perfil, vinculo, notificacao TO mg_app;
GRANT SELECT, INSERT ON evento, auditoria TO mg_app;
GRANT INSERT ON token_acesso TO mg_app;
