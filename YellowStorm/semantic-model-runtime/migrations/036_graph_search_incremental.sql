-- Incremental search index generations: a generation built after a population run carries forward the
-- cards, passages and vectors of the model's previous ready generation for every record whose inputs
-- did not change, and builds (then embeds) only the others.
--
-- What "did not change" means is recorded per generation, not read from the population tables: a
-- revision can be re-stored in place under the same id, so the previous generation's own snapshot is
-- the only reliable "before". source_digest is an md5 of everything a record's card is built from
-- (concept, label, key and attribute values, the workspaces it was read from, and the names of the
-- records linked to it), computed in SQL when the card is written. A NULL digest (a generation built
-- before this migration) never matches, so such a generation is never carried from.
--
-- card_digest is the digest of the concept parts the cards are written with (labels, aliases, field
-- set and order, key components): another one means every card may differ, and the build is full.
ALTER TABLE semantic_graph_search.entity_documents
  ADD COLUMN IF NOT EXISTS source_digest TEXT;

ALTER TABLE semantic_graph_search.index_generations
  ADD COLUMN IF NOT EXISTS card_digest   TEXT,
  ADD COLUMN IF NOT EXISTS build_mode    TEXT
    CHECK (build_mode IS NULL OR build_mode IN ('full', 'incremental')),
  -- Why the build was full (no_previous_generation, previous_not_comparable, specification_changed,
  -- too_many_changes, empty_revision); NULL for an incremental one.
  ADD COLUMN IF NOT EXISTS build_reason  TEXT,
  ADD COLUMN IF NOT EXISTS carried_from  UUID,
  ADD COLUMN IF NOT EXISTS carried_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rebuilt_count INT NOT NULL DEFAULT 0,
  -- Records whose vector was computed by the embedding model (not carried, not taken from the cache).
  ADD COLUMN IF NOT EXISTS embedded_count INT NOT NULL DEFAULT 0;

-- The incremental build reports two more steps: 'comparing' (finding the records that changed since the
-- previous generation) and 'carrying' (copying the unchanged ones).
ALTER TABLE semantic_graph_search.index_generations
  DROP CONSTRAINT IF EXISTS index_generations_progress_stage_check;
ALTER TABLE semantic_graph_search.index_generations
  ADD CONSTRAINT index_generations_progress_stage_check
    CHECK (progress_stage IS NULL
           OR progress_stage IN ('comparing', 'carrying', 'documents', 'reusing', 'embedding'));
