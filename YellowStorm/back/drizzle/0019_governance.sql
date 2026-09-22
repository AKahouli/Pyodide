CREATE SCHEMA IF NOT EXISTS governance;

CREATE TABLE IF NOT EXISTS governance.governance_programs (
  id               char(24) PRIMARY KEY,
  name             varchar(160) NOT NULL,
  description      varchar(2000),
  domain           varchar(100),
  default_language varchar(10) NOT NULL DEFAULT 'fr',
  status           varchar(16) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','published','archived')),
  owner_user_id    char(24) NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_programs_owner  ON governance.governance_programs (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_programs_status ON governance.governance_programs (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS governance.governance_scopes (
  id              char(24) PRIMARY KEY,
  program_id      char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  parent_scope_id char(24) REFERENCES governance.governance_scopes(id) ON DELETE SET NULL,
  name            varchar(160) NOT NULL,
  type            varchar(24) NOT NULL DEFAULT 'custom'
                  CHECK (type IN ('organization','municipality','department','business_unit','country','team','custom')),
  status          varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  audience_mode   varchar(24) NOT NULL DEFAULT 'restricted'
                  CHECK (audience_mode IN ('all_authenticated','restricted')),
  knowledge_source_mode        varchar(20) NOT NULL DEFAULT 'llm_only'
                               CHECK (knowledge_source_mode IN ('llm_only','workspaces_only')),
  knowledge_web_sources_enabled boolean NOT NULL DEFAULT false,
  knowledge_web_allowed_domains text[] NOT NULL DEFAULT '{}',
  knowledge_web_blocked_domains text[] NOT NULL DEFAULT '{}',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_scopes_program_name ON governance.governance_scopes (program_id, name);
CREATE INDEX IF NOT EXISTS idx_gov_scopes_program_type  ON governance.governance_scopes (program_id, type);
CREATE INDEX IF NOT EXISTS idx_gov_scopes_status_mode   ON governance.governance_scopes (status, audience_mode);
CREATE INDEX IF NOT EXISTS idx_gov_scopes_parent        ON governance.governance_scopes (parent_scope_id);

-- indexed ObjectId arrays → child tables
CREATE TABLE IF NOT EXISTS governance.governance_scope_agents (
  scope_id char(24) NOT NULL REFERENCES governance.governance_scopes(id) ON DELETE CASCADE,
  agent_id char(24) NOT NULL,
  PRIMARY KEY (scope_id, agent_id));
CREATE INDEX IF NOT EXISTS idx_gov_scope_agents_agent ON governance.governance_scope_agents (agent_id);

CREATE TABLE IF NOT EXISTS governance.governance_scope_audience_users (
  scope_id char(24) NOT NULL REFERENCES governance.governance_scopes(id) ON DELETE CASCADE,
  user_id  char(24) NOT NULL,
  PRIMARY KEY (scope_id, user_id));
CREATE INDEX IF NOT EXISTS idx_gov_scope_aud_users_user ON governance.governance_scope_audience_users (user_id);

CREATE TABLE IF NOT EXISTS governance.governance_scope_audience_groups (
  scope_id char(24) NOT NULL REFERENCES governance.governance_scopes(id) ON DELETE CASCADE,
  group_id char(24) NOT NULL,
  PRIMARY KEY (scope_id, group_id));
CREATE INDEX IF NOT EXISTS idx_gov_scope_aud_groups_group ON governance.governance_scope_audience_groups (group_id);

CREATE TABLE IF NOT EXISTS governance.governance_documents (
  id           char(24) PRIMARY KEY,
  program_id   char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  document_id  char(24) NOT NULL,
  workspace_id char(24) NOT NULL,
  status       varchar(16) NOT NULL DEFAULT 'captured'
               CHECK (status IN ('captured','to_review','approved','published','rejected','archived')),
  validity                 jsonb NOT NULL,
  validity_next_review_at  timestamptz,      -- promoted from validity.nextReviewAt (indexed in Mongo)
  validity_business_status varchar(32),      -- promoted from validity.businessStatus
  tags         text[] NOT NULL DEFAULT '{}',
  metadata     jsonb  NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id  char(24),
  owner_scope_id char(24) REFERENCES governance.governance_scopes(id) ON DELETE SET NULL,
  governance_revision        integer NOT NULL DEFAULT 0 CHECK (governance_revision >= 0),
  temporal_decision_revision integer NOT NULL DEFAULT 0 CHECK (temporal_decision_revision >= 0),
  submitted_for_review_by char(24), submitted_for_review_at timestamptz,
  reviewed_by char(24),  reviewed_at  timestamptz,
  approved_by char(24),  approved_at  timestamptz,
  published_by char(24), published_at timestamptz,
  review_comment varchar(2000),
  archived_at timestamptz, archived_by char(24), archive_reason varchar(2000),
  last_integration_event_id varchar(200), last_integration_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_docs_program_document ON governance.governance_documents (program_id, document_id);
CREATE INDEX IF NOT EXISTS idx_gov_docs_program_ws_status ON governance.governance_documents (program_id, workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_gov_docs_program_review    ON governance.governance_documents (program_id, validity_next_review_at);
CREATE INDEX IF NOT EXISTS idx_gov_docs_document_updated  ON governance.governance_documents (document_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_docs_tags              ON governance.governance_documents USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_gov_docs_owner_user        ON governance.governance_documents (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_gov_docs_owner_scope       ON governance.governance_documents (owner_scope_id);
CREATE INDEX IF NOT EXISTS idx_gov_docs_status            ON governance.governance_documents (status);

CREATE TABLE IF NOT EXISTS governance.governance_document_events (
  id                     char(24) PRIMARY KEY,
  program_id             char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  governance_document_id char(24) NOT NULL REFERENCES governance.governance_documents(id) ON DELETE CASCADE,
  document_id            char(24) NOT NULL,
  event_type             varchar(64) NOT NULL,
  actor_id               char(24),
  actor_type             varchar(16) NOT NULL DEFAULT 'system'
                         CHECK (actor_type IN ('user','system','integration')),
  actor_email            varchar(320),
  occurred_at            timestamptz NOT NULL,
  reason                 varchar(2000),
  before                 jsonb,
  after                  jsonb,
  metadata               jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id         text,
  causation_id           text,
  deduplication_key      varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_events_govdoc     ON governance.governance_document_events (governance_document_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_events_document   ON governance.governance_document_events (document_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_events_prog_type  ON governance.governance_document_events (program_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_events_correlation ON governance.governance_document_events (correlation_id);
-- Mongo: unique { governanceDocumentId, deduplicationKey } partial on $type:'string'
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_events_dedup
  ON governance.governance_document_events (governance_document_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS governance.governance_workspace_bindings (
  id            char(24) PRIMARY KEY,
  program_id    char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  workspace_id  char(24) NOT NULL,
  visibility    varchar(20) NOT NULL
                CHECK (visibility IN ('program_shared','scope_specific','multi_scope')),
  enabled       boolean NOT NULL DEFAULT true,
  ingestion_mode varchar(16) NOT NULL DEFAULT 'assisted'
                CHECK (ingestion_mode IN ('manual','assisted','automatic')),
  defaults      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    char(24) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_bindings_program_ws ON governance.governance_workspace_bindings (program_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_gov_bindings_ws_enabled ON governance.governance_workspace_bindings (workspace_id, enabled);
CREATE INDEX IF NOT EXISTS idx_gov_bindings_visibility  ON governance.governance_workspace_bindings (visibility);

CREATE TABLE IF NOT EXISTS governance.governance_binding_scopes (
  binding_id char(24) NOT NULL REFERENCES governance.governance_workspace_bindings(id) ON DELETE CASCADE,
  scope_id   char(24) NOT NULL REFERENCES governance.governance_scopes(id) ON DELETE CASCADE,
  PRIMARY KEY (binding_id, scope_id));
CREATE INDEX IF NOT EXISTS idx_gov_binding_scopes_scope ON governance.governance_binding_scopes (scope_id);

CREATE TABLE IF NOT EXISTS governance.governance_reconciliation_runs (
  id          char(24) PRIMARY KEY,
  binding_id  char(24) NOT NULL REFERENCES governance.governance_workspace_bindings(id) ON DELETE CASCADE,
  status      varchar(16) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','running','completed','failed')),
  dry_run     boolean NOT NULL DEFAULT true,
  "cursor"    text,
  stats       jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at  timestamptz,
  completed_at timestamptz,
  lease_token text,
  lease_expires_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_recon_binding ON governance.governance_reconciliation_runs (binding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_recon_lease   ON governance.governance_reconciliation_runs (status, lease_expires_at);

CREATE TABLE IF NOT EXISTS governance.governance_memberships (
  id         char(24) PRIMARY KEY,
  program_id char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_id   char(24) REFERENCES governance.governance_scopes(id) ON DELETE CASCADE,
  user_id    char(24),
  group_id   char(24),
  invited_by char(24) NOT NULL,
  role       varchar(20) NOT NULL
             CHECK (role IN ('program_owner','program_admin','scope_admin','scope_approver','scope_editor','scope_reviewer','scope_viewer')),
  status     varchar(12) NOT NULL DEFAULT 'active'
             CHECK (status IN ('invited','active','disabled')),
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR group_id IS NOT NULL)
);
-- NULLS NOT DISTINCT is required: Mongo enforces uniqueness across docs with a missing scopeId,
-- whereas PG's default NULL semantics would let duplicates through.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_memberships_user
  ON governance.governance_memberships (program_id, scope_id, user_id)
  NULLS NOT DISTINCT WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_memberships_group
  ON governance.governance_memberships (program_id, scope_id, group_id)
  NULLS NOT DISTINCT WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gov_memberships_user  ON governance.governance_memberships (user_id, status);
CREATE INDEX IF NOT EXISTS idx_gov_memberships_group ON governance.governance_memberships (group_id, status);
CREATE INDEX IF NOT EXISTS idx_gov_memberships_role  ON governance.governance_memberships (role);

CREATE TABLE IF NOT EXISTS governance.governance_deployments (
  id         char(24) PRIMARY KEY,
  program_id char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_id   char(24) NOT NULL REFERENCES governance.governance_scopes(id)   ON DELETE CASCADE,
  name       varchar(160) NOT NULL,
  status     varchar(20) NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft','dry_run','ready_for_review','published','suspended','archived')),
  -- no FK: deployments ↔ revisions is circular; the app maintains this invariant
  current_draft_revision_id     char(24),
  current_published_revision_id char(24),
  revision_sequence integer NOT NULL DEFAULT 0,
  channels   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_deployments_program_scope ON governance.governance_deployments (program_id, scope_id);
CREATE INDEX IF NOT EXISTS idx_gov_deployments_status ON governance.governance_deployments (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS governance.governance_deployment_revisions (
  id              char(24) PRIMARY KEY,
  deployment_id   char(24) NOT NULL REFERENCES governance.governance_deployments(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  status          varchar(16) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','dry_run','approved','published','rejected')),
  agent_id        char(24),
  -- immutable snapshot arrays: kept as arrays, not junctions (no churn, atomic with the row)
  allowed_agent_ids char(24)[] NOT NULL DEFAULT '{}',
  workspace_ids     char(24)[] NOT NULL DEFAULT '{}',
  agent_snapshot              jsonb NOT NULL DEFAULT '{}'::jsonb,
  workspace_binding_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  channel_snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope_snapshot              jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience_snapshot           jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_audience_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  configuration_fingerprint   text,
  created_by  char(24) NOT NULL,
  approved_by char(24),
  published_by char(24),
  published_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_revisions_deployment_number ON governance.governance_deployment_revisions (deployment_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_gov_revisions_deployment_status ON governance.governance_deployment_revisions (deployment_id, status);
CREATE INDEX IF NOT EXISTS idx_gov_revisions_fingerprint       ON governance.governance_deployment_revisions (configuration_fingerprint);

CREATE TABLE IF NOT EXISTS governance.governance_dry_runs (
  id            char(24) PRIMARY KEY,
  program_id    char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_id      char(24) NOT NULL REFERENCES governance.governance_scopes(id)   ON DELETE CASCADE,
  deployment_id char(24) NOT NULL REFERENCES governance.governance_deployments(id) ON DELETE CASCADE,
  revision_id   char(24) NOT NULL REFERENCES governance.governance_deployment_revisions(id) ON DELETE CASCADE,
  conversation_id char(24),
  tester_id     char(24) NOT NULL,
  status        varchar(16) NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','passed','failed','needs_review')),
  execution_mode varchar(16) NOT NULL DEFAULT 'conversation'
                CHECK (execution_mode IN ('conversation','manual')),
  test_cases    jsonb NOT NULL DEFAULT '[]'::jsonb,
  checks        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_dryruns_deployment ON governance.governance_dry_runs (deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_dryruns_tester     ON governance.governance_dry_runs (tester_id);
CREATE INDEX IF NOT EXISTS idx_gov_dryruns_status     ON governance.governance_dry_runs (status);

CREATE TABLE IF NOT EXISTS governance.governance_metrics (
  id            char(24) PRIMARY KEY,
  program_id    char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_id      char(24) REFERENCES governance.governance_scopes(id) ON DELETE CASCADE,
  deployment_id char(24) REFERENCES governance.governance_deployments(id) ON DELETE CASCADE,
  agent_id      char(24),
  channel       varchar(16) CHECK (channel IN ('widget','whatsapp','telegram','api')),
  type          varchar(120) NOT NULL,
  "value"       double precision NOT NULL,
  dimensions    jsonb NOT NULL DEFAULT '{}'::jsonb,
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_metrics_program_period ON governance.governance_metrics (program_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_gov_metrics_type           ON governance.governance_metrics (type);
CREATE INDEX IF NOT EXISTS idx_gov_metrics_period         ON governance.governance_metrics (period_start, period_end);

CREATE TABLE IF NOT EXISTS governance.governance_publication_attempts (
  id            char(24) PRIMARY KEY,
  program_id    char(24) NOT NULL REFERENCES governance.governance_programs(id) ON DELETE CASCADE,
  scope_id      char(24) NOT NULL REFERENCES governance.governance_scopes(id)   ON DELETE CASCADE,
  deployment_id char(24) NOT NULL REFERENCES governance.governance_deployments(id) ON DELETE CASCADE,
  revision_id   char(24) REFERENCES governance.governance_deployment_revisions(id) ON DELETE SET NULL,
  triggered_by_user_id char(24) NOT NULL,
  triggered_by_email   text NOT NULL,
  requested_channels   text[] NOT NULL DEFAULT '{}',
  allow_partial boolean NOT NULL DEFAULT false,
  "comment"     varchar(1000),
  status        varchar(12) NOT NULL CHECK (status IN ('success','blocked','failed','partial')),
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code    text,
  error_message varchar(1000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_pub_deployment ON governance.governance_publication_attempts (deployment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_pub_program    ON governance.governance_publication_attempts (program_id, status, created_at DESC);
