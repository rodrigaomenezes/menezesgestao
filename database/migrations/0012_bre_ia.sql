-- Fase 8.2: análise da conversa pela IA. Guarda o que a IA sugeriu, quem forneceu e o que o motor descartou
-- (ETR seção 8: saída versionada e auditável). Somente inserção: correções vão no registro da pessoa.
CREATE TABLE IF NOT EXISTS analise_bre (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  conversa_id uuid NOT NULL REFERENCES conversa(id),
  contato_id  uuid NOT NULL REFERENCES contato(id),
  provedor    text NOT NULL,
  doutrina    text NOT NULL,
  saida       jsonb NOT NULL,
  bloqueios   jsonb NOT NULL DEFAULT '[]',
  autor_id    uuid NOT NULL REFERENCES usuario(id),
  criado_em   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analise_bre_conversa_idx ON analise_bre (empresa_id, conversa_id, criado_em);
ALTER TABLE analise_bre ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento ON analise_bre;
CREATE POLICY isolamento ON analise_bre USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
GRANT SELECT, INSERT ON analise_bre TO mg_app;
