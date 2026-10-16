-- App Builder template revisions: dedicated persistence for template
-- manifests/revision metadata, modeled on the App Builder runtime's
-- source_revisions shape. One row per publish event per template.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS conversation_v2.template_revisions (
  id                  char(24)     PRIMARY KEY,
  template_id         char(24)     NOT NULL
                      REFERENCES conversation_v2.templates(id) ON DELETE CASCADE,
  -- Template revision id, e.g. template_<templateId>; matches templates.revision_id.
  revision_id         text         NOT NULL,
  -- Ceph manifest location: appbuilder/manifests/_system/<revision_id>.json.
  manifest_object_key text         NOT NULL,
  manifest_hash       varchar(64)  NOT NULL,
  files               jsonb        NOT NULL,
  file_count          integer      NOT NULL DEFAULT 0 CHECK (file_count >= 0),
  status              varchar(16)  NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published')),
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_tpl_revisions_revision
  ON conversation_v2.template_revisions (revision_id);
CREATE INDEX IF NOT EXISTS idx_c2_tpl_revisions_template
  ON conversation_v2.template_revisions (template_id);
