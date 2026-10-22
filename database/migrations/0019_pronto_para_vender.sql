-- Fase 9: pronto para vender. Bloqueio gradual por atraso (só leitura, nunca apagar), suspensão pela plataforma,
-- aceite versionado de termos e confirmação da pessoa para redefinir as duas etapas.

-- A plataforma pode suspender uma empresa (fica só para consulta), com o motivo registrado.
ALTER TABLE assinatura DROP CONSTRAINT IF EXISTS assinatura_status_check;
ALTER TABLE assinatura ADD CONSTRAINT assinatura_status_check CHECK (status IN ('teste','ativa','atrasada','cancelada','suspensa'));
ALTER TABLE assinatura ADD COLUMN IF NOT EXISTS motivo_suspensao text;

-- Aceite dos documentos legais: termos e privacidade por pessoa; contrato de dados pela empresa (quem administra).
CREATE TABLE IF NOT EXISTS termo_aceite (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  empresa_id uuid REFERENCES empresa(id),
  documento  text NOT NULL CHECK (documento IN ('termos','privacidade','contrato')),
  versao     text NOT NULL,
  ip         text,
  aceito_em  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS termo_aceite_pessoa_uk ON termo_aceite (usuario_id, documento, versao) WHERE empresa_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS termo_aceite_empresa_uk ON termo_aceite (empresa_id, documento, versao) WHERE empresa_id IS NOT NULL;
-- Prova de aceite: nunca muda nem some.
DROP TRIGGER IF EXISTS termo_aceite_imutavel ON termo_aceite;
CREATE TRIGGER termo_aceite_imutavel BEFORE UPDATE OR DELETE ON termo_aceite FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao();

-- Pedido de redefinição das duas etapas: o administrador pede, a pessoa confirma pelo e-mail.
ALTER TABLE token_acesso DROP CONSTRAINT IF EXISTS token_acesso_tipo_check;
ALTER TABLE token_acesso ADD CONSTRAINT token_acesso_tipo_check CHECK (tipo IN ('convite','recuperacao','duas_etapas'));

-- Medir uso do plano sem varrer tabelas inteiras.
CREATE INDEX IF NOT EXISTS arquivo_uso_idx ON arquivo (empresa_id) WHERE arquivado_em IS NULL;
ALTER TABLE termo_aceite ENABLE ROW LEVEL SECURITY; -- só o caminho do sistema lê e grava
