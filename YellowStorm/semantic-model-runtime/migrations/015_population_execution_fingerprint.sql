-- Mapping and relation execution details are revision identity, even when the
-- semantic specification and source bytes are unchanged.
ALTER TABLE semantic_population.data_revisions
  ADD COLUMN execution_fingerprint TEXT;

ALTER TABLE semantic_population.data_revisions
  ADD CONSTRAINT data_revisions_execution_fingerprint_format
  CHECK (execution_fingerprint IS NULL OR execution_fingerprint ~ '^sha256:[0-9a-f]{64}$');
