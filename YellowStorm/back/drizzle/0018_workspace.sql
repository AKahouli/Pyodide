-- schema `workspace` already exists from step 0017

CREATE TABLE IF NOT EXISTS workspace.workspace_settings (
  id            char(24) PRIMARY KEY,
  name          varchar(100) NOT NULL,
  description   varchar(500),
  tag           varchar(50),
  llm_model     varchar(100),                      -- deprecated, kept for back-compat
  is_template   boolean NOT NULL DEFAULT false,
  is_predefined boolean NOT NULL DEFAULT false,
  created_by    char(24) NOT NULL,
  instruction   varchar(10000),
  chunks        integer NOT NULL DEFAULT 5    CHECK (chunks    BETWEEN 1 AND 100),
  hybrid_search boolean NOT NULL DEFAULT false,
  rag_type      varchar(20) NOT NULL DEFAULT 'standard'
                CHECK (rag_type IN ('standard','advancedRag','smartRag')),
  max_token     integer NOT NULL DEFAULT 4096 CHECK (max_token BETWEEN 100 AND 128000),
  top_k         integer NOT NULL DEFAULT 10   CHECK (top_k     BETWEEN 1 AND 100),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ws_settings_owner_created ON workspace.workspace_settings (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ws_settings_template      ON workspace.workspace_settings (is_template, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ws_settings_tag_template  ON workspace.workspace_settings (tag, is_template);

CREATE TABLE IF NOT EXISTS workspace.workspaces (
  id                char(24) PRIMARY KEY,
  name              varchar(100) NOT NULL,
  alias             varchar(100) NOT NULL,
  storage_prefix    varchar(100) NOT NULL,          -- immutable: Ceph object-key segment
  description       varchar(500),
  created_by        char(24) NOT NULL,
  settings_id       char(24) REFERENCES workspace.workspace_settings(id) ON DELETE SET NULL,
  document_count    integer NOT NULL DEFAULT 0 CHECK (document_count >= 0),
  used_storage      bigint  NOT NULL DEFAULT 0 CHECK (used_storage  >= 0),
  allocated_storage bigint  NOT NULL          CHECK (allocated_storage >= 0),
  is_system         boolean NOT NULL DEFAULT false,
  is_personal       boolean NOT NULL DEFAULT false,
  share_count       integer NOT NULL DEFAULT 0 CHECK (share_count >= 0),
  is_public         boolean NOT NULL DEFAULT false,
  conversation_id   char(24),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_owner_name    ON workspace.workspaces (created_by, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_owner_alias   ON workspace.workspaces (created_by, alias);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_owner_prefix  ON workspace.workspaces (created_by, storage_prefix);
CREATE INDEX        IF NOT EXISTS idx_workspaces_owner_created ON workspace.workspaces (created_by, created_at DESC);
CREATE INDEX        IF NOT EXISTS idx_workspaces_alias         ON workspace.workspaces (alias);
CREATE INDEX        IF NOT EXISTS idx_workspaces_flags         ON workspace.workspaces (is_system, is_personal, is_public);

-- storage_prefix is immutable in Mongo; Ceph keys depend on it. Safety net:
CREATE OR REPLACE FUNCTION workspace.forbid_storage_prefix_change() RETURNS trigger AS $$
BEGIN
  IF NEW.storage_prefix IS DISTINCT FROM OLD.storage_prefix THEN
    RAISE EXCEPTION 'storage_prefix is immutable (workspace %)', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_workspaces_prefix_immutable ON workspace.workspaces;
CREATE TRIGGER trg_workspaces_prefix_immutable BEFORE UPDATE ON workspace.workspaces
  FOR EACH ROW EXECUTE FUNCTION workspace.forbid_storage_prefix_change();

CREATE TABLE IF NOT EXISTS workspace.workspace_documents (
  id            char(24) PRIMARY KEY,
  filename      varchar(255),
  original_name varchar(255) NOT NULL,
  mime_type     varchar(100) NOT NULL,
  size          bigint       NOT NULL CHECK (size >= 0),
  path          varchar(500),
  url           varchar(1000),
  content_hash  varchar(64),
  workspace_id  char(24) NOT NULL REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  created_by    char(24) NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','uploading','processing','completed','failed')),
  uploaded_at   timestamptz,
  error_message varchar(500),
  metadata      jsonb,
  indexing_status varchar(20) NOT NULL DEFAULT 'none'
                CHECK (indexing_status IN ('none','pending','processing','ready','failed')),
  indexing_error                text,
  indexing_task_name            text,
  indexing_task_id              text,
  indexing_attempt_id           text,
  indexing_attempt_started_at   timestamptz,
  indexing_attempt_completed_at timestamptz,
  last_indexed_at               timestamptz,
  indexing_started_at           timestamptz,
  detected_language text,
  chunk_size        integer DEFAULT 1200,
  parent_id   char(24) REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  is_folder   boolean NOT NULL DEFAULT false,
  folder_name varchar(255),
  type        varchar(10) NOT NULL DEFAULT 'doc' CHECK (type IN ('doc','url')),
  source_url  varchar(2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_documents_ws_created  ON workspace.workspace_documents (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_ws_status   ON workspace.workspace_documents (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_ws_parent   ON workspace.workspace_documents (workspace_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_ws_folder   ON workspace.workspace_documents (workspace_id, is_folder);
CREATE INDEX IF NOT EXISTS idx_documents_path        ON workspace.workspace_documents (path);
CREATE INDEX IF NOT EXISTS idx_documents_indexing    ON workspace.workspace_documents (indexing_status);
CREATE INDEX IF NOT EXISTS idx_documents_attempt     ON workspace.workspace_documents (indexing_attempt_id);
CREATE INDEX IF NOT EXISTS idx_documents_type        ON workspace.workspace_documents (type);
-- Mongo: { workspaceId:1, originalName:1 } unique, partialFilterExpression { isFolder: false }
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_ws_name_files
  ON workspace.workspace_documents (workspace_id, original_name) WHERE is_folder = false;

CREATE TABLE IF NOT EXISTS workspace.workspace_shares (
  id                  char(24) PRIMARY KEY,
  workspace_id        char(24) NOT NULL REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  owner_id            char(24) NOT NULL,
  shared_with_user_id char(24) NOT NULL,
  permission          varchar(16) NOT NULL CHECK (permission IN ('read','readwrite')),
  shared_by           char(24) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ws_shares_ws_user     ON workspace.workspace_shares (workspace_id, shared_with_user_id);
CREATE INDEX        IF NOT EXISTS idx_ws_shares_user_created ON workspace.workspace_shares (shared_with_user_id, created_at DESC);
CREATE INDEX        IF NOT EXISTS idx_ws_shares_ws_created   ON workspace.workspace_shares (workspace_id, created_at DESC);
CREATE INDEX        IF NOT EXISTS idx_ws_shares_owner        ON workspace.workspace_shares (owner_id);

CREATE TABLE IF NOT EXISTS workspace.upload_sessions (
  id              char(24) PRIMARY KEY,
  workspace_id    char(24) NOT NULL REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  user_id         char(24) NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','completed','expired','failed')),
  total_files     integer NOT NULL,
  total_size      bigint  NOT NULL,
  completed_files integer NOT NULL DEFAULT 0,
  failed_files    integer NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_ws_status  ON workspace.upload_sessions (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_user       ON workspace.upload_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires    ON workspace.upload_sessions (expires_at);

-- files[] is mutated positionally (files.$.status / files.$.progress) → child table, not jsonb
CREATE TABLE IF NOT EXISTS workspace.upload_session_files (
  session_id  char(24) NOT NULL REFERENCES workspace.upload_sessions(id) ON DELETE CASCADE,
  file_index  integer  NOT NULL,
  filename    varchar(255) NOT NULL,
  mime_type   varchar(100) NOT NULL,
  size        bigint       NOT NULL,
  document_id char(24),
  upload_url  varchar(2000),
  status      varchar(20) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','uploading','completed','failed')),
  progress    smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  error       varchar(500),
  PRIMARY KEY (session_id, file_index)
);
