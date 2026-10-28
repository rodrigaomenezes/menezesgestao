-- Documento (CPF/CNPJ) do contato, trazido dos requisitos da Konecta (RF-CRM-002, campo mascarado, RNF-022):
-- o número inteiro só existe cifrado (AES-256-GCM com CRM_CHAVE); o hash (HMAC) impede o repetido e acha pela busca;
-- o final fica em claro só para a máscara (•••.•••.123-45). Aditiva: contatos antigos ficam sem documento.
ALTER TABLE contato ADD COLUMN IF NOT EXISTS documento_tipo text CHECK (documento_tipo IN ('cpf', 'cnpj'));
ALTER TABLE contato ADD COLUMN IF NOT EXISTS documento_final text;
ALTER TABLE contato ADD COLUMN IF NOT EXISTS documento_cifrado text;
ALTER TABLE contato ADD COLUMN IF NOT EXISTS documento_hash text;
DO $$ BEGIN
  ALTER TABLE contato ADD CONSTRAINT contato_documento_completo CHECK (
    (documento_tipo IS NULL AND documento_final IS NULL AND documento_cifrado IS NULL AND documento_hash IS NULL)
    OR (documento_tipo IS NOT NULL AND documento_final IS NOT NULL AND documento_cifrado IS NOT NULL AND documento_hash IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Como o telefone: o mesmo documento nunca vira dois contatos na empresa (o arquivado também conta: restaure-o).
CREATE UNIQUE INDEX IF NOT EXISTS contato_documento_uk ON contato (empresa_id, documento_hash) WHERE documento_hash IS NOT NULL;
