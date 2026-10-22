-- Cobrança dos clientes da empresa pelo provedor DELA (Asaas…): a chave fica cifrada (AES-256-GCM) por empresa, a
-- cobrança nasce da venda (Pix, boleto ou link) e o aviso do provedor dá baixa sozinho. Aviso repetido não muda nada.
CREATE TABLE IF NOT EXISTS conta_cobranca (
  empresa_id     uuid PRIMARY KEY REFERENCES empresa(id),
  provedor       text NOT NULL CHECK (provedor IN ('demonstracao','asaas')),
  ambiente       text NOT NULL DEFAULT 'teste' CHECK (ambiente IN ('teste','producao')),
  credenciais    text,          -- JSON cifrado com CRM_CHAVE; nunca volta para a tela
  final_chave    text,          -- 4 últimos caracteres, para a pessoa reconhecer a chave
  token_webhook  text NOT NULL, -- cifrado; o provedor manda de volta em cada aviso
  ativa          boolean NOT NULL DEFAULT true,
  atualizado_por uuid REFERENCES usuario(id),
  atualizado_em  timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cobranca (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  venda_id       uuid NOT NULL REFERENCES venda(id),
  provedor       text NOT NULL,
  id_externo     text,
  forma          text NOT NULL CHECK (forma IN ('pix','boleto','link')),
  valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
  vencimento     date NOT NULL,
  status         text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','paga','vencida','cancelada','estornada')),
  link           text,
  pix_copia_cola text,
  pago_em        timestamptz(3),
  criado_por     uuid REFERENCES usuario(id),
  criado_em      timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_externo_uniq ON cobranca (provedor, id_externo) WHERE id_externo IS NOT NULL;
-- Uma cobrança em aberto por venda.
CREATE UNIQUE INDEX IF NOT EXISTS cobranca_aberta_uniq ON cobranca (venda_id) WHERE status IN ('pendente','vencida');
CREATE INDEX IF NOT EXISTS cobranca_venda_idx ON cobranca (empresa_id, venda_id);

-- Cada aviso do provedor processado uma vez só (idempotência do webhook).
CREATE TABLE IF NOT EXISTS cobranca_aviso (
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  provedor    text NOT NULL,
  id_evento   text NOT NULL,
  cobranca_id uuid REFERENCES cobranca(id),
  tipo        text NOT NULL,
  criado_em   timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, provedor, id_evento)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conta_cobranca','cobranca','cobranca_aviso'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format('CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON conta_cobranca, cobranca TO mg_app;
GRANT SELECT, INSERT ON cobranca_aviso TO mg_app;
