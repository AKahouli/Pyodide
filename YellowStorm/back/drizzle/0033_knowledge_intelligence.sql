-- P6 knowledge-intelligence: alerts, assessments, extraction jobs, recommendations, metadata
-- candidates and temporal candidate records, in the governance schema. Rows hang off their program,
-- document, connector or job with real foreign keys (cascade with the parent); user references
-- become NULL when the user is deleted. scope_ids stays an array queried with `&&`.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS governance.knowledge_alerts (
  id               char(24)    PRIMARY KEY,
  program_id       char(24)    NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_ids        char(24)[]  NOT NULL DEFAULT '{}',
  document_id      char(24)    REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  category         varchar(24) NOT NULL
                   CONSTRAINT gov_ka_category CHECK (category IN ('validity','freshness','availability','integrity','governance','search_quality','impact')),
  severity         varchar(16) NOT NULL
                   CONSTRAINT gov_ka_severity CHECK (severity IN ('critical','high','medium','low')),
  status           varchar(16) NOT NULL DEFAULT 'open'
                   CONSTRAINT gov_ka_status CHECK (status IN ('open','acknowledged','resolved','ignored')),
  title            text        NOT NULL,
  description      text        NOT NULL,
  deduplication_key text       NOT NULL,
  evidence_refs    text[]      NOT NULL DEFAULT '{}',
  opened_at        timestamptz NOT NULL,
  resolved_at      timestamptz,
  acknowledged_by  char(24)    REFERENCES identity.users(id) ON DELETE SET NULL,
  acknowledged_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_ka_program_dedup ON governance.knowledge_alerts (program_id, deduplication_key);
CREATE INDEX IF NOT EXISTS idx_gov_ka_program_status ON governance.knowledge_alerts (program_id, status, severity, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_ka_scope_ids ON governance.knowledge_alerts USING gin (scope_ids);
CREATE INDEX IF NOT EXISTS idx_gov_ka_document ON governance.knowledge_alerts (document_id);

CREATE TABLE IF NOT EXISTS governance.knowledge_assessments (
  id                   char(24)         PRIMARY KEY,
  program_id           char(24)         NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_ids            char(24)[]       NOT NULL DEFAULT '{}',
  document_id          char(24)         NOT NULL REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  assessment_version   text             NOT NULL,
  input_hash           text             NOT NULL,
  assessed_at          timestamptz      NOT NULL,
  dimensions           jsonb            NOT NULL,
  overall_health_score double precision NOT NULL
                       CONSTRAINT gov_kas_score CHECK (overall_health_score BETWEEN 0 AND 100),
  status               varchar(16)      NOT NULL
                       CONSTRAINT gov_kas_status CHECK (status IN ('healthy','warning','critical')),
  summary              text             NOT NULL,
  created_at           timestamptz      NOT NULL DEFAULT now(),
  updated_at           timestamptz      NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_kas_identity
  ON governance.knowledge_assessments (program_id, document_id, assessment_version, input_hash);
CREATE INDEX IF NOT EXISTS idx_gov_kas_program_status ON governance.knowledge_assessments (program_id, status, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_kas_document_assessed ON governance.knowledge_assessments (document_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_kas_scope_ids ON governance.knowledge_assessments USING gin (scope_ids);

CREATE TABLE IF NOT EXISTS governance.knowledge_extraction_jobs (
  id                    char(24)    PRIMARY KEY,
  program_id            char(24)    NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  document_id           char(24)    NOT NULL REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  connector_id          char(24)    NOT NULL REFERENCES integrations.connectors(id) ON DELETE CASCADE,
  requested_by_user_id  char(24)    REFERENCES identity.users(id) ON DELETE SET NULL,
  job_type              varchar(24) NOT NULL
                        CONSTRAINT gov_kej_type CHECK (job_type IN ('technical_metadata','temporal_extraction','metadata_enrichment')),
  status                varchar(16) NOT NULL DEFAULT 'pending'
                        CONSTRAINT gov_kej_status CHECK (status IN ('pending','running','completed','failed','cancelled')),
  input_hash            text        NOT NULL,
  engine_version        text        NOT NULL,
  attempts              integer     NOT NULL DEFAULT 0
                        CONSTRAINT gov_kej_attempts CHECK (attempts >= 0),
  error                 text,
  started_at            timestamptz,
  completed_at          timestamptz,
  lease_expires_at      timestamptz,
  lease_token           text,
  next_attempt_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_kej_identity
  ON governance.knowledge_extraction_jobs (program_id, document_id, job_type, input_hash, engine_version);
CREATE INDEX IF NOT EXISTS idx_gov_kej_status_created ON governance.knowledge_extraction_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_gov_kej_status_lease ON governance.knowledge_extraction_jobs (status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_gov_kej_document_created ON governance.knowledge_extraction_jobs (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS governance.knowledge_recommendations (
  id                           char(24)    PRIMARY KEY,
  program_id                   char(24)    NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_ids                    char(24)[]  NOT NULL DEFAULT '{}',
  document_id                  char(24)    REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  alert_ids                    char(24)[]  NOT NULL DEFAULT '{}',
  type                         varchar(24) NOT NULL
                               CONSTRAINT gov_kr_type CHECK (type IN ('assign_owner','schedule_review','confirm_validity','resolve_conflict','enrich_metadata','add_synonyms','merge_duplicate','reindex','change_scope','exclude_from_runtime')),
  priority                     varchar(16) NOT NULL
                               CONSTRAINT gov_kr_priority CHECK (priority IN ('critical','high','medium','low')),
  reason                       text        NOT NULL,
  impact_summary               text        NOT NULL,
  proposed_action              jsonb,
  status                       varchar(16) NOT NULL DEFAULT 'proposed'
                               CONSTRAINT gov_kr_status CHECK (status IN ('proposed','accepted','rejected','applied','superseded')),
  deduplication_key            text        NOT NULL,
  decided_by                   char(24)    REFERENCES identity.users(id) ON DELETE SET NULL,
  decided_at                   timestamptz,
  decision_reason              text,
  applied_by                   char(24)    REFERENCES identity.users(id) ON DELETE SET NULL,
  applied_at                   timestamptz,
  application_token            text,
  application_lease_expires_at timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_kr_program_dedup ON governance.knowledge_recommendations (program_id, deduplication_key);
CREATE INDEX IF NOT EXISTS idx_gov_kr_program_status
  ON governance.knowledge_recommendations (program_id, status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_kr_scope_ids ON governance.knowledge_recommendations USING gin (scope_ids);
CREATE INDEX IF NOT EXISTS idx_gov_kr_document ON governance.knowledge_recommendations (document_id);

CREATE TABLE IF NOT EXISTS governance.metadata_candidates (
  id              char(24)         PRIMARY KEY,
  program_id      char(24)         NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_ids       char(24)[]       NOT NULL DEFAULT '{}',
  document_id     char(24)         NOT NULL REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  key             text             NOT NULL,
  proposed_value  jsonb            NOT NULL,
  candidate_type  varchar(16)      NOT NULL
                  CONSTRAINT gov_mc_type CHECK (candidate_type IN ('document','business','search')),
  confidence      double precision NOT NULL
                  CONSTRAINT gov_mc_confidence CHECK (confidence BETWEEN 0 AND 1),
  risk_level      varchar(16)      NOT NULL
                  CONSTRAINT gov_mc_risk CHECK (risk_level IN ('low','medium','high')),
  evidence_refs   text[]           NOT NULL DEFAULT '{}',
  status          varchar(16)      NOT NULL DEFAULT 'proposed'
                  CONSTRAINT gov_mc_status CHECK (status IN ('proposed','accepted','rejected','superseded')),
  candidate_key   text             NOT NULL,
  accepted_value  jsonb,
  decided_by      char(24)         REFERENCES identity.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_reason text,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_mc_identity ON governance.metadata_candidates (program_id, document_id, candidate_key);
CREATE INDEX IF NOT EXISTS idx_gov_mc_program_status ON governance.metadata_candidates (program_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_mc_scope_ids ON governance.metadata_candidates USING gin (scope_ids);
CREATE INDEX IF NOT EXISTS idx_gov_mc_document ON governance.metadata_candidates (document_id);

CREATE TABLE IF NOT EXISTS governance.temporal_candidate_records (
  id                        char(24)    PRIMARY KEY,
  program_id                char(24)    NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  document_id               char(24)    NOT NULL REFERENCES workspace.workspace_documents(id) ON DELETE CASCADE,
  job_id                    char(24)    NOT NULL REFERENCES governance.knowledge_extraction_jobs(id) ON DELETE CASCADE,
  candidate_id              text        NOT NULL,
  candidate                 jsonb       NOT NULL,
  validation                jsonb       NOT NULL,
  evidence                  jsonb       NOT NULL DEFAULT '[]',
  decision_status           varchar(16) NOT NULL DEFAULT 'pending'
                            CONSTRAINT gov_tcr_status CHECK (decision_status IN ('pending','processing','confirmed','corrected','rejected')),
  decision_lease_expires_at timestamptz,
  decision_token            text,
  decided_by                char(24)    REFERENCES identity.users(id) ON DELETE SET NULL,
  decided_at                timestamptz,
  decision_comment          text,
  corrected_candidate       jsonb,
  input_hash                text        NOT NULL,
  engine_version            text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_tcr_identity
  ON governance.temporal_candidate_records (program_id, document_id, candidate_id, input_hash);
CREATE INDEX IF NOT EXISTS idx_gov_tcr_document_status
  ON governance.temporal_candidate_records (document_id, decision_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_tcr_job ON governance.temporal_candidate_records (job_id);
