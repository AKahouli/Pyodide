-- P8 app-runtime: bindings, tickets, tool_calls, source_revisions,
-- finalized_revisions, ai_preview_tickets (Mongo cutover).
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS app_runtime;

-- bindings
CREATE TABLE IF NOT EXISTS app_runtime.bindings (
  binding_id              varchar(64)   PRIMARY KEY,
  workspace_id            varchar(128)  UNIQUE NOT NULL,
  conversation_session_id varchar(128)  NOT NULL,
  user_id                 char(24)      NOT NULL,
  status                  varchar(32)   NOT NULL DEFAULT 'created'
                          CHECK (status IN ('created','waiting_for_browser','browser_active','paused','failed')),
  latest_revision_id      text          NOT NULL DEFAULT 'starter_react_vite_v6',
  mcp_token_hash          text          NOT NULL,
  browser_runtime_id      text,
  browser_capabilities    jsonb,
  last_heartbeat_at       timestamptz,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ar_bindings_mcp_token_hash
  ON app_runtime.bindings (mcp_token_hash);
CREATE INDEX IF NOT EXISTS idx_ar_bindings_conversation_session
  ON app_runtime.bindings (conversation_session_id);
CREATE INDEX IF NOT EXISTS idx_ar_bindings_user
  ON app_runtime.bindings (user_id);

-- tickets
CREATE TABLE IF NOT EXISTS app_runtime.tickets (
  runtime_session_id      varchar(64)   PRIMARY KEY,
  ticket_hash             text          UNIQUE NOT NULL,
  binding_id              varchar(64)   NOT NULL,
  workspace_id            varchar(128)  NOT NULL,
  user_id                 char(24)      NOT NULL,
  expires_at              timestamptz   NOT NULL,
  consumed_at             timestamptz,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);

-- tool_calls
CREATE TABLE IF NOT EXISTS app_runtime.tool_calls (
  tool_call_id            text          PRIMARY KEY,
  binding_id              varchar(64)   NOT NULL,
  workspace_id            varchar(128)  NOT NULL,
  tool                    text          NOT NULL,
  arguments_hash          text          NOT NULL,
  base_revision_id        text,
  status                  varchar(16)   NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','succeeded','failed')),
  result                  jsonb,
  error                   jsonb,
  resulting_revision_id   text,
  started_at_ms           bigint,
  duration_ms             integer,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ar_tool_calls_binding
  ON app_runtime.tool_calls (binding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_tool_calls_workspace
  ON app_runtime.tool_calls (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_tool_calls_tool
  ON app_runtime.tool_calls (tool, created_at DESC);

-- source_revisions
CREATE TABLE IF NOT EXISTS app_runtime.source_revisions (
  id                      char(24)      PRIMARY KEY,
  revision_id             text          NOT NULL,
  workspace_id            varchar(128)  NOT NULL,
  parent_revision_id      text,
  manifest_hash           text          NOT NULL,
  manifest_object_key     text          NOT NULL,
  files                   jsonb         NOT NULL DEFAULT '[]',
  created_by_tool_call_id text,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_source_revisions_ws_rev
  ON app_runtime.source_revisions (workspace_id, revision_id);

-- finalized_revisions
CREATE TABLE IF NOT EXISTS app_runtime.finalized_revisions (
  id                      char(24)      PRIMARY KEY,
  workspace_id            varchar(128)  NOT NULL,
  revision_id             text          NOT NULL,
  title                   text          NOT NULL,
  finalized_at            timestamptz   NOT NULL,
  event_id                text          NOT NULL,
  file_count              integer,
  ceph_manifest_path      text,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_finalized_revisions_ws_rev
  ON app_runtime.finalized_revisions (workspace_id, revision_id);
CREATE INDEX IF NOT EXISTS idx_ar_finalized_revisions_ws_at
  ON app_runtime.finalized_revisions (workspace_id, finalized_at DESC);

-- ai_preview_tickets
CREATE TABLE IF NOT EXISTS app_runtime.ai_preview_tickets (
  id                      char(24)      PRIMARY KEY,
  ticket_hash             text          UNIQUE NOT NULL,
  conversation_session_id varchar(128)  NOT NULL,
  workspace_id            varchar(128)  NOT NULL,
  binding_id              varchar(64)   NOT NULL,
  billable_user_id        char(24)      NOT NULL,
  purpose                 text          NOT NULL DEFAULT 'ai_preview',
  expires_at              timestamptz   NOT NULL,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ar_ai_preview_tickets_session
  ON app_runtime.ai_preview_tickets (conversation_session_id);
CREATE INDEX IF NOT EXISTS idx_ar_ai_preview_tickets_workspace
  ON app_runtime.ai_preview_tickets (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ar_ai_preview_tickets_binding
  ON app_runtime.ai_preview_tickets (binding_id);
CREATE INDEX IF NOT EXISTS idx_ar_ai_preview_tickets_billable_user
  ON app_runtime.ai_preview_tickets (billable_user_id);
