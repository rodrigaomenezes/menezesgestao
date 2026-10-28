-- Vários telefones, e-mails e endereços por contato (Konecta RF-CRM-002). O telefone e o e-mail principais continuam
-- em `contato` (o telefone segue como chave contra duplicidade, ADR-044); os extras ficam aqui. Um telefone ativo é de
-- um contato só, seja principal ou extra (o serviço confere entre as duas tabelas sob trava; aqui, entre os extras).
-- E-mail pode repetir entre contatos (família, empresa), como o principal; só não repete no mesmo contato. Aditiva.
CREATE TABLE IF NOT EXISTS contato_canal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  contato_id    uuid NOT NULL REFERENCES contato(id),
  tipo          text NOT NULL CHECK (tipo IN ('telefone', 'email')),
  -- Telefone em E.164; e-mail em minúsculas.
  valor         text NOT NULL CHECK (length(valor) BETWEEN 3 AND 200),
  rotulo        text NOT NULL DEFAULT 'outro' CHECK (rotulo IN ('celular', 'whatsapp', 'comercial', 'residencial', 'pessoal', 'outro')),
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS contato_canal_contato_idx ON contato_canal (contato_id) WHERE arquivado_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contato_canal_telefone_uk ON contato_canal (empresa_id, valor) WHERE tipo = 'telefone' AND arquivado_em IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contato_canal_contato_uk ON contato_canal (contato_id, tipo, valor) WHERE arquivado_em IS NULL;

CREATE TABLE IF NOT EXISTS contato_endereco (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  contato_id    uuid NOT NULL REFERENCES contato(id),
  rotulo        text NOT NULL DEFAULT 'residencial' CHECK (rotulo IN ('residencial', 'comercial', 'entrega', 'cobranca', 'outro')),
  cep           text CHECK (cep IS NULL OR cep ~ '^\d{8}$'),
  logradouro    text NOT NULL CHECK (length(logradouro) BETWEEN 1 AND 200),
  numero        text CHECK (numero IS NULL OR length(numero) <= 20),
  complemento   text CHECK (complemento IS NULL OR length(complemento) <= 120),
  bairro        text CHECK (bairro IS NULL OR length(bairro) <= 120),
  cidade        text NOT NULL CHECK (length(cidade) BETWEEN 1 AND 120),
  uf            text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  principal     boolean NOT NULL DEFAULT false,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS contato_endereco_contato_idx ON contato_endereco (contato_id) WHERE arquivado_em IS NULL;
-- No máximo um endereço principal ativo por contato.
CREATE UNIQUE INDEX IF NOT EXISTS contato_endereco_principal_uk ON contato_endereco (contato_id) WHERE principal AND arquivado_em IS NULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contato_canal', 'contato_endereco'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
