-- Durable, non-authoritative UI invalidation signals for REST Broadcast.
CREATE TABLE IF NOT EXISTS semantic_jobs.ui_signal_outbox (
  id                BIGSERIAL   PRIMARY KEY,
  model_id          UUID        NOT NULL,
  event_type        TEXT        NOT NULL CHECK (event_type IN (
    'data-revision-changed', 'datasource-status-changed',
    'review-items-changed', 'population-status-changed',
    'model-read-state-changed'
  )),
  resource          TEXT,
  payload           JSONB       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status            TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  available_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_owner       TEXT,
  claim_until       TIMESTAMPTZ,
  attempt_count     INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  published_at      TIMESTAMPTZ,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS semantic_ui_signal_claim_idx
  ON semantic_jobs.ui_signal_outbox (available_at, id)
  WHERE status IN ('pending', 'publishing');
CREATE INDEX IF NOT EXISTS semantic_ui_signal_model_idx
  ON semantic_jobs.ui_signal_outbox (model_id, created_at DESC);

REVOKE ALL ON semantic_jobs.ui_signal_outbox FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE ON semantic_jobs.ui_signal_outbox TO semantic_app;
    GRANT USAGE, SELECT ON SEQUENCE semantic_jobs.ui_signal_outbox_id_seq TO semantic_app;
  END IF;
END $$;
