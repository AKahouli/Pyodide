-- WP07 source only. Apply to an authorized database before enabling runtime.
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS conversation.root_background_control_instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  instance_id uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO conversation.root_background_control_instance(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS conversation.root_background_jobs (
  execution_id char(24) PRIMARY KEY REFERENCES conversation.root_executions(id) ON DELETE CASCADE,
  parent_execution_id char(24) NOT NULL REFERENCES conversation.root_executions(id) ON DELETE CASCADE,
  conversation_id char(24) NOT NULL REFERENCES conversation.conversations(id) ON DELETE CASCADE,
  actor_id char(24) NOT NULL,
  conversation_epoch integer NOT NULL,
  request_digest char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'queued',
  owner varchar(128), fence integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL, lease_until timestamptz, deadline timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(), native_session_id varchar(256) NOT NULL,
  native_invocation_id varchar(128), initial_input_event_id varchar(128), initial_input_digest char(64), started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT root_background_jobs_status CHECK (status IN ('queued','running','waiting','completed','failed','cancelled','outcome_unknown')),
  CONSTRAINT root_background_jobs_attempts CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 5 AND fence >= 0)
);
ALTER TABLE conversation.root_background_jobs ADD COLUMN IF NOT EXISTS initial_input_event_id varchar(128);
ALTER TABLE conversation.root_background_jobs ADD COLUMN IF NOT EXISTS initial_input_digest char(64);
ALTER TABLE conversation.root_background_jobs ADD COLUMN IF NOT EXISTS native_owner varchar(128);
ALTER TABLE conversation.root_background_jobs ADD COLUMN IF NOT EXISTS native_owner_fence integer;
ALTER TABLE conversation.root_background_jobs ADD COLUMN IF NOT EXISTS pending_input_responses jsonb;
ALTER TABLE conversation.root_background_jobs ADD COLUMN IF NOT EXISTS input_response_digest char(64);
ALTER TABLE conversation.root_background_jobs ADD COLUMN IF NOT EXISTS input_response_event_id varchar(128);
CREATE INDEX IF NOT EXISTS idx_root_background_jobs_claim ON conversation.root_background_jobs(status, available_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_root_background_jobs_parent ON conversation.root_background_jobs(parent_execution_id);
CREATE INDEX IF NOT EXISTS idx_root_background_jobs_actor ON conversation.root_background_jobs(actor_id);
CREATE TABLE IF NOT EXISTS conversation.root_background_actions (
  execution_id char(24) NOT NULL REFERENCES conversation.root_background_jobs(execution_id) ON DELETE CASCADE,
  native_call_id varchar(128) NOT NULL, tool_name varchar(256) NOT NULL, args_digest char(64) NOT NULL,
  status varchar(32) NOT NULL, receipt jsonb, owner varchar(128) NOT NULL, fence integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(execution_id, native_call_id),
  CONSTRAINT root_background_actions_status CHECK(status IN ('started','succeeded','outcome_unknown'))
);
CREATE TABLE IF NOT EXISTS conversation.root_background_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execution_id char(24) NOT NULL REFERENCES conversation.root_background_jobs(execution_id) ON DELETE CASCADE,
  conversation_id char(24) NOT NULL REFERENCES conversation.conversations(id) ON DELETE CASCADE,
  actor_id char(24) NOT NULL, conversation_epoch integer NOT NULL,
  event_id varchar(128) NOT NULL, payload_digest char(64) NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_root_background_events_replay ON conversation.root_background_events(conversation_id, conversation_epoch, sequence);
