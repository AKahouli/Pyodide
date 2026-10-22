-- App Builder template catalog: admin-managed categories + React/Vite templates.
-- Templates are published to Ceph (content-addressed blobs + a _system manifest)
-- and resolved by RuntimeRevisionService through revision_id `template_<id>`.
SET LOCAL lock_timeout = '5s';

-- Session revision seed (template `template_<id>` or system starter).
ALTER TABLE IF EXISTS conversation_v2.sessions
  ADD COLUMN IF NOT EXISTS starter_revision_id text;

CREATE TABLE IF NOT EXISTS conversation_v2.template_categories (
  id         char(24)     PRIMARY KEY,
  name       varchar(128) NOT NULL,
  slug       varchar(160) NOT NULL,
  icon       varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT c2_tpl_categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_tpl_categories_slug
  ON conversation_v2.template_categories (slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_tpl_categories_name
  ON conversation_v2.template_categories (name);

CREATE TABLE IF NOT EXISTS conversation_v2.templates (
  id                  char(24)     PRIMARY KEY,
  category_id         char(24)     NOT NULL
                      REFERENCES conversation_v2.template_categories(id) ON DELETE CASCADE,
  title               varchar(200) NOT NULL,
  description         text         NOT NULL DEFAULT '',
  cover_image         text         NOT NULL DEFAULT '',
  revision_id         text,
  manifest_object_key text,
  status              varchar(16)  NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published')),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_templates_category_title
  ON conversation_v2.templates (category_id, title);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_templates_revision
  ON conversation_v2.templates (revision_id) WHERE revision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_c2_templates_category
  ON conversation_v2.templates (category_id);
