-- Fase 8.4: automação do método BRE (Fase 4 da ETR). Só o que o livro diz que é automatizável, por modelo de texto
-- da empresa, ligado só com a concordância IA × equipe liberada (DEC-010). Cada envio ou pulo fica registrado uma
-- vez por automação × cliente × referência: rodar o job de novo nunca duplica mensagem.
CREATE TABLE IF NOT EXISTS bre_automacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  tipo          text NOT NULL CHECK (tipo IN ('POS_VENDA','ANIVERSARIO','REENTRADA')),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  canal_id      uuid NOT NULL REFERENCES canal(id),
  texto         text NOT NULL CHECK (length(texto) BETWEEN 1 AND 1000),
  dias          integer CHECK (dias IS NULL OR dias BETWEEN 1 AND 365),
  campo_chave   text,
  ativa         boolean NOT NULL DEFAULT false,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  CHECK (tipo <> 'POS_VENDA' OR dias IS NOT NULL),
  CHECK (tipo <> 'ANIVERSARIO' OR campo_chave IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS bre_automacao_idx ON bre_automacao (empresa_id, ativa);

CREATE TABLE IF NOT EXISTS bre_automacao_execucao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  automacao_id uuid NOT NULL REFERENCES bre_automacao(id),
  contato_id   uuid NOT NULL REFERENCES contato(id),
  referencia   text NOT NULL,
  status       text NOT NULL CHECK (status IN ('enviada','ignorada')),
  detalhe      text,
  mensagem_id  uuid REFERENCES mensagem(id),
  criado_em    timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (automacao_id, contato_id, referencia)
);
CREATE INDEX IF NOT EXISTS bre_automacao_execucao_idx ON bre_automacao_execucao (empresa_id, criado_em);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bre_automacao','bre_automacao_execucao'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON bre_automacao TO mg_app;
GRANT SELECT, INSERT ON bre_automacao_execucao TO mg_app;
