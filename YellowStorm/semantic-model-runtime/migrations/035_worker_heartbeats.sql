-- Worker liveness. Each Celery worker upserts one row about every 15 s; a worker counts as
-- online while last_seen is recent (45 s). A job read joins this to tell "queued behind other
-- jobs" from "queued with nobody consuming the queue". Additive only; rows of workers that
-- stopped hard simply age out of the window and are replaced on the next start.
CREATE TABLE IF NOT EXISTS semantic_jobs.worker_heartbeats (
  worker_id   TEXT        PRIMARY KEY CHECK (char_length(worker_id) BETWEEN 1 AND 300),
  queues      TEXT[]      NOT NULL,
  pid         INTEGER,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON semantic_jobs.worker_heartbeats FROM PUBLIC;
