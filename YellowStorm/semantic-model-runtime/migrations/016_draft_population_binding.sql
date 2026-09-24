ALTER TABLE semantic_runtime.active_bindings
  DROP CONSTRAINT IF EXISTS active_bindings_environment_check;

ALTER TABLE semantic_runtime.active_bindings
  ADD CONSTRAINT active_bindings_environment_check
  CHECK (environment IN ('draft', 'production', 'shadow', 'test'));
