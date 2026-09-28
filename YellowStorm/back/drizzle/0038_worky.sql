-- P7 worky: streams, their tasks/messages/plan history, budget, governance, mail and Electric mirror
-- move from 24 Mongo collections to the worky schema. Every parent reference inside the module is a
-- real foreign key, so deleting a stream takes everything under it (the 15-collection cascade of
-- WorkyStreamService.deleteStreamScopedRecords, which had also forgotten the Electric mirror tables
-- and left their rows behind). Deleting a task takes its results, traces, workers and reservations.
--
-- Deliberately WITHOUT a foreign key:
--   streams.workspace_id   holds the owner's user id when a stream is created without a workspace
--                          (605 of 606 dev streams), so it is not a workspace reference;
--   streams.artifact_workspace_id / manager_agent_id   legacy, no longer provisioned (2 of 3 agents are gone);
--   audit_events.stream_id  a scope id: the stream, the memory owner or the workspace of a policy;
--   actor columns (created_by, approved_by, actor_user_id)  an author must not block a user deletion.
-- Numbered 0038 after 0037_conversation_app_runtime_fks; 0029/0030 belong to feat/app-templates.
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS worky;

-- ---------------------------------------------------------------- governance policies
CREATE TABLE IF NOT EXISTS worky.governance_policies (
  id                          char(24)    PRIMARY KEY,
  workspace_id                char(24)    NOT NULL,
  scope                       varchar(16) NOT NULL DEFAULT 'workspace'
                              CONSTRAINT worky_governance_policies_scope CHECK (scope IN ('workspace','stream')),
  default_level               varchar(16) NOT NULL DEFAULT 'off'
                              CONSTRAINT worky_governance_policies_default_level CHECK (default_level IN ('off','notify','approval','hard_block')),
  categories                  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  allow_stream_owner_override boolean     NOT NULL DEFAULT true,
  max_owner_relax_level       varchar(16) NOT NULL DEFAULT 'notify'
                              CONSTRAINT worky_governance_policies_relax_level CHECK (max_owner_relax_level IN ('off','notify','approval','hard_block')),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_governance_policies_scope ON worky.governance_policies (workspace_id, scope);

-- ---------------------------------------------------------------- streams
CREATE TABLE IF NOT EXISTS worky.streams (
  id                    char(24)     PRIMARY KEY,
  owner_user_id         char(24)     NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  workspace_id          char(24)     NOT NULL,
  artifact_workspace_id char(24),
  manager_agent_id      char(24),
  manager_model_id      varchar(256),
  worker_model_id       varchar(256),
  voice_prompt          text,
  -- The manager's session id: the Electric shape scope, unique per stream.
  ai_session_id         text,
  governance_policy_ref char(24)     REFERENCES worky.governance_policies(id) ON DELETE SET NULL,
  title                 varchar(200) NOT NULL
                        CONSTRAINT worky_streams_title CHECK (char_length(title) >= 1),
  status                varchar(32)  NOT NULL DEFAULT 'created'
                        CONSTRAINT worky_streams_status CHECK (status IN (
                          'created','planning','start_requested','start_validation_failed','active','partially_blocked',
                          'waiting_for_owner','waiting_for_human','waiting_for_budget_decision','paused','stopped',
                          'completed','archived')),
  control_state         varchar(24)  NOT NULL DEFAULT 'active'
                        CONSTRAINT worky_streams_control_state CHECK (control_state IN (
                          'active','pause_requested','paused','resume_requested','stop_requested','stopped')),
  scheduler_enabled     boolean      NOT NULL DEFAULT false,
  current_plan_version  integer      NOT NULL DEFAULT 0
                        CONSTRAINT worky_streams_plan_version CHECK (current_plan_version >= 0),
  execution_plan_version integer,
  budget_limit_usd      numeric(18,8) NOT NULL DEFAULT 0
                        CONSTRAINT worky_streams_limit_usd CHECK (budget_limit_usd >= 0),
  budget_limit_tokens   bigint       NOT NULL DEFAULT 0
                        CONSTRAINT worky_streams_limit_tokens CHECK (budget_limit_tokens >= 0),
  budget_spend_usd      numeric(18,8) NOT NULL DEFAULT 0
                        CONSTRAINT worky_streams_spend_usd CHECK (budget_spend_usd >= 0),
  budget_tokens_used    bigint       NOT NULL DEFAULT 0
                        CONSTRAINT worky_streams_tokens_used CHECK (budget_tokens_used >= 0),
  budget_enforcement    varchar(16)  NOT NULL DEFAULT 'hard_stop'
                        CONSTRAINT worky_streams_enforcement CHECK (budget_enforcement IN ('hard_stop','notify')),
  started_at            timestamptz,
  completed_at          timestamptz,
  active_duration_minutes double precision NOT NULL DEFAULT 0
                        CONSTRAINT worky_streams_active_minutes CHECK (active_duration_minutes >= 0),
  last_activity_at      timestamptz  NOT NULL DEFAULT now(),
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_streams_owner_created ON worky.streams (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worky_streams_owner_activity ON worky.streams (owner_user_id, last_activity_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worky_streams_owner_status ON worky.streams (owner_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_streams_ai_session ON worky.streams (ai_session_id) WHERE ai_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_streams_governance_policy ON worky.streams (governance_policy_ref) WHERE governance_policy_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS worky.stream_shares (
  id         char(24)    PRIMARY KEY,
  stream_id  char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  user_id    char(24)    NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  permission varchar(8)  NOT NULL
             CONSTRAINT worky_stream_shares_permission CHECK (permission IN ('read','write')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_stream_shares_user ON worky.stream_shares (stream_id, user_id);
CREATE INDEX IF NOT EXISTS idx_worky_stream_shares_user ON worky.stream_shares (user_id);

-- ---------------------------------------------------------------- tasks (the board)
-- external_id is the manager's plan_steps.step_id, the upsert key of the Electric consumer;
-- depends_on holds task ids of the legacy plan-delta path, depends_on_step_ids the manager's step ids.
CREATE TABLE IF NOT EXISTS worky.tasks (
  id                       char(24)    PRIMARY KEY,
  stream_id                char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  external_id              text,
  ordinal                  integer,
  result                   text,
  blocked_reason           text,
  wave                     integer,
  depends_on_step_ids      text[]      NOT NULL DEFAULT '{}',
  title                    text        NOT NULL,
  description              text        NOT NULL DEFAULT '',
  lane                     varchar(16) NOT NULL DEFAULT 'backlog'
                           CONSTRAINT worky_tasks_lane CHECK (lane IN (
                             'backlog','ready','running','review','blocked','done','failed','canceled','superseded','archived')),
  planning_status          varchar(16) NOT NULL DEFAULT 'pending'
                           CONSTRAINT worky_tasks_planning_status CHECK (planning_status IN ('pending','confirmed','rejected')),
  execution_state          varchar(24) NOT NULL DEFAULT 'not_started'
                           CONSTRAINT worky_tasks_execution_state CHECK (execution_state IN (
                             'not_started','scheduled','running','waiting_for_event','review','done','failed','canceled','superseded')),
  control_state            varchar(24) NOT NULL DEFAULT 'active'
                           CONSTRAINT worky_tasks_control_state CHECK (control_state IN (
                             'active','pause_requested','paused','stop_requested','stopped')),
  priority                 varchar(8)  NOT NULL DEFAULT 'medium'
                           CONSTRAINT worky_tasks_priority CHECK (priority IN ('low','medium','high','critical')),
  assignee_type            varchar(24) NOT NULL DEFAULT 'unassigned'
                           CONSTRAINT worky_tasks_assignee_type CHECK (assignee_type IN ('ephemeral_ai_agent','human_agent','unassigned')),
  assignee_id              char(24)    REFERENCES identity.users(id) ON DELETE SET NULL,
  assignee_key             text,
  kind                     text        NOT NULL DEFAULT 'execute',
  question                 text,
  interrupt_id             text,
  assignee_name            text,
  assignee_role            text,
  is_persona               boolean     NOT NULL DEFAULT false,
  is_dynamic_delegate      boolean     NOT NULL DEFAULT false,
  depends_on               char(24)[]  NOT NULL DEFAULT '{}',
  required_tools           text[]      NOT NULL DEFAULT '{}',
  action_category          varchar(40) NOT NULL DEFAULT 'internal_analysis'
                           CONSTRAINT worky_tasks_action_category CHECK (action_category IN (
                             'internal_analysis','research','drafting','internal_artifact_write','internal_platform_notification',
                             'external_send','customer_facing_release','external_comms','budget_overrun','cancel_human_task','replanning')),
  theoretical_deadline_at  timestamptz,
  acceptance_criteria      text[]      NOT NULL DEFAULT '{}',
  budget_estimate_usd      numeric(18,8) NOT NULL DEFAULT 0
                           CONSTRAINT worky_tasks_estimate_usd CHECK (budget_estimate_usd >= 0),
  budget_actual_usd        numeric(18,8) NOT NULL DEFAULT 0
                           CONSTRAINT worky_tasks_actual_usd CHECK (budget_actual_usd >= 0),
  budget_tokens_estimate   bigint      NOT NULL DEFAULT 0
                           CONSTRAINT worky_tasks_tokens_estimate CHECK (budget_tokens_estimate >= 0),
  budget_tokens_actual     bigint      NOT NULL DEFAULT 0
                           CONSTRAINT worky_tasks_tokens_actual CHECK (budget_tokens_actual >= 0),
  wait_conditions          text[]      NOT NULL DEFAULT '{}',
  started_at               timestamptz,
  completed_at             timestamptz,
  duration_ms              bigint
                           CONSTRAINT worky_tasks_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_tasks_external ON worky.tasks (stream_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_tasks_stream_lane ON worky.tasks (stream_id, lane);
CREATE INDEX IF NOT EXISTS idx_worky_tasks_stream_updated ON worky.tasks (stream_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_worky_tasks_assignee ON worky.tasks (assignee_id) WHERE assignee_id IS NOT NULL;

-- ---------------------------------------------------------------- plan history
CREATE TABLE IF NOT EXISTS worky.plan_deltas (
  id                  char(24)    PRIMARY KEY,
  stream_id           char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  base_plan_version   integer     NOT NULL
                      CONSTRAINT worky_plan_deltas_base_version CHECK (base_plan_version >= 0),
  result_plan_version integer,
  phase               varchar(16) NOT NULL
                      CONSTRAINT worky_plan_deltas_phase CHECK (phase IN ('planning','execution','replan')),
  trigger_event_id    text        NOT NULL,
  status              varchar(20) NOT NULL DEFAULT 'pending'
                      CONSTRAINT worky_plan_deltas_status CHECK (status IN ('pending','applied','rejected','superseded','pending_approval')),
  -- 'pending_approval' is what applyApproved() passes; the Mongo enum lacked it and rejected that write.
  apply_mode          varchar(20) NOT NULL DEFAULT 'auto'
                      CONSTRAINT worky_plan_deltas_apply_mode CHECK (apply_mode IN ('auto','manual','pending_approval')),
  reason              text        NOT NULL DEFAULT '',
  created_by          char(24)    NOT NULL,
  body                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  applied_at          timestamptz,
  approved_by         char(24),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_plan_deltas_stream_created ON worky.plan_deltas (stream_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worky_plan_deltas_stream_status ON worky.plan_deltas (stream_id, status);

-- ---------------------------------------------------------------- messages and the Electric mirror
CREATE TABLE IF NOT EXISTS worky.messages (
  id             char(24)    PRIMARY KEY,
  stream_id      char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  external_id    text,
  turn_id        text,
  role           varchar(8)  NOT NULL
                 CONSTRAINT worky_messages_role CHECK (role IN ('owner','manager','system')),
  content        text        NOT NULL,
  plan_delta_ref char(24)    REFERENCES worky.plan_deltas(id) ON DELETE SET NULL,
  emitted_at     timestamptz,
  origin         varchar(8)
                 CONSTRAINT worky_messages_origin CHECK (origin IS NULL OR origin = 'voice'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_messages_external ON worky.messages (stream_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_messages_stream_created ON worky.messages (stream_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_worky_messages_plan_delta ON worky.messages (plan_delta_ref) WHERE plan_delta_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS worky.plan_versions (
  id                      char(24)    PRIMARY KEY,
  stream_id               char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  version_number          integer     NOT NULL
                          CONSTRAINT worky_plan_versions_number CHECK (version_number >= 1),
  phase                   varchar(16) NOT NULL
                          CONSTRAINT worky_plan_versions_phase CHECK (phase IN ('planning','execution','replan')),
  created_by              char(24)    NOT NULL,
  created_from_message_id char(24)    REFERENCES worky.messages(id) ON DELETE SET NULL,
  trigger_event_id        text,
  summary                 text        NOT NULL DEFAULT '',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_plan_versions_number ON worky.plan_versions (stream_id, version_number);
CREATE INDEX IF NOT EXISTS idx_worky_plan_versions_message ON worky.plan_versions (created_from_message_id) WHERE created_from_message_id IS NOT NULL;

-- One row per stream: the plan title/goal/status (plans shape) and the session status (sessions shape)
-- arrive through independent shapes, so each writes only its own columns.
CREATE TABLE IF NOT EXISTS worky.plan_projections (
  id                  char(24)    PRIMARY KEY,
  stream_id           char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  title               text        NOT NULL DEFAULT '',
  goal                text        NOT NULL DEFAULT '',
  status              text        NOT NULL DEFAULT '',
  session_status      text,
  active_interrupt_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_plan_projections_stream ON worky.plan_projections (stream_id);

CREATE TABLE IF NOT EXISTS worky.message_components (
  id                  char(24)    PRIMARY KEY,
  stream_id           char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  external_id         text,
  message_external_id text        NOT NULL,
  ordinal             integer     NOT NULL DEFAULT 0,
  type                text        NOT NULL,
  data                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_message_components_external ON worky.message_components (stream_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_message_components_message ON worky.message_components (stream_id, message_external_id, ordinal);

CREATE TABLE IF NOT EXISTS worky.plan_step_components (
  id               char(24)    PRIMARY KEY,
  stream_id        char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  external_id      text,
  step_external_id text        NOT NULL,
  ordinal          integer     NOT NULL DEFAULT 0,
  type             text        NOT NULL,
  data             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_plan_step_components_external ON worky.plan_step_components (stream_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_plan_step_components_step ON worky.plan_step_components (stream_id, step_external_id, ordinal);

CREATE TABLE IF NOT EXISTS worky.plan_step_artifacts (
  id               char(24)    PRIMARY KEY,
  stream_id        char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  external_id      text,
  step_external_id text        NOT NULL,
  file_path        text        NOT NULL,
  filename         text        NOT NULL,
  artifact_kind    text,
  mime_type        text,
  size             bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_plan_step_artifacts_external ON worky.plan_step_artifacts (stream_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_plan_step_artifacts_step ON worky.plan_step_artifacts (stream_id, step_external_id, created_at);

-- Resume position of each Electric shape (handle + log offset).
CREATE TABLE IF NOT EXISTS worky.electric_cursors (
  shape      text        PRIMARY KEY,
  handle     text,
  log_offset text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- interactions
CREATE TABLE IF NOT EXISTS worky.interactions (
  id             char(24)    PRIMARY KEY,
  stream_id      char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  task_id        char(24)    REFERENCES worky.tasks(id) ON DELETE SET NULL,
  type           varchar(32) NOT NULL
                 CONSTRAINT worky_interactions_type CHECK (type IN (
                   'clarification','approval','review','missing_input','assignment_disambiguation','budget_decision',
                   'deadline_decision','escalation_decision','replan_review')),
  target_user_id char(24)    REFERENCES identity.users(id) ON DELETE SET NULL,
  question       text        NOT NULL,
  options        text[]      NOT NULL DEFAULT '{}',
  status         varchar(16) NOT NULL DEFAULT 'pending'
                 CONSTRAINT worky_interactions_status CHECK (status IN ('pending','responded','canceled','expired')),
  blocking_scope text        NOT NULL DEFAULT 'stream',
  blocks_task_ids char(24)[] NOT NULL DEFAULT '{}',
  responded_at   timestamptz,
  response       text,
  metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_interactions_stream_status ON worky.interactions (stream_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_worky_interactions_target_status ON worky.interactions (target_user_id, status);
CREATE INDEX IF NOT EXISTS idx_worky_interactions_task ON worky.interactions (task_id) WHERE task_id IS NOT NULL;

-- ---------------------------------------------------------------- execution: workers, results, traces
CREATE TABLE IF NOT EXISTS worky.ephemeral_workers (
  id                 char(24)     PRIMARY KEY,
  stream_id          char(24)     NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  task_id            char(24)     NOT NULL REFERENCES worky.tasks(id) ON DELETE CASCADE,
  agent_entity_id    char(24)     NOT NULL,
  role               varchar(100) NOT NULL,
  status             varchar(16)  NOT NULL DEFAULT 'spawned'
                     CONSTRAINT worky_ephemeral_workers_status CHECK (status IN ('spawned','running','done','failed','canceled')),
  adk_session_id     text,
  adk_invocation_id  text,
  last_checkpoint_at timestamptz,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_ephemeral_workers_stream_status ON worky.ephemeral_workers (stream_id, status);
CREATE INDEX IF NOT EXISTS idx_worky_ephemeral_workers_task ON worky.ephemeral_workers (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS worky.task_results (
  id                     char(24)     PRIMARY KEY,
  task_id                char(24)     NOT NULL REFERENCES worky.tasks(id) ON DELETE CASCADE,
  version                integer      NOT NULL
                         CONSTRAINT worky_task_results_version CHECK (version >= 1),
  status                 varchar(100) NOT NULL,
  summary                text         NOT NULL DEFAULT '',
  payload                jsonb,
  content_artifact_id    char(24),
  created_by_worker_id   char(24)     REFERENCES worky.ephemeral_workers(id) ON DELETE SET NULL,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_task_results_version ON worky.task_results (task_id, version);
CREATE INDEX IF NOT EXISTS idx_worky_task_results_worker ON worky.task_results (created_by_worker_id) WHERE created_by_worker_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS worky.traces (
  id              char(24)     PRIMARY KEY,
  stream_id       char(24)     NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  task_id         char(24)     NOT NULL REFERENCES worky.tasks(id) ON DELETE CASCADE,
  kind            varchar(8)   NOT NULL
                  CONSTRAINT worky_traces_kind CHECK (kind IN ('tool','model')),
  name            varchar(200) NOT NULL,
  summary         text         NOT NULL DEFAULT '',
  raw_payload_uri text,
  duration_ms     bigint       NOT NULL DEFAULT 0
                  CONSTRAINT worky_traces_duration CHECK (duration_ms >= 0),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_traces_stream_task ON worky.traces (stream_id, task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_worky_traces_task ON worky.traces (task_id);

-- ---------------------------------------------------------------- budget
CREATE TABLE IF NOT EXISTS worky.budget_reservations (
  id         char(24)      PRIMARY KEY,
  stream_id  char(24)      NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  task_id    char(24)      NOT NULL REFERENCES worky.tasks(id) ON DELETE CASCADE,
  amount_usd numeric(18,8) NOT NULL CONSTRAINT worky_budget_reservations_amount CHECK (amount_usd >= 0),
  tokens     bigint        NOT NULL CONSTRAINT worky_budget_reservations_tokens CHECK (tokens >= 0),
  status     varchar(16)   NOT NULL DEFAULT 'reserved'
             CONSTRAINT worky_budget_reservations_status CHECK (status IN ('reserved','released','consumed','denied')),
  created_at timestamptz   NOT NULL DEFAULT now(),
  updated_at timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_budget_reservations_stream_status ON worky.budget_reservations (stream_id, status);
CREATE INDEX IF NOT EXISTS idx_worky_budget_reservations_task_status ON worky.budget_reservations (task_id, status);

CREATE TABLE IF NOT EXISTS worky.cost_events (
  id            char(24)      PRIMARY KEY,
  stream_id     char(24)      NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  task_id       char(24)      REFERENCES worky.tasks(id) ON DELETE SET NULL,
  type          varchar(16)   NOT NULL
                CONSTRAINT worky_cost_events_type CHECK (type IN ('llm','tool','embedding')),
  provider      varchar(100)  NOT NULL,
  model_id      varchar(200)  NOT NULL,
  input_tokens  bigint        NOT NULL DEFAULT 0 CONSTRAINT worky_cost_events_input CHECK (input_tokens >= 0),
  output_tokens bigint        NOT NULL DEFAULT 0 CONSTRAINT worky_cost_events_output CHECK (output_tokens >= 0),
  cost_usd      numeric(18,8) NOT NULL DEFAULT 0 CONSTRAINT worky_cost_events_cost CHECK (cost_usd >= 0),
  created_at    timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_cost_events_stream_created ON worky.cost_events (stream_id, created_at);
CREATE INDEX IF NOT EXISTS idx_worky_cost_events_task ON worky.cost_events (task_id) WHERE task_id IS NOT NULL;

-- ---------------------------------------------------------------- mail, scheduling, reports, audit, memory
CREATE TABLE IF NOT EXISTS worky.mail_event_ledger (
  id         char(24)     PRIMARY KEY,
  stream_id  char(24)     NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  task_id    char(24)     REFERENCES worky.tasks(id) ON DELETE SET NULL,
  kind       varchar(100) NOT NULL,
  dedup_key  varchar(200) NOT NULL,
  sent_at    timestamptz  NOT NULL,
  created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_mail_event_ledger_dedup ON worky.mail_event_ledger (stream_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_worky_mail_event_ledger_task ON worky.mail_event_ledger (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS worky.scheduled_events (
  id          char(24)     PRIMARY KEY,
  stream_id   char(24)     NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  task_id     char(24)     REFERENCES worky.tasks(id) ON DELETE CASCADE,
  event_type  varchar(100) NOT NULL,
  fire_at     timestamptz  NOT NULL,
  status      varchar(16)  NOT NULL DEFAULT 'pending'
              CONSTRAINT worky_scheduled_events_status CHECK (status IN ('pending','claimed','fired','canceled')),
  claim_token varchar(64),
  claimed_at  timestamptz,
  fired_at    timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_scheduled_events_due ON worky.scheduled_events (status, fire_at);
CREATE INDEX IF NOT EXISTS idx_worky_scheduled_events_stream_status ON worky.scheduled_events (stream_id, status);
CREATE INDEX IF NOT EXISTS idx_worky_scheduled_events_task ON worky.scheduled_events (task_id) WHERE task_id IS NOT NULL;

-- One report per stream: generate() overwrites it.
CREATE TABLE IF NOT EXISTS worky.execution_reports (
  id                   char(24)    PRIMARY KEY,
  stream_id            char(24)    NOT NULL REFERENCES worky.streams(id) ON DELETE CASCADE,
  type                 varchar(16) NOT NULL
                       CONSTRAINT worky_execution_reports_type CHECK (type IN ('summary','rich','lightweight')),
  status               varchar(16) NOT NULL DEFAULT 'generating'
                       CONSTRAINT worky_execution_reports_status CHECK (status IN ('generating','ready','failed')),
  markdown_artifact_id char(24),
  summary              text        NOT NULL DEFAULT '',
  markdown             text        NOT NULL DEFAULT '',
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  generated_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_execution_reports_stream ON worky.execution_reports (stream_id);

CREATE TABLE IF NOT EXISTS worky.audit_events (
  id            char(24)     PRIMARY KEY,
  stream_id     char(24)     NOT NULL,
  actor_user_id char(24),
  action        varchar(100) NOT NULL,
  target_type   varchar(100),
  target_id     char(24),
  details       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_audit_events_stream_occurred ON worky.audit_events (stream_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_worky_audit_events_action_occurred ON worky.audit_events (action, occurred_at DESC);

CREATE TABLE IF NOT EXISTS worky.memory_proposals (
  id               char(24)     PRIMARY KEY,
  owner_user_id    char(24)     NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  source_stream_id char(24)     REFERENCES worky.streams(id) ON DELETE CASCADE,
  category         varchar(24)  NOT NULL
                   CONSTRAINT worky_memory_proposals_category CHECK (category IN (
                     'stream_summary','preference','person','decision_history','role_clarification')),
  title            varchar(200) NOT NULL,
  content          text         NOT NULL,
  status           varchar(16)  NOT NULL DEFAULT 'pending'
                   CONSTRAINT worky_memory_proposals_status CHECK (status IN ('pending','confirmed','rejected')),
  decided_at       timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_memory_proposals_owner ON worky.memory_proposals (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worky_memory_proposals_stream ON worky.memory_proposals (source_stream_id) WHERE source_stream_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS worky.memory_entries (
  id                 char(24)     PRIMARY KEY,
  owner_user_id      char(24)     NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  source_proposal_id char(24)     REFERENCES worky.memory_proposals(id) ON DELETE SET NULL,
  source_stream_id   char(24)     REFERENCES worky.streams(id) ON DELETE CASCADE,
  category           varchar(24)  NOT NULL
                     CONSTRAINT worky_memory_entries_category CHECK (category IN (
                       'stream_summary','preference','person','decision_history','role_clarification')),
  title              varchar(200) NOT NULL,
  content            text         NOT NULL,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worky_memory_entries_owner ON worky.memory_entries (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worky_memory_entries_proposal ON worky.memory_entries (source_proposal_id) WHERE source_proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_memory_entries_stream ON worky.memory_entries (source_stream_id) WHERE source_stream_id IS NOT NULL;

-- One watched mailbox per user and connected-app key.
CREATE TABLE IF NOT EXISTS worky.mail_subscriptions (
  id               char(24)    PRIMARY KEY,
  user_id          char(24)    NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  mailbox_app_key  text        NOT NULL,
  subscription_id  text,
  client_state     text,
  expires_at       timestamptz,
  notification_url text,
  last_swept_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_worky_mail_subscriptions_mailbox ON worky.mail_subscriptions (user_id, mailbox_app_key);
CREATE INDEX IF NOT EXISTS idx_worky_mail_subscriptions_client_state ON worky.mail_subscriptions (client_state) WHERE client_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_worky_mail_subscriptions_expiry ON worky.mail_subscriptions (expires_at) WHERE subscription_id IS NOT NULL;
