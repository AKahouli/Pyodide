-- Projection references created before live AGE execution was wired did not
-- prove that a graph existed. Fail closed and require those revisions to be
-- projected again before activation.
DELETE FROM semantic_runtime.active_bindings
WHERE projection_ref !~ '^age:v1:pop_[a-z0-9_]{1,64}$';

UPDATE semantic_population.data_revisions
SET projection_ref = NULL
WHERE projection_ref IS NOT NULL
  AND projection_ref !~ '^age:v1:pop_[a-z0-9_]{1,64}$';
