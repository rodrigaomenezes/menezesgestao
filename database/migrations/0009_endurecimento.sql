-- Fase 7 — Endurecimento: login em duas etapas, LGPD (anonimizar, retenção), avisos no celular (push).
-- Aditiva e idempotente.

-- Duas etapas ------------------------------------------------------------------------------------------------
-- A pessoa é global: o método vale em todas as empresas. Segredo do app cifrado com CRM_CHAVE; códigos de
-- recuperação guardados só como HMAC. mg_app não recebe permissão nestas colunas (só as listadas na 0001).
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS duas_etapas_metodo text CHECK (duas_etapas_metodo IN ('totp', 'email'));
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS duas_etapas_segredo text;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS duas_etapas_ultimo_passo bigint;
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS duas_etapas_recuperacao text[] NOT NULL DEFAULT '{}';
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS duas_etapas_ativada_em timestamptz(3);

-- A empresa decide quem é obrigado.
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS exigir_duas_etapas text NOT NULL DEFAULT 'nao'
  CHECK (exigir_duas_etapas IN ('nao', 'admins', 'todos'));

-- Desafio em andamento: login que já passou da senha, ou configuração de um método novo.
CREATE TABLE IF NOT EXISTS desafio_login (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- HMAC do token do cookie (só no login).
  token_hash    text UNIQUE,
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  empresa_id    uuid REFERENCES empresa(id),
  finalidade    text NOT NULL CHECK (finalidade IN ('entrar', 'configurar')),
  metodo        text NOT NULL CHECK (metodo IN ('totp', 'email')),
  -- HMAC do código enviado por e-mail.
  codigo_hash   text,
  -- Configuração do app: chave nova, cifrada, até a pessoa confirmar.
  segredo_novo  text,
  tentativas    integer NOT NULL DEFAULT 0,
  envios        integer NOT NULL DEFAULT 1,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  expira_em     timestamptz(3) NOT NULL,
  usado_em      timestamptz(3)
);
CREATE INDEX IF NOT EXISTS desafio_login_usuario_idx ON desafio_login (usuario_id, finalidade, criado_em DESC);
-- Sem política: só o caminho do sistema enxerga.
ALTER TABLE desafio_login ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON desafio_login FROM mg_app;

-- LGPD -------------------------------------------------------------------------------------------------------
-- Contato anonimizado a pedido do titular (ou pelo prazo de retenção): o registro fica, sem dados pessoais.
ALTER TABLE contato ADD COLUMN IF NOT EXISTS anonimizado_em timestamptz(3);
-- Prazos de retenção da empresa: { "mensagensMeses": n | null, "arquivadosMeses": n | null } (null = sem prazo).
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS retencao jsonb NOT NULL DEFAULT '{}';

-- Histórico (evento, auditoria) continua somente inserção. Única exceção: a anonimização (LGPD) pode apagar o
-- CONTEÚDO (dados / antes / depois), nunca o fato — tipo, data, autor e ids ficam. Só o caminho do sistema
-- consegue (mg_app não tem UPDATE nessas tabelas) e só com app.lgpd_redacao ligado na própria transação.
CREATE OR REPLACE FUNCTION bloquear_alteracao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('app.lgpd_redacao', true) = 'on' THEN
    IF TG_TABLE_NAME = 'evento' AND (to_jsonb(NEW) - 'dados') = (to_jsonb(OLD) - 'dados') THEN
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'auditoria' AND (to_jsonb(NEW) - 'antes' - 'depois') = (to_jsonb(OLD) - 'antes' - 'depois') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'A tabela % é somente inserção: registros não podem ser alterados nem apagados', TG_TABLE_NAME;
END $$;

-- Avisos no celular (Web Push) ---------------------------------------------------------------------------------
-- Inscrição é do aparelho da pessoa (vale em todas as empresas dela). Chaves do navegador cifradas com CRM_CHAVE.
CREATE TABLE IF NOT EXISTS push_inscricao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       uuid NOT NULL REFERENCES usuario(id),
  endpoint         text NOT NULL CHECK (length(endpoint) BETWEEN 10 AND 1000),
  chaves           text NOT NULL,
  celular          boolean NOT NULL DEFAULT false,
  dispositivo      text,
  criado_em        timestamptz(3) NOT NULL DEFAULT now(),
  ultimo_envio_em  timestamptz(3),
  encerrada_em     timestamptz(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS push_inscricao_endpoint_uk ON push_inscricao (endpoint);
CREATE INDEX IF NOT EXISTS push_inscricao_usuario_idx ON push_inscricao (usuario_id) WHERE encerrada_em IS NULL;
ALTER TABLE push_inscricao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON push_inscricao FROM mg_app;

-- Push só para quem está fora: entregue_em = chegou por tempo real a uma tela aberta; push_em = já foi (ou não
-- precisava). so_celular = aviso de ligação, que só faz sentido no celular.
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS so_celular boolean NOT NULL DEFAULT false;
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS entregue_em timestamptz(3);
ALTER TABLE notificacao ADD COLUMN IF NOT EXISTS push_em timestamptz(3);
CREATE INDEX IF NOT EXISTS notificacao_push_idx ON notificacao (criado_em)
  WHERE push_em IS NULL AND lida_em IS NULL AND entregue_em IS NULL;
