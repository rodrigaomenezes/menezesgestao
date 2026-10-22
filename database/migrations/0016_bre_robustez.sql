-- Fase 8.5: robustez. A IA roda pela fila de jobs: a análise e a prévia do SQ-BRE nascem "processando" e são
-- preenchidas pelo trabalhador (com nova tentativa em falha passageira). Guardamos tempo e tokens para acompanhar o
-- custo. O BPI do mês passa a ser guardado por pessoa (recalculado de hora em hora ou quando ficar velho).

ALTER TABLE analise_bre ALTER COLUMN saida DROP NOT NULL;
ALTER TABLE analise_bre ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pronta';
ALTER TABLE analise_bre DROP CONSTRAINT IF EXISTS analise_bre_status_check;
ALTER TABLE analise_bre ADD CONSTRAINT analise_bre_status_check CHECK (status IN ('processando','pronta','falhou'));
ALTER TABLE analise_bre ADD COLUMN IF NOT EXISTS erro text;
ALTER TABLE analise_bre ADD COLUMN IF NOT EXISTS ms integer;
ALTER TABLE analise_bre ADD COLUMN IF NOT EXISTS tokens_entrada integer;
ALTER TABLE analise_bre ADD COLUMN IF NOT EXISTS tokens_saida integer;
ALTER TABLE analise_bre ADD COLUMN IF NOT EXISTS concluida_em timestamptz(3);
CREATE INDEX IF NOT EXISTS analise_bre_hora_idx ON analise_bre (empresa_id, criado_em);
GRANT UPDATE ON analise_bre TO mg_app;

ALTER TABLE sq_bre ALTER COLUMN previa DROP NOT NULL;
ALTER TABLE sq_bre ALTER COLUMN nota_previa DROP NOT NULL;
ALTER TABLE sq_bre ADD COLUMN IF NOT EXISTS erro text;
ALTER TABLE sq_bre ADD COLUMN IF NOT EXISTS ms integer;
ALTER TABLE sq_bre ADD COLUMN IF NOT EXISTS tokens_entrada integer;
ALTER TABLE sq_bre ADD COLUMN IF NOT EXISTS tokens_saida integer;
CREATE INDEX IF NOT EXISTS sq_bre_hora_idx ON sq_bre (empresa_id, criado_em);

-- Índice para o pilar Inteligência do BPI (registros por pessoa no período).
CREATE INDEX IF NOT EXISTS registro_bre_autor_idx ON registro_bre (empresa_id, autor_id, criado_em);

CREATE TABLE IF NOT EXISTS bre_bpi (
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  mes          text NOT NULL CHECK (mes ~ '^\d{4}-\d{2}$'),
  usuario_id   uuid NOT NULL REFERENCES usuario(id),
  posicao      integer NOT NULL,
  pilares      jsonb NOT NULL,
  bpi          numeric(5,1),
  coaching     jsonb NOT NULL DEFAULT '[]',
  calculado_em timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, mes, usuario_id)
);
CREATE INDEX IF NOT EXISTS bre_bpi_posicao_idx ON bre_bpi (empresa_id, mes, posicao);
ALTER TABLE bre_bpi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento ON bre_bpi;
CREATE POLICY isolamento ON bre_bpi USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON bre_bpi TO mg_app;
