-- 019 - Where designer-only boxes sit on the model canvas.
-- Concepts and records keep their position in the versioned graph. Source and
-- typed-record boxes are derived from mappings and records, so their position
-- is plain layout: one row per box, shared by everyone editing the model.
CREATE TABLE IF NOT EXISTS semantic_model.canvas_positions (
  model_id   UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  element_id TEXT        NOT NULL CHECK (char_length(element_id) BETWEEN 1 AND 300),
  x          DOUBLE PRECISION NOT NULL,
  y          DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, element_id)
);
