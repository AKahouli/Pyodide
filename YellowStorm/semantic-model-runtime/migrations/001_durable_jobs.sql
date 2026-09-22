-- P2.4 durable jobs. PostgreSQL 17.6; semantic_jobs is runtime-owned.
-- RabbitMQ transports task references. These tables remain authoritative.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS semantic_jobs;

CREATE TABLE IF NOT EXISTS semantic_jobs.jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type          TEXT        NOT NULL,
  actor_user_id     TEXT        NOT NULL,
  model_id          TEXT,
  workspace_id      TEXT,
  idempotency_key   TEXT        NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  command_hash      TEXT        NOT NULL CHECK (command_hash ~ '^sha256:[0-9a-f]{64}$'),
  command           JSONB       NOT NULL,
  state             TEXT        NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'waiting_dependencies', 'running', 'cancel_requested',
                     'completed', 'completed_with_gaps', 'failed', 'cancelled', 'superseded')),
  progress          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result            JSONB,
  error_code        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS semantic_jobs_jobs_scope_idx
  ON semantic_jobs.jobs (actor_user_id, model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS semantic_jobs.tasks (
  id                BIGSERIAL   PRIMARY KEY,
  job_id            UUID        NOT NULL REFERENCES semantic_jobs.jobs(id) ON DELETE CASCADE,
  task_key          TEXT        NOT NULL CHECK (char_length(task_key) BETWEEN 1 AND 300),
  task_name         TEXT        NOT NULL,
  queue_name        TEXT        NOT NULL,
  payload           JSONB       NOT NULL,
  state             TEXT        NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'superseded')),
  attempt_count     INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_epoch       BIGINT      NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_owner       TEXT,
  lease_expires_at  TIMESTAMPTZ,
  checkpoint        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result            JSONB,
  error_code        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, task_key)
);

CREATE INDEX IF NOT EXISTS semantic_jobs_tasks_claim_idx
  ON semantic_jobs.tasks (queue_name, state, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS semantic_jobs.outbox (
  id                BIGSERIAL   PRIMARY KEY,
  task_id           BIGINT      NOT NULL REFERENCES semantic_jobs.tasks(id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL CHECK (event_type = 'task.dispatch'),
  payload           JSONB       NOT NULL,
  attempt_count     INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_owner       TEXT,
  claim_expires_at  TIMESTAMPTZ,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at      TIMESTAMPTZ,
  last_error_code   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_jobs_outbox_task_dispatch_uidx
  ON semantic_jobs.outbox (task_id, event_type);
CREATE INDEX IF NOT EXISTS semantic_jobs_outbox_claim_idx
  ON semantic_jobs.outbox (next_attempt_at, id) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS semantic_jobs.events (
  id                BIGSERIAL   PRIMARY KEY,
  job_id            UUID        NOT NULL REFERENCES semantic_jobs.jobs(id) ON DELETE CASCADE,
  task_id           BIGINT      REFERENCES semantic_jobs.tasks(id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL,
  payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS semantic_jobs_events_replay_idx
  ON semantic_jobs.events (job_id, id);

-- Runtime roles are deployment-owned. Do not grant PUBLIC access to this schema.
REVOKE ALL ON SCHEMA semantic_jobs FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA semantic_jobs FROM PUBLIC;
