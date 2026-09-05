-- =============================================================================
-- 008 — Table des builds (orchestration ontology + mapping + apply)
-- =============================================================================
-- Un build = une exécution enchainée des 3 étapes lancée depuis l'UI
-- « Construire le graphe ». Fire-and-forget côté serveur, poll côté client.
-- Le heartbeat permet de détecter un process mort sans imposer de timeout global.

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

-- Index pour récupérer le dernier build d'un modèle rapidement (banner UI).
CREATE INDEX IF NOT EXISTS build_runs_model_id_idx
  ON semantic_model.build_runs (model_id, started_at DESC);

-- Empêche 2 builds actifs simultanés sur un même modèle. La détection de
-- zombie (heartbeat expiré) doit d'abord passer le job en 'failed' avant
-- qu'un nouveau lancement soit accepté.
CREATE UNIQUE INDEX IF NOT EXISTS build_runs_one_active_per_model_uidx
  ON semantic_model.build_runs (model_id)
  WHERE status = 'running';

-- Index pour le sweep de zombies au boot / au read.
CREATE INDEX IF NOT EXISTS build_runs_heartbeat_active_idx
  ON semantic_model.build_runs (last_heartbeat_at)
  WHERE status = 'running';
