-- How many times a model's data was cleared to be rebuilt from scratch. The
-- count goes into the data revision id, so a rebuild after a reset never reuses
-- a revision kept for another environment (the published data, for instance).
CREATE TABLE IF NOT EXISTS semantic_population.model_data_resets (
  model_id    TEXT        PRIMARY KEY CHECK (char_length(model_id) BETWEEN 1 AND 200),
  generation  INTEGER     NOT NULL DEFAULT 1 CHECK (generation >= 1),
  reset_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON semantic_population.model_data_resets FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON semantic_population.model_data_resets TO semantic_app;
  END IF;
END $$;
