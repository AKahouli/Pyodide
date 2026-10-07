-- 034 - Who may use the semantic model tools of an agent (Admin > Semantic models). enforce_permissions
-- (default true): the person the agent acts for needs the semantic_models permissions. An admin can
-- turn that off for a while; model membership and workspace access are still checked.
ALTER TABLE semantic_model.extraction_settings
  ADD COLUMN IF NOT EXISTS assistant_settings JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(assistant_settings) = 'object');
