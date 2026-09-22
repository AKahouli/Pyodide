-- 0020: post-migration review fixes (2026-09-19).
--
-- 1. Cross-schema FK delete actions. The D.11 / A.12 FKs were added with no ON DELETE
--    action, so deleting a workspace attached to a conversation, a system workspace, or a
--    project failed with 23503. Junction rows cascade; scalar references are nulled.
-- 2. Governance keeps its history. governance_documents and governance_document_events are
--    audit records that must outlive the workspace document they describe (the outbox handler
--    archives them). The FKs that cascade-deleted them are dropped; the ids stay opaque refs.
-- 3. Indexes behind every FK column (parent-side deletes otherwise scan the child table) and
--    single-field Mongo indexes the 0016-0019 DDL missed.
--
-- Idempotent. Runs inside the drizzle migration transaction; tables are small today, the
-- lock_timeout keeps it from queueing behind live traffic if they are not.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Conversation FKs: add explicit delete actions
-- ---------------------------------------------------------------------------
ALTER TABLE conversation.conversation_workspaces DROP CONSTRAINT IF EXISTS fk_conv_ws_workspace;
ALTER TABLE conversation.conversation_workspaces ADD CONSTRAINT fk_conv_ws_workspace
  FOREIGN KEY (workspace_id) REFERENCES workspace.workspaces(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE conversation.conversation_workspaces VALIDATE CONSTRAINT fk_conv_ws_workspace;

ALTER TABLE conversation.conversations DROP CONSTRAINT IF EXISTS fk_conversations_system_workspace;
ALTER TABLE conversation.conversations ADD CONSTRAINT fk_conversations_system_workspace
  FOREIGN KEY (system_workspace_id) REFERENCES workspace.workspaces(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE conversation.conversations VALIDATE CONSTRAINT fk_conversations_system_workspace;

ALTER TABLE conversation.conversations DROP CONSTRAINT IF EXISTS fk_conversations_project;
ALTER TABLE conversation.conversations ADD CONSTRAINT fk_conversations_project
  FOREIGN KEY (project_id) REFERENCES project.projects(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE conversation.conversations VALIDATE CONSTRAINT fk_conversations_project;

-- ---------------------------------------------------------------------------
-- 2. Governance history must survive workspace-document / governance-document deletes
-- ---------------------------------------------------------------------------
ALTER TABLE governance.governance_documents DROP CONSTRAINT IF EXISTS fk_gov_docs_document;
ALTER TABLE governance.governance_documents DROP CONSTRAINT IF EXISTS fk_gov_docs_workspace;
ALTER TABLE governance.governance_document_events
  DROP CONSTRAINT IF EXISTS governance_document_events_governance_document_id_fkey;

-- ---------------------------------------------------------------------------
-- 3a. Indexes behind FK columns
-- ---------------------------------------------------------------------------
-- workspace
CREATE INDEX IF NOT EXISTS idx_documents_parent        ON workspace.workspace_documents (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspaces_settings     ON workspace.workspaces (settings_id) WHERE settings_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_cloned_from   ON workspace.workspace_artifacts (cloned_from_artifact_id) WHERE cloned_from_artifact_id IS NOT NULL;

-- conversation (message self-FKs are ON DELETE SET NULL: every message delete scanned `messages` twice)
CREATE INDEX IF NOT EXISTS idx_conversations_project          ON conversation.conversations (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_system_workspace ON conversation.conversations (system_workspace_id) WHERE system_workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_parent_message        ON conversation.messages (parent_message_id) WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_answer_message        ON conversation.messages (answer_message_id) WHERE answer_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_events_message           ON conversation.conversation_usage_events (message_id) WHERE message_id IS NOT NULL;

-- governance
CREATE INDEX IF NOT EXISTS idx_gov_deployments_scope   ON governance.governance_deployments (scope_id);
CREATE INDEX IF NOT EXISTS idx_gov_dryruns_program     ON governance.governance_dry_runs (program_id);
CREATE INDEX IF NOT EXISTS idx_gov_dryruns_scope       ON governance.governance_dry_runs (scope_id);
CREATE INDEX IF NOT EXISTS idx_gov_dryruns_revision    ON governance.governance_dry_runs (revision_id);
CREATE INDEX IF NOT EXISTS idx_gov_memberships_scope   ON governance.governance_memberships (scope_id) WHERE scope_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gov_metrics_scope       ON governance.governance_metrics (scope_id) WHERE scope_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gov_metrics_deployment  ON governance.governance_metrics (deployment_id) WHERE deployment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gov_pub_scope           ON governance.governance_publication_attempts (scope_id);
CREATE INDEX IF NOT EXISTS idx_gov_pub_revision        ON governance.governance_publication_attempts (revision_id) WHERE revision_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3b. Single-field Mongo indexes missing from 0016-0019
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_documents_created_by    ON workspace.workspace_documents (created_by);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash  ON workspace.workspace_documents (workspace_id, content_hash) WHERE content_hash IS NOT NULL;
-- public-workspace discovery filters on is_public alone; idx_workspaces_flags leads with is_system
CREATE INDEX IF NOT EXISTS idx_workspaces_public       ON workspace.workspaces (created_at DESC) WHERE is_public = true AND is_system = false;
CREATE INDEX IF NOT EXISTS idx_ws_settings_predefined  ON workspace.workspace_settings (created_at DESC) WHERE is_predefined = true;
CREATE INDEX IF NOT EXISTS idx_gov_docs_workspace      ON governance.governance_documents (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gov_metrics_agent       ON governance.governance_metrics (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gov_pub_triggered_by    ON governance.governance_publication_attempts (triggered_by_user_id);

-- ---------------------------------------------------------------------------
-- 4. Fresh planner statistics (most migrated tables were never analyzed after backfill)
-- ---------------------------------------------------------------------------
ANALYZE project.projects;
ANALYZE project.project_shares;
ANALYZE workspace.workspaces;
ANALYZE workspace.workspace_settings;
ANALYZE workspace.workspace_documents;
ANALYZE workspace.workspace_shares;
ANALYZE workspace.workspace_artifacts;
ANALYZE workspace.upload_sessions;
ANALYZE workspace.upload_session_files;
ANALYZE governance.governance_programs;
ANALYZE governance.governance_scopes;
ANALYZE governance.governance_documents;
ANALYZE governance.governance_document_events;
ANALYZE governance.governance_workspace_bindings;
ANALYZE governance.governance_memberships;
ANALYZE governance.governance_deployments;
ANALYZE governance.governance_deployment_revisions;
ANALYZE governance.governance_dry_runs;
ANALYZE governance.governance_metrics;
ANALYZE governance.governance_publication_attempts;
ANALYZE governance.governance_reconciliation_runs;
