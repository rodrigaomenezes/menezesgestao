-- Fase 8.2 (2ª sprint): SQ-BRE dentro da Qualidade, escalonamento, origem das tarefas do motor e alertas de
-- coaching. Aditiva e idempotente; RLS em todas as tabelas novas.

-- SQ-BRE (D-05): prévia da IA e nota confirmada pelo supervisor ficam lado a lado (nada é sobrescrito).
CREATE TABLE IF NOT EXISTS sq_bre (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  conversa_id    uuid NOT NULL REFERENCES conversa(id),
  avaliado_id    uuid NOT NULL REFERENCES usuario(id),
  provedor       text NOT NULL,
  previa         jsonb NOT NULL,
  nota_previa    integer NOT NULL CHECK (nota_previa BETWEEN 0 AND 100),
  confirmada     jsonb,
  nota           integer CHECK (nota IS NULL OR nota BETWEEN 0 AND 100),
  feedback       text CHECK (feedback IS NULL OR length(feedback) <= 2000),
  confirmada_por uuid REFERENCES usuario(id),
  confirmada_em  timestamptz(3),
  criado_por     uuid NOT NULL REFERENCES usuario(id),
  criado_em      timestamptz(3) NOT NULL DEFAULT now(),
  CHECK ((confirmada IS NULL) = (nota IS NULL) AND (nota IS NULL) = (confirmada_em IS NULL))
);
CREATE INDEX IF NOT EXISTS sq_bre_avaliado_idx ON sq_bre (empresa_id, avaliado_id, confirmada_em);
-- Uma prévia aberta por conversa: pedir de novo devolve a mesma.
CREATE UNIQUE INDEX IF NOT EXISTS sq_bre_previa_uk ON sq_bre (empresa_id, conversa_id) WHERE confirmada_em IS NULL;

-- Escalonamento (BR-017): no máximo um aberto por cliente × situação.
CREATE TABLE IF NOT EXISTS escalonamento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  contato_id    uuid NOT NULL REFERENCES contato(id),
  conversa_id   uuid REFERENCES conversa(id),
  situacao      text NOT NULL CHECK (situacao IN ('READY_TO_BUY','TECHNICAL_HELP','VIP','COMPLAINT')),
  origem        text NOT NULL CHECK (origem IN ('ia','manual')),
  observacao    text CHECK (observacao IS NULL OR length(observacao) <= 500),
  status        text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','resolvido')),
  criado_por    uuid REFERENCES usuario(id),
  resolvido_por uuid REFERENCES usuario(id),
  resolvido_em  timestamptz(3),
  criado_em     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS escalonamento_aberto_uk ON escalonamento (empresa_id, contato_id, situacao) WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS escalonamento_status_idx ON escalonamento (empresa_id, status, criado_em);

-- Tarefas criadas pelo motor (pilar Relacionamento do BPI mede as feitas no prazo).
ALTER TABLE tarefa ADD COLUMN IF NOT EXISTS origem_bre text CHECK (origem_bre IS NULL OR origem_bre IN ('retorno','pos_venda'));
CREATE INDEX IF NOT EXISTS tarefa_origem_bre_idx ON tarefa (empresa_id, responsavel_id, vence_em) WHERE origem_bre IS NOT NULL;

-- Alerta de coaching (BR-022): um por pessoa × pilar × semana, para o job poder rodar de novo sem duplicar.
CREATE TABLE IF NOT EXISTS coaching_alerta (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa(id),
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  pilar      text NOT NULL,
  semana     date NOT NULL,
  notas      jsonb NOT NULL,
  criado_em  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, usuario_id, pilar, semana)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sq_bre','escalonamento','coaching_alerta'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
