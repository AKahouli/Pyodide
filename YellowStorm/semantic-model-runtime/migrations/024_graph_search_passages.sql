-- Graph search passages: a field too long for its record's search card (an
-- e-mail body, a contract text) is also split into overlapping passages, each
-- with its own words and vector, so a request matching words deep in the text
-- still finds the record. Same lifecycle as entity_documents: one set per index
-- generation, gone with it (and with its record's document) by cascade, never
-- copied by a model clone. Exact cosine like entity_documents (no ANN index).
CREATE TABLE IF NOT EXISTS semantic_graph_search.entity_passages (
  index_id          UUID          NOT NULL,
  entity_id         TEXT          NOT NULL,
  ordinal           INT           NOT NULL CHECK (ordinal >= 0),
  concept_id        TEXT          NOT NULL,
  field_key         TEXT          NOT NULL CHECK (char_length(field_key) BETWEEN 1 AND 300),
  field_label       TEXT          NOT NULL DEFAULT '',
  start_offset      INT           NOT NULL CHECK (start_offset >= 0),
  end_offset        INT           NOT NULL,
  passage_text      TEXT          NOT NULL,
  search_text       TEXT          NOT NULL,
  lexical           tsvector      NOT NULL,
  content_hash      TEXT          NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  embedding         halfvec(2560),
  status            TEXT          NOT NULL CHECK (status IN ('pending', 'ready')),
  source_workspaces TEXT[]        NOT NULL DEFAULT '{}',
  PRIMARY KEY (index_id, entity_id, ordinal),
  FOREIGN KEY (index_id, entity_id)
    REFERENCES semantic_graph_search.entity_documents (index_id, entity_id) ON DELETE CASCADE,
  CHECK (end_offset > start_offset),
  CHECK (status <> 'ready' OR embedding IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS semantic_graph_search_passages_concept_idx
  ON semantic_graph_search.entity_passages (index_id, concept_id);
CREATE INDEX IF NOT EXISTS semantic_graph_search_passages_pending_idx
  ON semantic_graph_search.entity_passages (index_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS semantic_graph_search_passages_lexical_idx
  ON semantic_graph_search.entity_passages USING gin (lexical);

ALTER TABLE semantic_graph_search.index_generations
  ADD COLUMN IF NOT EXISTS passage_count           INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passage_indexed_count   INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passage_truncated_count INT NOT NULL DEFAULT 0;

REVOKE ALL ON semantic_graph_search.entity_passages FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON semantic_graph_search.entity_passages TO semantic_app;
  END IF;
END $$;
