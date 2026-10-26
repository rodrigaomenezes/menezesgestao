-- Perfis padrão vindos da Konecta: Empresário (vê tudo e trabalha nos contatos), Supervisor (trabalha na equipe,
-- sem administrar) e Auditor (só leitura, com auditoria). Empresas novas já nascem com eles (criar-empresa.ts);
-- aqui as existentes os recebem, uma vez só. Permissões geradas de permissoesDoPerfilBase() (catalogo.ts).

WITH novo AS (
  INSERT INTO perfil (empresa_id, nome, base, protegido)
  SELECT e.id, 'Empresário', 'empresario', false FROM empresa e
  WHERE NOT EXISTS (SELECT 1 FROM perfil p WHERE p.empresa_id = e.id AND p.base = 'empresario')
  RETURNING id, empresa_id
)
INSERT INTO permissao (empresa_id, perfil_id, modulo, acao, escopo)
SELECT novo.empresa_id, novo.id, m.modulo, m.acao, m.escopo FROM novo
CROSS JOIN (VALUES ('usuarios', 'ver', 'empresa'),
  ('configuracoes', 'ver', 'empresa'),
  ('auditoria', 'ver', 'empresa'),
  ('crm', 'ver', 'empresa'),
  ('crm', 'criar', 'empresa'),
  ('crm', 'editar', 'empresa'),
  ('crm', 'arquivar', 'empresa'),
  ('conversas', 'ver', 'empresa'),
  ('telefonia', 'ver', 'empresa'),
  ('fila', 'ver', 'empresa'),
  ('agenda', 'ver', 'empresa'),
  ('rotina', 'ver', 'empresa'),
  ('desempenho', 'ver', 'empresa'),
  ('mapa', 'ver', 'empresa'),
  ('scripts', 'ver', 'empresa'),
  ('qualidade', 'ver', 'empresa'),
  ('vendas', 'ver', 'empresa'),
  ('servicos', 'ver', 'empresa'),
  ('pesquisa', 'ver', 'empresa'),
  ('bre', 'ver', 'empresa')) AS m(modulo, acao, escopo);

WITH novo AS (
  INSERT INTO perfil (empresa_id, nome, base, protegido)
  SELECT e.id, 'Supervisor', 'supervisor', false FROM empresa e
  WHERE NOT EXISTS (SELECT 1 FROM perfil p WHERE p.empresa_id = e.id AND p.base = 'supervisor')
  RETURNING id, empresa_id
)
INSERT INTO permissao (empresa_id, perfil_id, modulo, acao, escopo)
SELECT novo.empresa_id, novo.id, m.modulo, m.acao, m.escopo FROM novo
CROSS JOIN (VALUES ('usuarios', 'ver', 'equipe'),
  ('crm', 'ver', 'equipe'),
  ('crm', 'criar', 'equipe'),
  ('crm', 'editar', 'equipe'),
  ('crm', 'arquivar', 'equipe'),
  ('conversas', 'ver', 'equipe'),
  ('conversas', 'criar', 'equipe'),
  ('conversas', 'editar', 'equipe'),
  ('conversas', 'arquivar', 'equipe'),
  ('telefonia', 'ver', 'equipe'),
  ('telefonia', 'criar', 'equipe'),
  ('telefonia', 'editar', 'equipe'),
  ('telefonia', 'arquivar', 'equipe'),
  ('fila', 'ver', 'equipe'),
  ('fila', 'criar', 'equipe'),
  ('fila', 'editar', 'equipe'),
  ('fila', 'arquivar', 'equipe'),
  ('agenda', 'ver', 'equipe'),
  ('agenda', 'criar', 'equipe'),
  ('agenda', 'editar', 'equipe'),
  ('agenda', 'arquivar', 'equipe'),
  ('rotina', 'ver', 'equipe'),
  ('rotina', 'criar', 'equipe'),
  ('rotina', 'editar', 'equipe'),
  ('rotina', 'arquivar', 'equipe'),
  ('desempenho', 'ver', 'equipe'),
  ('mapa', 'ver', 'equipe'),
  ('scripts', 'ver', 'equipe'),
  ('qualidade', 'ver', 'equipe'),
  ('qualidade', 'criar', 'equipe'),
  ('qualidade', 'editar', 'equipe'),
  ('qualidade', 'arquivar', 'equipe'),
  ('vendas', 'ver', 'equipe'),
  ('vendas', 'criar', 'equipe'),
  ('vendas', 'editar', 'equipe'),
  ('vendas', 'arquivar', 'equipe'),
  ('servicos', 'ver', 'equipe'),
  ('pesquisa', 'ver', 'equipe'),
  ('bre', 'ver', 'equipe'),
  ('bre', 'criar', 'equipe'),
  ('bre', 'editar', 'equipe'),
  ('bre', 'arquivar', 'equipe')) AS m(modulo, acao, escopo);

WITH novo AS (
  INSERT INTO perfil (empresa_id, nome, base, protegido)
  SELECT e.id, 'Auditor', 'auditor', false FROM empresa e
  WHERE NOT EXISTS (SELECT 1 FROM perfil p WHERE p.empresa_id = e.id AND p.base = 'auditor')
  RETURNING id, empresa_id
)
INSERT INTO permissao (empresa_id, perfil_id, modulo, acao, escopo)
SELECT novo.empresa_id, novo.id, m.modulo, m.acao, m.escopo FROM novo
CROSS JOIN (VALUES ('usuarios', 'ver', 'empresa'),
  ('configuracoes', 'ver', 'empresa'),
  ('auditoria', 'ver', 'empresa'),
  ('crm', 'ver', 'empresa'),
  ('conversas', 'ver', 'empresa'),
  ('telefonia', 'ver', 'empresa'),
  ('fila', 'ver', 'empresa'),
  ('agenda', 'ver', 'empresa'),
  ('rotina', 'ver', 'empresa'),
  ('desempenho', 'ver', 'empresa'),
  ('mapa', 'ver', 'empresa'),
  ('scripts', 'ver', 'empresa'),
  ('qualidade', 'ver', 'empresa'),
  ('vendas', 'ver', 'empresa'),
  ('servicos', 'ver', 'empresa'),
  ('pesquisa', 'ver', 'empresa'),
  ('bre', 'ver', 'empresa')) AS m(modulo, acao, escopo);
