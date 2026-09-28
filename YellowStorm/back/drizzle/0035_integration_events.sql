-- P6 integration-events: the transactional outbox of the workspace, indexing, governance and
-- semantic-model integration, in the ops schema. An event row is written in the caller's
-- transaction and claimed by the dispatcher with FOR UPDATE SKIP LOCKED. The per-handler delivery
-- state that Mongo kept in an embedded array is its own table, so a delivery is opened, completed
-- or failed with one atomic statement instead of a positional array update.
-- Numbered 0035 after 0034_classifier; 0029/0030 belong to feat/app-templates.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS ops.integration_events (
  id              char(24)    PRIMARY KEY,
  event_id        text        NOT NULL,
  event_type      text        NOT NULL,
  aggregate_type  text        NOT NULL,
  aggregate_id    text        NOT NULL,
  payload         jsonb       NOT NULL,
  occurred_at     timestamptz NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'pending'
                  CONSTRAINT ops_integration_events_status CHECK (status IN ('pending','processing','completed','failed','dead_letter')),
  attempts        integer     NOT NULL DEFAULT 0
                  CONSTRAINT ops_integration_events_attempts CHECK (attempts >= 0),
  next_attempt_at timestamptz,
  locked_at       timestamptz,
  lock_owner      text,
  processed_at    timestamptz,
  last_error      text,
  correlation_id  text,
  causation_id    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- A producer that records the same event twice is a no-op (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_events_event_id ON ops.integration_events (event_id);
-- The claim scans only what can be delivered: due pending / failed events, and claims that may have expired.
CREATE INDEX IF NOT EXISTS idx_integration_events_claim ON ops.integration_events (next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_integration_events_processing ON ops.integration_events (locked_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_integration_events_aggregate ON ops.integration_events (aggregate_type, aggregate_id, occurred_at);

CREATE TABLE IF NOT EXISTS ops.integration_event_deliveries (
  integration_event_id char(24)    NOT NULL REFERENCES ops.integration_events(id) ON DELETE CASCADE,
  handler_key          text        NOT NULL,
  status               varchar(16) NOT NULL DEFAULT 'pending'
                       CONSTRAINT ops_integration_event_deliveries_status CHECK (status IN ('pending','completed','failed')),
  attempts             integer     NOT NULL DEFAULT 0
                       CONSTRAINT ops_integration_event_deliveries_attempts CHECK (attempts >= 0),
  last_error           text,
  completed_at         timestamptz,
  PRIMARY KEY (integration_event_id, handler_key)
);
