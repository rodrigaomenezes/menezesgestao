-- Fase 8.3: campos de inteligência. Um campo personalizado do contato pode contar como "inteligência" do método
-- BRE: entra na completude do CRM (pilar Inteligência do BPI) e no "o que falta saber" do pré-contato (FR-006).
ALTER TABLE campo_personalizado ADD COLUMN IF NOT EXISTS inteligencia_bre boolean NOT NULL DEFAULT false;
