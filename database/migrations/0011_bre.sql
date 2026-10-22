-- Fase 8.1: Motor BRE sem IA (ETR BRE-ETR-001 v0.2). Tudo aditivo e idempotente. Os códigos das listas fechadas
-- da doutrina ficam em CHECK; os limites de cada empresa ficam em bre_config (versionada pela auditoria).

-- Módulo novo no catálogo: a lista permitida de permissões passa a incluir "bre".
ALTER TABLE permissao DROP CONSTRAINT IF EXISTS permissao_modulo_check;
ALTER TABLE permissao ADD CONSTRAINT permissao_modulo_check CHECK (modulo IN (
  'usuarios', 'configuracoes', 'auditoria', 'crm', 'conversas', 'telefonia', 'fila', 'agenda', 'rotina',
  'desempenho', 'mapa', 'scripts', 'qualidade', 'vendas', 'servicos', 'pesquisa', 'bre'));

-- DEC-012: o funil continua configurável; a etapa ganha um marco BRE opcional.
ALTER TABLE etapa ADD COLUMN IF NOT EXISTS marco_bre text
  CHECK (marco_bre IS NULL OR marco_bre IN ('LEAD_IDENTIFIED','DIAGNOSIS','INTEREST','PROPOSAL','NEGOTIATION','SALE','REENTRY','CLOSED'));

-- D-01: estado do cliente, recalculado por job diário a partir das vendas confirmadas.
ALTER TABLE contato ADD COLUMN IF NOT EXISTS estado_bre text CHECK (estado_bre IS NULL OR estado_bre IN ('RECENT','ACTIVE','ABOUT_TO_SLEEP','INACTIVE'));
ALTER TABLE contato ADD COLUMN IF NOT EXISTS estado_bre_em timestamptz(3);
ALTER TABLE contato ADD COLUMN IF NOT EXISTS compras_qtd integer NOT NULL DEFAULT 0;
ALTER TABLE contato ADD COLUMN IF NOT EXISTS ultima_entrega_em date;
CREATE INDEX IF NOT EXISTS contato_estado_bre_idx ON contato (empresa_id, estado_bre);

-- DEC-013: motivo de perda ganha categoria BRE para os relatórios conversarem com os Breaks.
ALTER TABLE motivo_perda ADD COLUMN IF NOT EXISTS categoria_bre text;

-- Encerramento guiado (BR-002) na própria oportunidade.
ALTER TABLE oportunidade ADD COLUMN IF NOT EXISTS encerramento_bre jsonb;

CREATE TABLE IF NOT EXISTS bre_config (
  empresa_id    uuid PRIMARY KEY REFERENCES empresa(id),
  config        jsonb NOT NULL,
  versao        integer NOT NULL DEFAULT 1,
  atualizado_em timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS motivo_break (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  categoria     text NOT NULL CHECK (categoria IN ('A_TIME','B_PRODUCT','C_FINANCIAL','D_TRUST','E_PROCESS','F_COMPETITOR','G_OTHER','PRIOR_EXPERIENCE','NO_INTEREST')),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS motivo_break_idx ON motivo_break (empresa_id, categoria);

-- Ciclo de contato: no máximo um aberto por cliente (BR-011, BR-012).
CREATE TABLE IF NOT EXISTS ciclo_contato (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresa(id),
  contato_id        uuid NOT NULL REFERENCES contato(id),
  aberto_em         timestamptz(3) NOT NULL DEFAULT now(),
  tentativas        integer NOT NULL DEFAULT 0,
  ultima_tentativa_em timestamptz(3),
  ultima_resposta_em  timestamptz(3),
  encerrado_em      timestamptz(3),
  motivo_encerramento text,
  sem_resposta      boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS ciclo_aberto_uk ON ciclo_contato (empresa_id, contato_id) WHERE encerrado_em IS NULL;
CREATE INDEX IF NOT EXISTS ciclo_contato_idx ON ciclo_contato (empresa_id, contato_id, encerrado_em);

CREATE TABLE IF NOT EXISTS registro_bre (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  contato_id          uuid NOT NULL REFERENCES contato(id),
  conversa_id         uuid REFERENCES conversa(id),
  oportunidade_id     uuid REFERENCES oportunidade(id),
  ciclo_id            uuid REFERENCES ciclo_contato(id),
  autor_id            uuid NOT NULL REFERENCES usuario(id),
  resultado           text NOT NULL CHECK (resultado IN ('PURCHASED','ADVANCED','REPLIED_NO_ADVANCE','NO_REPLY','OPTED_OUT')),
  temperatura         text NOT NULL CHECK (temperatura IN ('COLD','WARM','HOT','READY_TO_BUY')),
  estado_emocional    text CHECK (estado_emocional IS NULL OR estado_emocional IN ('CURIOUS','INTERESTED','WARY','EXCITED','CONVINCED')),
  sins                jsonb NOT NULL DEFAULT '[]',
  marco               text,
  interesse_oferta_id uuid REFERENCES oferta(id),
  produto_oferta_id   uuid REFERENCES oferta(id),
  proxima_acao        text NOT NULL,
  retorno_em          date,
  segundos            integer,
  criado_em           timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registro_bre_contato_idx ON registro_bre (empresa_id, contato_id, criado_em);

CREATE TABLE IF NOT EXISTS break_bre (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  contato_id      uuid NOT NULL REFERENCES contato(id),
  registro_id     uuid REFERENCES registro_bre(id),
  oportunidade_id uuid REFERENCES oportunidade(id),
  categoria       text NOT NULL CHECK (categoria IN ('A_TIME','B_PRODUCT','C_FINANCIAL','D_TRUST','E_PROCESS','F_COMPETITOR','G_OTHER','PRIOR_EXPERIENCE','NO_INTEREST')),
  motivo_id       uuid NOT NULL REFERENCES motivo_break(id),
  comentario      text NOT NULL CHECK (length(comentario) BETWEEN 3 AND 1000),
  marco           text,
  acao_padrao     text NOT NULL,
  autor_id        uuid NOT NULL REFERENCES usuario(id),
  criado_em       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS break_bre_contato_idx ON break_bre (empresa_id, contato_id, criado_em);

CREATE TABLE IF NOT EXISTS reentrada (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  contato_id    uuid NOT NULL REFERENCES contato(id),
  tipo          text NOT NULL CHECK (tipo IN ('TIME','EVENT','PROFILE','BEHAVIOR','RELATIONSHIP')),
  prevista_para date,
  condicao      text CHECK (condicao IS NULL OR length(condicao) <= 200),
  motivo        text NOT NULL CHECK (length(motivo) BETWEEN 1 AND 300),
  break_id      uuid REFERENCES break_bre(id),
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','feita','cancelada')),
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (prevista_para IS NOT NULL OR condicao IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS reentrada_idx ON reentrada (empresa_id, status, prevista_para);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bre_config','motivo_break','ciclo_contato','registro_bre','break_bre','reentrada'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
