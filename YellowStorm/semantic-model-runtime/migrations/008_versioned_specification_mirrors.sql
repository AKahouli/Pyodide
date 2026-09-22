-- Draft versions are edited in place. Keep every executable snapshot immutable
-- by including its canonical content hash in the mirror identity.
ALTER TABLE semantic_runtime.specifications
  DROP CONSTRAINT IF EXISTS specifications_home_workspace_id_model_id_model_version_id_key;

ALTER TABLE semantic_runtime.specifications
  ADD CONSTRAINT specifications_workspace_model_version_hash_key
  UNIQUE (home_workspace_id, model_id, model_version_id, spec_hash);
