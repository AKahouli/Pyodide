-- P2.6 recovery indexes. Additive only: no table, column or data change.
--
-- recovery_stalled_tasks scans by task state/lease and by published dispatch
-- age. The existing indexes lead with queue_name / unpublished rows, so these
-- two partial indexes keep recovery from becoming per-iteration table scans.
CREATE INDEX IF NOT EXISTS semantic_jobs_tasks_recovery_idx
  ON semantic_jobs.tasks (lease_expires_at, id)
  WHERE state = 'running';

CREATE INDEX IF NOT EXISTS semantic_jobs_outbox_published_idx
  ON semantic_jobs.outbox (published_at, id)
  WHERE published_at IS NOT NULL;
