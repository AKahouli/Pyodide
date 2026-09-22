-- 008 — Absorb ad-hoc drift: structured_mapping on concept/relation types.
--
-- The deployed database carries structured_mapping JSONB on node_types and
-- relation_types, but no tracked migration, script, or code reference creates
-- it. This statement makes the column explicit so data migration preserves
-- values instead of silently dropping them. Nullable, no backfill: absent
-- values stay NULL, which readers already tolerate.
-- Apply as the schema owner (semantic_app on agentstore).

ALTER TABLE IF EXISTS semantic_model.node_types
  ADD COLUMN IF NOT EXISTS structured_mapping JSONB;

ALTER TABLE IF EXISTS semantic_model.relation_types
  ADD COLUMN IF NOT EXISTS structured_mapping JSONB;
