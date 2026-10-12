-- Partitioned storage of the rows a data revision (and a search index generation) owns, so clearing
-- a model's data drops whole partitions instead of deleting the rows one by one through the
-- ON DELETE CASCADE chain (entities -> attributes, links, candidates; generations -> documents,
-- passages and their vector indexes). TRUNCATE is no option: the tables hold every model's rows,
-- and a published revision must survive another model's (or its own draft's) clearing.
--
-- Declarative LIST partitioning, one partition per key value, created by the store code in the
-- transaction that creates the revision / generation (app/persistence/partitions.py):
--   semantic_population.{entities, entity_identities, assertions, assertion_candidates,
--                        relationships}  by data_revision_id
--   semantic_graph_search.{entity_documents, entity_passages}  by index_id (a revision can have
--                        several generations, one per embedding profile, which are built and pruned
--                        separately: the generation is the unit that goes, not the revision)
-- There is deliberately no DEFAULT partition: a row written for a revision without a partition is an
-- error, never a row that a later DROP of partitions would miss.
-- The primary keys and unique constraints carry the partition key (PostgreSQL requires it);
-- assertions, relationships and assertion_candidates therefore key on (data_revision_id, id).
-- Foreign keys between partitioned tables share the key. Indexes are defined here on the parent
-- and inherited by every partition, the two HNSW vector indexes included.
--
-- Not in production: the tables are recreated empty, and what pointed at the dropped rows goes with
-- them (revisions, search generations, serving bindings): models are rebuilt, published again.
-- Needs PostgreSQL 12 or later (foreign keys referencing partitioned tables); the data plane is 17.

DELETE FROM semantic_runtime.active_bindings;

DROP TABLE IF EXISTS semantic_graph_search.entity_passages;
DROP TABLE IF EXISTS semantic_graph_search.entity_documents;
DROP TABLE IF EXISTS semantic_population.assertion_candidates;
DROP TABLE IF EXISTS semantic_population.relationships;
DROP TABLE IF EXISTS semantic_population.assertions;
DROP TABLE IF EXISTS semantic_population.entity_identities;
DROP TABLE IF EXISTS semantic_population.entities;

-- Revisions and generations are the small parent rows; they only hold references to dropped data.
-- (Their ON DELETE actions reach review items and corrections, which keep their rows.)
DELETE FROM semantic_graph_search.index_generations;
DELETE FROM semantic_population.data_revisions;

-- Population ---------------------------------------------------------------------------------------

CREATE TABLE semantic_population.entities (
  id                TEXT        NOT NULL CHECK (char_length(id) BETWEEN 1 AND 300),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  concept_id        TEXT        NOT NULL,
  namespace         TEXT        NOT NULL,
  identity_key      TEXT        NOT NULL,
  label             TEXT        NOT NULL DEFAULT '',
  attributes        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  provenance        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (data_revision_id, id)
) PARTITION BY LIST (data_revision_id);
CREATE INDEX semantic_population_entities_concept_idx
  ON semantic_population.entities (model_id, data_revision_id, concept_id);

