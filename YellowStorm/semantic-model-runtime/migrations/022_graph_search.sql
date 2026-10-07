-- Graph search: one search document per record of a data revision, with its
-- embedding, so agents can find records by meaning and then follow the
-- revision's AGE relationships. A generation is immutable once ready; a new
-- revision or a new embedding profile makes a new generation. Vectors are
-- halfvec because the embedding model has 2560 dimensions (vector indexes stop
-- at 2000). Requires pgvector >= 0.7 already installed in this database.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'graph search needs the pgvector extension (vector >= 0.7) in this database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'graph search needs the pg_trgm extension in this database';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS semantic_graph_search;

CREATE TABLE IF NOT EXISTS semantic_graph_search.index_generations (
  index_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id              TEXT        NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 200),
  data_revision_id      TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  projection_ref        TEXT        NOT NULL,
  spec_hash             TEXT        NOT NULL,
  embedding_fingerprint TEXT        NOT NULL CHECK (char_length(embedding_fingerprint) BETWEEN 1 AND 100),
  state                 TEXT        NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'indexing', 'ready', 'failed')),
  attempt               INT         NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  owner                 TEXT,
  lease_until           TIMESTAMPTZ,
  job_id                UUID,
  expected_count        INT         NOT NULL DEFAULT 0,
  indexed_count         INT         NOT NULL DEFAULT 0,
  exact_only_count      INT         NOT NULL DEFAULT 0,
  failed_count          INT         NOT NULL DEFAULT 0,
  reused_count          INT         NOT NULL DEFAULT 0,
  embedding_calls       INT         NOT NULL DEFAULT 0,
  last_error_code       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  UNIQUE (data_revision_id, embedding_fingerprint)
);
CREATE INDEX IF NOT EXISTS semantic_graph_search_generations_model_idx
  ON semantic_graph_search.index_generations (model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS semantic_graph_search.entity_documents (
  index_id          UUID        NOT NULL REFERENCES semantic_graph_search.index_generations(index_id)
    ON DELETE CASCADE,
  entity_id         TEXT        NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 300),
  concept_id        TEXT        NOT NULL,
  label             TEXT        NOT NULL DEFAULT '',
  label_key         TEXT        NOT NULL DEFAULT '',
  source_workspaces TEXT[]      NOT NULL DEFAULT '{}',
  search_text       TEXT        NOT NULL,
  lexical           tsvector    NOT NULL,
  content_hash      TEXT        NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  embedding         halfvec(2560),
  status            TEXT        NOT NULL CHECK (status IN ('pending', 'ready', 'exact_only')),
  diagnostics       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (index_id, entity_id),
  CHECK (status <> 'ready' OR embedding IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS semantic_graph_search_documents_concept_idx
  ON semantic_graph_search.entity_documents (index_id, concept_id);
CREATE INDEX IF NOT EXISTS semantic_graph_search_documents_pending_idx
  ON semantic_graph_search.entity_documents (index_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS semantic_graph_search_documents_lexical_idx
  ON semantic_graph_search.entity_documents USING gin (lexical);
CREATE INDEX IF NOT EXISTS semantic_graph_search_documents_label_trgm_idx
  ON semantic_graph_search.entity_documents USING gin (label_key gin_trgm_ops);

-- Vectors already computed for a model, by search text: a rebuild after a
-- correction embeds only the records whose text changed. Scoped per model so
-- nothing about one model's content is observable from another.
CREATE TABLE IF NOT EXISTS semantic_graph_search.embedding_cache (
  model_id              TEXT          NOT NULL,
  embedding_fingerprint TEXT          NOT NULL,
  content_hash          TEXT          NOT NULL,
  embedding             halfvec(2560) NOT NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, embedding_fingerprint, content_hash)
);

REVOKE ALL ON ALL TABLES IN SCHEMA semantic_graph_search FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT USAGE ON SCHEMA semantic_graph_search TO semantic_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA semantic_graph_search TO semantic_app;
  END IF;
END $$;
