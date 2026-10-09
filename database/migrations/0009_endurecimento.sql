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