CREATE TABLE semantic_population.entity_identities (
  entity_id         TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL,
  alias_namespace   TEXT        NOT NULL,
  alias_key         TEXT        NOT NULL,
  PRIMARY KEY (data_revision_id, alias_namespace, alias_key),
  FOREIGN KEY (data_revision_id, entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
) PARTITION BY LIST (data_revision_id);
CREATE INDEX semantic_population_aliases_entity_idx
  ON semantic_population.entity_identities (data_revision_id, entity_id);

CREATE TABLE semantic_population.assertions (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  entity_id         TEXT        NOT NULL,
  attribute         TEXT        NOT NULL,
  value             TEXT,
  origin            TEXT        NOT NULL DEFAULT 'source'
    CHECK (origin IN ('source', 'human', 'system')),
  validation_state  TEXT        NOT NULL DEFAULT 'accepted'
    CHECK (validation_state IN ('accepted', 'contested', 'retracted')),
  evidence          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  mapping_version   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_revision_id, id),
  UNIQUE (data_revision_id, entity_id, attribute),
  FOREIGN KEY (data_revision_id, entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
) PARTITION BY LIST (data_revision_id);

CREATE TABLE semantic_population.relationships (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  relation_id       TEXT        NOT NULL,
  source_entity_id  TEXT        NOT NULL,
  target_entity_id  TEXT        NOT NULL,
  matching_strategy TEXT,
  state             TEXT        NOT NULL DEFAULT 'accepted'
    CHECK (state IN ('accepted', 'suppressed', 'retracted')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_revision_id, id),
  UNIQUE (data_revision_id, relation_id, source_entity_id, target_entity_id),
  FOREIGN KEY (data_revision_id, source_entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE,
  FOREIGN KEY (data_revision_id, target_entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
) PARTITION BY LIST (data_revision_id);
CREATE INDEX semantic_population_relationships_target_idx
  ON semantic_population.relationships (data_revision_id, relation_id, target_entity_id)
  WHERE state = 'accepted';
CREATE INDEX semantic_population_relationships_source_any_idx
  ON semantic_population.relationships (data_revision_id, source_entity_id)
  WHERE state = 'accepted';
CREATE INDEX semantic_population_relationships_target_any_idx
  ON semantic_population.relationships (data_revision_id, target_entity_id)
  WHERE state = 'accepted';

CREATE TABLE semantic_population.assertion_candidates (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  entity_id         TEXT        NOT NULL,
  attribute         TEXT        NOT NULL,
  value             TEXT,
  origin            TEXT        NOT NULL DEFAULT 'source'
    CHECK (origin IN ('source', 'human', 'system')),
  evidence          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  mapping_version   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_revision_id, id),
  FOREIGN KEY (data_revision_id, entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
) PARTITION BY LIST (data_revision_id);
CREATE INDEX semantic_population_assertion_candidates_entity_idx
  ON semantic_population.assertion_candidates (data_revision_id, entity_id, attribute);

-- Graph search ---------------------------------------------------------------------------------------

CREATE TABLE semantic_graph_search.entity_documents (
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
) PARTITION BY LIST (index_id);
CREATE INDEX semantic_graph_search_documents_concept_idx
  ON semantic_graph_search.entity_documents (index_id, concept_id);
CREATE INDEX semantic_graph_search_documents_pending_idx
  ON semantic_graph_search.entity_documents (index_id) WHERE status = 'pending';
CREATE INDEX semantic_graph_search_documents_lexical_idx
  ON semantic_graph_search.entity_documents USING gin (lexical);
CREATE INDEX semantic_graph_search_documents_label_trgm_idx
  ON semantic_graph_search.entity_documents USING gin (label_key gin_trgm_ops);
CREATE INDEX entity_documents_embedding_hnsw
  ON semantic_graph_search.entity_documents
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE TABLE semantic_graph_search.entity_passages (
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
) PARTITION BY LIST (index_id);
CREATE INDEX semantic_graph_search_passages_concept_idx
  ON semantic_graph_search.entity_passages (index_id, concept_id);
CREATE INDEX semantic_graph_search_passages_pending_idx
  ON semantic_graph_search.entity_passages (index_id) WHERE status = 'pending';
CREATE INDEX semantic_graph_search_passages_lexical_idx
  ON semantic_graph_search.entity_passages USING gin (lexical);
CREATE INDEX entity_passages_embedding_hnsw
  ON semantic_graph_search.entity_passages
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

REVOKE ALL ON semantic_population.entities, semantic_population.entity_identities,
  semantic_population.assertions, semantic_population.assertion_candidates,
  semantic_population.relationships, semantic_graph_search.entity_documents,
  semantic_graph_search.entity_passages FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON semantic_population.entities,
      semantic_population.entity_identities, semantic_population.assertions,
      semantic_population.assertion_candidates, semantic_population.relationships,
      semantic_graph_search.entity_documents, semantic_graph_search.entity_passages
      TO semantic_app;
  END IF;
END $$;
