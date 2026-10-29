-- Duplicados e fusão (Konecta RF-CRM-004/008). Fundir arquiva o cadastro de origem e o marca com o destino
-- (`fundido_em_id`); o histórico do destino passa a mostrar também o da origem. Cada fusão fica registrada
-- (somente inserção): origem, destino, quem, quando, o que foi escolhido e o que foi incorporado. Aditiva.
ALTER TABLE contato ADD COLUMN IF NOT EXISTS fundido_em_id uuid REFERENCES contato(id);
CREATE INDEX IF NOT EXISTS contato_fundido_em_idx ON contato (fundido_em_id) WHERE fundido_em_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS contato_fusao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  origem_id     uuid NOT NULL REFERENCES contato(id),
  destino_id    uuid NOT NULL REFERENCES contato(id),
  usuario_id    uuid REFERENCES usuario(id),
  -- Como a origem era (nome, telefone, e-mail, documento só mascarado), o que ficou de cada lado e o que entrou.
  origem_resumo jsonb NOT NULL DEFAULT '{}',
  escolhas      jsonb NOT NULL DEFAULT '{}',
  incorporados  jsonb NOT NULL DEFAULT '{}',
  movidos       jsonb NOT NULL DEFAULT '{}',
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (origem_id <> destino_id)
);
CREATE INDEX IF NOT EXISTS contato_fusao_destino_idx ON contato_fusao (destino_id);
CREATE UNIQUE INDEX IF NOT EXISTS contato_fusao_origem_uk ON contato_fusao (origem_id);

-- "Não é duplicado": o par sai da lista (a < b, para o par ser um só).
CREATE TABLE IF NOT EXISTS contato_par_ignorado (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  contato_a   uuid NOT NULL REFERENCES contato(id),
  contato_b   uuid NOT NULL REFERENCES contato(id),
  usuario_id  uuid REFERENCES usuario(id),
  criado_em   timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (contato_a, contato_b),
  CHECK (contato_a < contato_b)
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contato_fusao', 'contato_par_ignorado'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    -- Registro de prova: só leitura e inserção.
    EXECUTE format('GRANT SELECT, INSERT ON %I TO mg_app', t);
  END LOOP;
END $$;
