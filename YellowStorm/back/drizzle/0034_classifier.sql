-- P6 classifier: workspace folders (a tree), file-to-folder assignments, classification rules and
-- classification runs. Rows hang off their workspace / document / folder with real foreign keys:
-- a deleted workspace or document takes its classifier rows with it, and deleting a folder
-- cascades to its sub-folders while its files fall back to unassigned. Users are referenced
-- as before (an author cannot be deleted from under its rows; a user's own rules go with the user).
-- Numbered 0034 after 0033_knowledge_intelligence; 0029/0030 belong to feat/app-templates.
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS classifier;

CREATE TABLE IF NOT EXISTS classifier.folders (
  id           char(24)      PRIMARY KEY,
  workspace_id char(24)      NOT NULL REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  parent_id    char(24)      REFERENCES classifier.folders(id) ON DELETE CASCADE,
  name         varchar(100)  NOT NULL
               CONSTRAINT classifier_folders_name CHECK (char_length(name) >= 1),
  description  varchar(1000) NOT NULL
               CONSTRAINT classifier_folders_description CHECK (char_length(description) >= 1),
  created_by   char(24)      NOT NULL REFERENCES identity.users(id),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
-- NULLS NOT DISTINCT: Mongo's unique index treated a missing parent as a value, so two root
-- folders of a workspace could not share a name. Drizzle 0.45 cannot express it (see classifier.schema.ts).
CREATE UNIQUE INDEX IF NOT EXISTS uq_classifier_folders_location
  ON classifier.folders (workspace_id, parent_id, name) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_classifier_folders_parent ON classifier.folders (parent_id);
CREATE INDEX IF NOT EXISTS idx_classifier_folders_workspace_created ON classifier.folders (workspace_id, created_at DESC);

-- Runs come before the assignments that reference them. playbook_id points at the flow store,
-- still in Mongo until roadmap P5, so it has no foreign key yet.
CREATE TABLE IF NOT EXISTS classifier.runs (
  id                    char(24)    PRIMARY KEY,
  workspace_id          char(24)    NOT NULL REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  status                varchar(16) NOT NULL DEFAULT 'queued'
                        CONSTRAINT classifier_runs_status CHECK (status IN ('queued','running','success','failed','cancelled')),
  playbook_id           char(24)    NOT NULL,
  playbook_execution_id text,
  hint                  text,
  overwrite_existing    boolean     NOT NULL DEFAULT false,
  total_files           integer     NOT NULL DEFAULT 0
                        CONSTRAINT classifier_runs_total CHECK (total_files >= 0),
  classified_files      integer     NOT NULL DEFAULT 0
                        CONSTRAINT classifier_runs_classified CHECK (classified_files >= 0),
  error                 text,
  started_at            timestamptz,
  finished_at           timestamptz,
  triggered_by          char(24)    NOT NULL REFERENCES identity.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_classifier_runs_workspace_created ON classifier.runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classifier_runs_status_created ON classifier.runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS classifier.file_assignments (
  id                    char(24)    PRIMARY KEY,
  workspace_id          char(24)    NOT NULL REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  document_id           char(24)    NOT NULL REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  folder_id             char(24)    REFERENCES classifier.folders(id) ON DELETE SET NULL,
  assignment_source     varchar(16) NOT NULL DEFAULT 'manual'
                        CONSTRAINT classifier_assignments_source CHECK (assignment_source IN ('manual','playbook')),
  classification_run_id char(24)    REFERENCES classifier.runs(id) ON DELETE SET NULL,
  assigned_by           char(24)    NOT NULL REFERENCES identity.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_classifier_assignments_document UNIQUE (workspace_id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_classifier_assignments_folder ON classifier.file_assignments (workspace_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_classifier_assignments_folder_only ON classifier.file_assignments (folder_id);
CREATE INDEX IF NOT EXISTS idx_classifier_assignments_document ON classifier.file_assignments (document_id);

CREATE TABLE IF NOT EXISTS classifier.rules (
  id           char(24)      PRIMARY KEY,
  user_id      char(24)      NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  scope        varchar(8)    NOT NULL
               CONSTRAINT classifier_rules_scope CHECK (scope IN ('global','local')),
  workspace_id char(24)      REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  text         varchar(1000) NOT NULL
               CONSTRAINT classifier_rules_text CHECK (char_length(text) >= 1),
  enabled      boolean       NOT NULL DEFAULT true,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  -- A global rule applies everywhere, a local rule belongs to exactly one workspace.
  CONSTRAINT classifier_rules_scope_workspace CHECK ((scope = 'global') = (workspace_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_classifier_rules_user_scope ON classifier.rules (user_id, scope, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_classifier_rules_workspace ON classifier.rules (workspace_id);
