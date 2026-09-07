CREATE TABLE IF NOT EXISTS semantic_model.ontology_artifacts (
  model_id UUID PRIMARY KEY REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  ontology_definition JSONB NOT NULL CHECK (jsonb_typeof(ontology_definition) = 'object'),
  ontology_ttl TEXT NOT NULL CHECK (char_length(ontology_ttl) > 0),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
