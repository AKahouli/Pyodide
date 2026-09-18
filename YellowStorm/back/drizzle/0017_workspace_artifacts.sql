CREATE SCHEMA IF NOT EXISTS workspace;

CREATE TABLE IF NOT EXISTS workspace.workspace_artifacts (
  id             char(24) PRIMARY KEY,
  workspace_id   char(24)     NOT NULL,
  type           varchar(64)  NOT NULL,
  name           varchar(150) NOT NULL,
  description    varchar(1000),
  status         varchar(32)  NOT NULL DEFAULT 'queued',
  schema_version integer      NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  revision       integer      NOT NULL DEFAULT 0 CHECK (revision >= 0),

  primary_source             jsonb    NOT NULL,
  primary_source_document_id char(24) NOT NULL,

  generation_options jsonb NOT NULL,
  payload            jsonb,

  generation_agent_id     char(24) NOT NULL,
  generation_requested_by char(24) NOT NULL,
  generation_attempts     integer  NOT NULL DEFAULT 0,
  generation_started_at   timestamptz,
  generation_completed_at timestamptz,
  generation_error        text,
  lease_token             text,
  lease_expires_at        timestamptz,
  next_attempt_at         timestamptz,
  generation_usage        jsonb,

  cloned_from_artifact_id char(24) REFERENCES workspace.workspace_artifacts(id) ON DELETE SET NULL,
  created_by char(24)    NOT NULL,
  updated_by char(24)    NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_artifacts_ws_type_updated ON workspace.workspace_artifacts (workspace_id, type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_ws_doc_updated  ON workspace.workspace_artifacts (workspace_id, primary_source_document_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_status_next     ON workspace.workspace_artifacts (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_status_lease    ON workspace.workspace_artifacts (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_created_by      ON workspace.workspace_artifacts (created_by);
