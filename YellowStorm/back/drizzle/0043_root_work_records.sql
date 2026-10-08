-- WP03 root-delegation runtime foundation: work-group/execution/evidence
-- identity records and the conversation Stop request anchor (plan §9.1, §11.1).
--
-- root_executions holds one row per logical execution (root, library/temporary
-- worker, fan-out driver, follow-up). It is distinct from
-- conversation.conversation_executions, which enforces a single running
-- foreground run per conversation and keys on messageId; root work is a tree of
-- concurrent child executions with its own depth/epoch lifecycle.
--
-- root_evidence_records is the durable citation/artifact reference registry
-- (plan §12): producers commit before returning references to the parent.
-- dedup_key = hash(producer execution, native tool/event identity, output
-- ordinal) makes replayed registrations return the same identity.
--
-- conversation.conversations.root_work_last_stop_request_id records the last
-- accepted Stop request so a retried old Stop cannot cancel a later request.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS conversation.root_executions (
  id                  char(24) PRIMARY KEY,
  conversation_id     char(24) NOT NULL REFERENCES conversation.conversations(id) ON DELETE CASCADE,
  root_agent_id       char(24),
  work_group_id       char(24),
  parent_execution_id char(24),
  role                varchar(32) NOT NULL,
  depth               integer NOT NULL DEFAULT 0,
  attempt             integer NOT NULL DEFAULT 1,
  status              varchar(32) NOT NULL DEFAULT 'running',
  conversation_epoch  integer NOT NULL DEFAULT 0,
  stop_request_id     uuid,
  result_payload      jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  terminal_at         timestamptz,
  CONSTRAINT root_executions_role_check CHECK (role IN ('root', 'library_worker', 'temporary_worker', 'fanout_driver', 'followup')),
  CONSTRAINT root_executions_status_check CHECK (status IN ('running', 'waiting', 'completed', 'cancelled', 'cancellation_requested', 'failed', 'outcome_unknown'))
);

CREATE INDEX IF NOT EXISTS idx_root_executions_conversation_epoch
  ON conversation.root_executions (conversation_id, conversation_epoch);
CREATE INDEX IF NOT EXISTS idx_root_executions_parent
  ON conversation.root_executions (parent_execution_id) WHERE parent_execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_root_executions_work_group
  ON conversation.root_executions (work_group_id) WHERE work_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_root_executions_nonterminal
  ON conversation.root_executions (conversation_id)
  WHERE status IN ('running', 'waiting', 'cancellation_requested');

CREATE TABLE IF NOT EXISTS conversation.root_evidence_records (
  id                  char(24) PRIMARY KEY,
  execution_id        char(24) NOT NULL REFERENCES conversation.root_executions(id) ON DELETE CASCADE,
  conversation_id     char(24) NOT NULL REFERENCES conversation.conversations(id) ON DELETE CASCADE,
  kind                varchar(32) NOT NULL,
  producer_agent_id   char(24),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedup_key           varchar(128) NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT root_evidence_kind_check CHECK (kind IN ('citation', 'artifact'))
);

CREATE INDEX IF NOT EXISTS idx_root_evidence_execution
  ON conversation.root_evidence_records (execution_id);

ALTER TABLE conversation.conversations ADD COLUMN IF NOT EXISTS root_work_last_stop_request_id uuid;

-- Backport note (WP08 rollout): environments that applied the original
-- char(36) version of this file must also run, per database:
--   ALTER TABLE conversation.root_executions ALTER COLUMN stop_request_id TYPE uuid USING stop_request_id::uuid;
--   ALTER TABLE conversation.conversations ALTER COLUMN root_work_last_stop_request_id TYPE uuid USING root_work_last_stop_request_id::uuid;
