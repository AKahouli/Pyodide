-- Corrections can be undone: an undo is itself a correction ('revert') that
-- names the sequence it cancels, so the model's correction watermark still
-- advances and every rebuild replays the same history.
ALTER TABLE semantic_population.corrections
  DROP CONSTRAINT IF EXISTS corrections_action_check;
ALTER TABLE semantic_population.corrections
  ADD CONSTRAINT corrections_action_check
  CHECK (action IN ('create_entity', 'edit_entity', 'remove_entity',
                    'add_relationship', 'remove_relationship',
                    'set_override', 'reset_override', 'suppress', 'unsuppress',
                    'revert'));
