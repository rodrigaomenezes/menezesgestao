-- Fase 7.6: o Início que cada pessoa monta. Uma linha por pessoa × empresa com a ordem dos blocos escolhida;
-- blocos NULL = padrão do perfil (montado no servidor). Voltar ao padrão grava NULL: nada é apagado.

CREATE TABLE IF NOT EXISTS inicio_pessoa (
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  blocos        jsonb CHECK (blocos IS NULL OR (jsonb_typeof(blocos) = 'array' AND jsonb_array_length(blocos) <= 30)),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, usuario_id)
);

ALTER TABLE inicio_pessoa ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento ON inicio_pessoa;
CREATE POLICY isolamento ON inicio_pessoa USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
GRANT SELECT, INSERT, UPDATE ON inicio_pessoa TO mg_app;
