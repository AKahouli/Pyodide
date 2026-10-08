-- Rename the legacy `conversation_v2` database naming to `app_builder`.
-- Historical migrations 0022/0026/0030/0031/0037/0042 keep their original
-- `conversation_v2` names (already applied); this migration converges existing
-- databases onto the App Builder naming without touching the data.
--
-- Renames: schema, the catalog model default column/index, and the c2_-prefixed
-- indexes/constraints that live inside the schema. Idempotent on re-run.
SET LOCAL lock_timeout = '5s';

-- 1. Schema: conversation_v2 -> app_builder.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'conversation_v2')
     AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app_builder') THEN
    ALTER SCHEMA conversation_v2 RENAME TO app_builder;
  END IF;
END $$;

-- 2. Model default column: is_conversation_v2_default -> is_app_builder_default.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'ai_models'
      AND column_name = 'is_conversation_v2_default'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'catalog' AND table_name = 'ai_models'
      AND column_name = 'is_app_builder_default'
  ) THEN
    ALTER TABLE catalog.ai_models
      RENAME COLUMN is_conversation_v2_default TO is_app_builder_default;
  END IF;
END $$;

-- 3. Model default index: uq_ai_models_single_v2_default -> ..._app_builder_default.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'catalog' AND c.relname = 'uq_ai_models_single_v2_default'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'catalog' AND c.relname = 'uq_ai_models_single_app_builder_default'
  ) THEN
    ALTER INDEX catalog.uq_ai_models_single_v2_default
      RENAME TO uq_ai_models_single_app_builder_default;
  END IF;
END $$;

-- 4. Indexes inside app_builder: c2_ prefix -> ab_.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('idx_c2_sessions_owner_deleted_last',   'idx_ab_sessions_owner_deleted_last'),
    ('uq_c2_sessions_ai_session',            'uq_ab_sessions_ai_session'),
    ('uq_c2_sessions_share_token',           'uq_ab_sessions_share_token'),
    ('uq_c2_events_session_sequence',        'uq_ab_events_session_sequence'),
    ('uq_c2_events_session_event_id',        'uq_ab_events_session_event_id'),
    ('idx_c2_events_session_type_sequence',  'idx_ab_events_session_type_sequence'),
    ('uq_c2_shares_session_user',            'uq_ab_shares_session_user'),
    ('uq_c2_shares_session_email',           'uq_ab_shares_session_email'),
    ('uq_c2_shares_invite_token',            'uq_ab_shares_invite_token'),
    ('idx_c2_shares_recipient_updated',      'idx_ab_shares_recipient_updated'),
    ('idx_c2_sessions_system_workspace',     'idx_ab_sessions_system_workspace'),
    ('idx_c2_app_shares_owner',              'idx_ab_app_shares_owner'),
    ('uq_c2_tpl_categories_slug',            'uq_ab_tpl_categories_slug'),
    ('uq_c2_tpl_categories_name',            'uq_ab_tpl_categories_name'),
    ('uq_c2_templates_category_title',       'uq_ab_templates_category_title'),
    ('uq_c2_templates_revision',             'uq_ab_templates_revision'),
    ('idx_c2_templates_category',            'idx_ab_templates_category'),
    ('uq_c2_tpl_revisions_revision',         'uq_ab_tpl_revisions_revision'),
    ('idx_c2_tpl_revisions_template',        'idx_ab_tpl_revisions_template')
  ) AS v(old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app_builder' AND c.relname = r.old_name
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app_builder' AND c.relname = r.new_name
    ) THEN
      EXECUTE format('ALTER INDEX app_builder.%I RENAME TO %I', r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;

-- 5. Explicitly named constraints inside app_builder: c2_ prefix -> ab_.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('template_categories', 'c2_tpl_categories_slug_format',       'ab_tpl_categories_slug_format'),
    ('sessions',            'fk_c2_sessions_owner',                'fk_ab_sessions_owner'),
    ('sessions',            'fk_c2_sessions_system_workspace',     'fk_ab_sessions_system_workspace'),
    ('app_shares',          'fk_c2_app_shares_owner',              'fk_ab_app_shares_owner'),
    ('app_shares',          'fk_c2_app_shares_recipient',          'fk_ab_app_shares_recipient')
  ) AS v(tbl, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'app_builder' AND rel.relname = r.tbl AND c.conname = r.old_name
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname = 'app_builder' AND rel.relname = r.tbl AND c.conname = r.new_name
    ) THEN
      EXECUTE format('ALTER TABLE app_builder.%I RENAME CONSTRAINT %I TO %I', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;
