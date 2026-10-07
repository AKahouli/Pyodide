-- P6 logger: application logs move from the Mongo `logs` collection (a separate connection with a
-- 30-day TTL index) to ops.logs. Retention is swept by PgTtlSweeper on created_at, which is the time
-- the entry was logged. Numbered 0036 after 0035_integration_events; 0029/0030 belong to feat/app-templates.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS ops.logs (
  id         char(24)    PRIMARY KEY,
  timestamp  text        NOT NULL,
  level      varchar(8)  NOT NULL
             CONSTRAINT ops_logs_level CHECK (level IN ('ERROR','WARN','INFO','DEBUG','VERBOSE')),
  context    text,
  message    text        NOT NULL,
  data       jsonb,
  trace_id   text,
  request_id text,
  hostname   text,
  node_env   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_created ON ops.logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level_created ON ops.logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_context_created ON ops.logs (context, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_request ON ops.logs (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_trace ON ops.logs (trace_id) WHERE trace_id IS NOT NULL;
