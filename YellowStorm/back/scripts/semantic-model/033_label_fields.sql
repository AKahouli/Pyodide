-- 033 - The field that names each record of a concept (its label on the canvas, in lists and in
-- answers), chosen by a person once per concept and used by every source of that concept.
CREATE TABLE IF NOT EXISTS semantic_model.label_fields (
  model_id    UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  concept_id  UUID        NOT NULL,
  field       TEXT        NOT NULL CHECK (length(field) BETWEEN 1 AND 200),
  updated_by  TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, concept_id)
);
