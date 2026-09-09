-- =============================================================================
-- SEMANTIC MODEL — Script de déploiement complet
-- =============================================================================
-- Consolide les scripts 001 → 007 dans l'ordre d'application.
-- Tous les statements sont idempotents (IF NOT EXISTS / IF EXISTS).
--
-- PRÉREQUIS :
--   1. L'extension Apache AGE doit être installée sur l'instance PostgreSQL.
--   2. Remplacer 'semantic_model_graph' par la valeur de la variable d'env
--      SEMANTIC_AGE_GRAPH si elle est différente.
--
-- USAGE :
--   psql -U <user> -d <database> -f 000_deploy_all.sql
-- =============================================================================


-- =============================================================================
-- 001 — Tables principales + schéma
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS semantic_model;

CREATE TABLE IF NOT EXISTS semantic_model.schema_migrations (
  version    TEXT        PRIMARY KEY,
  checksum   TEXT        NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semantic_model.models (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id               TEXT        NOT NULL,
  name                        TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  description                 TEXT        NOT NULL DEFAULT '',
  kind                        TEXT        NOT NULL CHECK (kind IN ('workspace_default', 'designed')),
  status                      TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  revision                    BIGINT      NOT NULL DEFAULT 0 CHECK (revision >= 0),
  origin_workspace_id         TEXT,
  name_managed_by_system      BOOLEAN     NOT NULL DEFAULT false,
  current_draft_version_id    UUID,
  current_published_version_id UUID,
  archived_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_models_active_origin_uidx
  ON semantic_model.models (origin_workspace_id)
  WHERE kind = 'workspace_default' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS semantic_model.versions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_number INTEGER     NOT NULL CHECK (version_number > 0),
  status         TEXT        NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  revision       BIGINT      NOT NULL DEFAULT 0 CHECK (revision >= 0),
  base_version_id UUID       REFERENCES semantic_model.versions(id),
  created_by     TEXT        NOT NULL,
  published_by   TEXT,
  published_at   TIMESTAMPTZ,
  snapshot_hash  TEXT        NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_versions_one_draft_uidx
  ON semantic_model.versions (model_id) WHERE status = 'draft';

ALTER TABLE semantic_model.models
  DROP CONSTRAINT IF EXISTS semantic_models_current_draft_fk;
ALTER TABLE semantic_model.models
  ADD CONSTRAINT semantic_models_current_draft_fk
  FOREIGN KEY (current_draft_version_id) REFERENCES semantic_model.versions(id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE semantic_model.models
  DROP CONSTRAINT IF EXISTS semantic_models_current_published_fk;
ALTER TABLE semantic_model.models
  ADD CONSTRAINT semantic_models_current_published_fk
  FOREIGN KEY (current_published_version_id) REFERENCES semantic_model.versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS semantic_model.workspace_links (
  model_id    UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  workspace_id TEXT       NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('origin', 'connected')),
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  created_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, workspace_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_workspace_origin_uidx
  ON semantic_model.workspace_links (model_id) WHERE role = 'origin' AND enabled;

CREATE TABLE IF NOT EXISTS semantic_model.node_types (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  model_id      UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id    UUID        NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  key           TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  category      TEXT        NOT NULL CHECK (category IN ('business_object', 'classification', 'system_collection')),
  record_policy TEXT        NOT NULL DEFAULT 'none' CHECK (record_policy IN ('none', 'optional', 'expected')),
  system_key    TEXT,
  aliases       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  attributes    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  position      JSONB       NOT NULL DEFAULT '{"x":0,"y":0}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, id),
  UNIQUE (version_id, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_node_system_key_uidx
  ON semantic_model.node_types (version_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS semantic_model.relation_types (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  model_id            UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id          UUID        NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  key                 TEXT        NOT NULL,
  label               TEXT        NOT NULL,
  inverse_label       TEXT        NOT NULL DEFAULT '',
  description         TEXT        NOT NULL DEFAULT '',
  source_node_type_id UUID        NOT NULL,
  target_node_type_id UUID        NOT NULL,
  cardinality         TEXT        NOT NULL CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many')),
  traversable         BOOLEAN     NOT NULL DEFAULT true,
  filterable          BOOLEAN     NOT NULL DEFAULT true,
  attributes          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, id),
  FOREIGN KEY (version_id, source_node_type_id) REFERENCES semantic_model.node_types(version_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (version_id, target_node_type_id) REFERENCES semantic_model.node_types(version_id, id) ON DELETE RESTRICT,
  UNIQUE (version_id, key)
);

CREATE TABLE IF NOT EXISTS semantic_model.records (
  id           UUID        NOT NULL DEFAULT gen_random_uuid(),
  model_id     UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id   UUID        NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  node_type_id UUID        NOT NULL,
  label        TEXT        NOT NULL,
  values       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  position     JSONB       NOT NULL DEFAULT '{"x":0,"y":0}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, id),
  FOREIGN KEY (version_id, node_type_id) REFERENCES semantic_model.node_types(version_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS semantic_model.record_relations (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  model_id         UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id       UUID        NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  relation_type_id UUID        NOT NULL,
  source_record_id UUID        NOT NULL,
  target_record_id UUID        NOT NULL,
  values           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, id),
  FOREIGN KEY (version_id, relation_type_id) REFERENCES semantic_model.relation_types(version_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (version_id, source_record_id)  REFERENCES semantic_model.records(version_id, id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, target_record_id)  REFERENCES semantic_model.records(version_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS semantic_model.knowledge_bindings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  target_kind    TEXT        NOT NULL CHECK (target_kind IN ('model', 'node_type', 'relation_type', 'record')),
  target_id      UUID,
  resource_kind  TEXT        NOT NULL CHECK (resource_kind IN ('workspace', 'document')),
  workspace_id   TEXT        NOT NULL,
  document_id    TEXT,
  inclusion_mode TEXT        NOT NULL CHECK (inclusion_mode IN ('dynamic', 'explicit')),
  retrieval_mode TEXT        NOT NULL DEFAULT 'broad' CHECK (retrieval_mode IN ('broad', 'targeted', 'evidence_only')),
  priority       INTEGER     NOT NULL DEFAULT 0,
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  protected      BOOLEAN     NOT NULL DEFAULT false,
  availability   TEXT        NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'indexing', 'unavailable')),
  created_by     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((resource_kind = 'document' AND document_id IS NOT NULL AND inclusion_mode = 'explicit') OR
         (resource_kind = 'workspace' AND document_id IS NULL))
);

CREATE TABLE IF NOT EXISTS semantic_model.memberships (
  model_id   UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL,
  role       TEXT        NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, user_id)
);

CREATE TABLE IF NOT EXISTS semantic_model.events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id     UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id   UUID        REFERENCES semantic_model.versions(id) ON DELETE SET NULL,
  actor_user_id TEXT       NOT NULL,
  event_type   TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index de base (001)
CREATE INDEX IF NOT EXISTS semantic_models_owner_updated_idx    ON semantic_model.models           (owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS semantic_workspace_links_workspace_idx ON semantic_model.workspace_links (workspace_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS semantic_bindings_workspace_idx      ON semantic_model.knowledge_bindings (workspace_id, enabled);
CREATE INDEX IF NOT EXISTS semantic_bindings_document_idx       ON semantic_model.knowledge_bindings (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS semantic_events_model_created_idx    ON semantic_model.events           (model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS semantic_records_version_type_idx    ON semantic_model.records          (version_id, node_type_id);


-- =============================================================================
-- 002 — Initialisation du graph Apache AGE
-- =============================================================================
-- IMPORTANT : remplacer 'semantic_model_graph' si SEMANTIC_AGE_GRAPH est différent.

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

SELECT ag_catalog.create_graph('semantic_model_graph')
WHERE NOT EXISTS (
  SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'semantic_model_graph'
);

-- Bootstrap : crée puis supprime un vertex pour initialiser les labels internes AGE.
SELECT * FROM ag_catalog.cypher('semantic_model_graph', $$
  CREATE (n:SemanticNodeType {bootstrap: true}) RETURN n
$$) AS (created ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('semantic_model_graph', $$
  MATCH (n:SemanticNodeType {bootstrap: true}) DELETE n RETURN 1
$$) AS (deleted ag_catalog.agtype);


-- =============================================================================
-- 003 — Index de performance supplémentaires
-- =============================================================================

CREATE INDEX IF NOT EXISTS semantic_node_types_model_version_idx
  ON semantic_model.node_types (model_id, version_id);
CREATE INDEX IF NOT EXISTS semantic_relation_types_model_version_idx
  ON semantic_model.relation_types (model_id, version_id);
CREATE INDEX IF NOT EXISTS semantic_records_model_version_idx
  ON semantic_model.records (model_id, version_id);
CREATE INDEX IF NOT EXISTS semantic_record_relations_version_idx
  ON semantic_model.record_relations (version_id);
CREATE INDEX IF NOT EXISTS semantic_versions_model_status_idx
  ON semantic_model.versions (model_id, status, version_number DESC);


-- =============================================================================
-- 004 — Contrainte d'unicité sur les relations entre records
-- =============================================================================
-- Supprime les éventuels doublons existants avant de créer l'index unique.

WITH duplicates AS (
  SELECT version_id, id,
         ROW_NUMBER() OVER (
           PARTITION BY version_id, relation_type_id, source_record_id, target_record_id
           ORDER BY created_at, id
         ) AS duplicate_number
  FROM semantic_model.record_relations
)
DELETE FROM semantic_model.record_relations relation
USING duplicates
WHERE relation.version_id = duplicates.version_id
  AND relation.id         = duplicates.id
  AND duplicates.duplicate_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS semantic_record_relation_identity_uidx
  ON semantic_model.record_relations (version_id, relation_type_id, source_record_id, target_record_id);


-- =============================================================================
-- 005 — Table des artifacts d'ontologie
-- =============================================================================

CREATE TABLE IF NOT EXISTS semantic_model.ontology_artifacts (
  model_id            UUID        PRIMARY KEY REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  ontology_definition JSONB       NOT NULL CHECK (jsonb_typeof(ontology_definition) = 'object'),
  ontology_ttl        TEXT        NOT NULL CHECK (char_length(ontology_ttl) > 0),
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- 006 — Table des jobs de mapping
-- =============================================================================

CREATE TABLE IF NOT EXISTS semantic_model.mapping_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running', 'completed', 'failed')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  result         JSONB,
  error          TEXT,
  search_summary JSONB
);

CREATE INDEX IF NOT EXISTS mapping_runs_model_id_idx
  ON semantic_model.mapping_runs (model_id, started_at DESC);


-- =============================================================================
-- 007 — Informations utilisateur dénormalisées dans les memberships
-- =============================================================================
-- Permet de lister les membres partagés sans lookup cross-DB vers MongoDB.

ALTER TABLE semantic_model.memberships
  ADD COLUMN IF NOT EXISTS email      TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name  TEXT;


-- =============================================================================
-- 008 — Table des builds (orchestration ontology + mapping + apply)
-- =============================================================================

CREATE TABLE IF NOT EXISTS semantic_model.build_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id              UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  started_by            TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'running'
                                    CHECK (status IN ('running', 'completed', 'failed')),
  current_step          TEXT        CHECK (current_step IN ('ontology', 'mapping', 'apply') OR current_step IS NULL),
  ontology_status       TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (ontology_status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  mapping_status        TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (mapping_status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  apply_status          TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (apply_status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  business_requirements JSONB       NOT NULL DEFAULT '[]'::jsonb,
  apply_mode            TEXT        NOT NULL DEFAULT 'replace'
                                    CHECK (apply_mode IN ('replace', 'incremental')),
  mapping_job_id        UUID,
  graph_warning         TEXT,
  error                 TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ontology_completed_at TIMESTAMPTZ,
  mapping_completed_at  TIMESTAMPTZ,
  apply_completed_at    TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  last_heartbeat_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS build_runs_model_id_idx
  ON semantic_model.build_runs (model_id, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS build_runs_one_active_per_model_uidx
  ON semantic_model.build_runs (model_id)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS build_runs_heartbeat_active_idx
  ON semantic_model.build_runs (last_heartbeat_at)
  WHERE status = 'running';


-- =============================================================================
-- FIN
-- =============================================================================

CREATE TABLE IF NOT EXISTS semantic_model.graph_index_jobs (
  model_id UUID PRIMARY KEY REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','indexed','failed')),
  target_version_id UUID NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  target_revision INTEGER NOT NULL,
  indexed_version_id UUID REFERENCES semantic_model.versions(id) ON DELETE SET NULL,
  indexed_revision INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS graph_index_jobs_ready_idx
  ON semantic_model.graph_index_jobs (next_attempt_at, updated_at)
  WHERE status IN ('pending','in_progress');
