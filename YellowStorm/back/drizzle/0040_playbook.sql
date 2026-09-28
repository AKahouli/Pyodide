-- P5 playbook-flow: playbook definitions, executions and their satellites, the design and assistant
-- workspaces, replay baselines and evaluations move from 23 Mongo models to the playbook schema.
--
-- Document-shaped data (graphs, snapshots, traces, judge results, replay templates) stays jsonb next to
-- promoted columns for everything that is filtered, sorted, unique or a reference; the hot state of an
-- execution (status, queue position, timestamps, HITL pause) is columns so transitions are conditional
-- UPDATEs instead of read-modify-write.
--
-- Foreign keys: a flow owns its executions, and an execution owns its task results, router decisions and
-- dynamic-reasoning attempts, so deleting a flow now cleans everything under it (the Mongo delete removed
-- the flow and its shares only: 635 of the 2,067 dev executions belong to flows that no longer exist).
-- Deliberately WITHOUT a foreign key: the assistant tables (short-lived TTL rows keyed by string ids),
-- idempotency records and execution leases (TTL rows), and soft references to an execution that may be gone
-- (output_formats.source_execution_id, validated_replays.reference_execution_id, mail ledger, replay
-- reports, evaluation rows) — those rows are history that must outlive the execution.
-- Numbered 0040 after 0039_fk_leading_indexes; 0029/0030 belong to feat/app-templates.
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS playbook;

-- ---------------------------------------------------------------- definitions
CREATE TABLE IF NOT EXISTS playbook.flows (
  id                            char(24)      PRIMARY KEY,
  owner_id                      char(24)      NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  assistant_operation_id        text,
  generation_provenance         jsonb,
  schema_version                integer       NOT NULL DEFAULT 1,
  definition_revision           integer       NOT NULL DEFAULT 0,
  name                          varchar(100)  NOT NULL
                                CONSTRAINT playbook_flows_name CHECK (char_length(name) >= 2),
  description                   text,
  trigger_config                jsonb,
  settings                      jsonb         NOT NULL DEFAULT '{"recursionLimit":25,"maxParallelism":5}'::jsonb,
  hitl_policy                   jsonb         NOT NULL DEFAULT '{}'::jsonb,
  hitl_blockers                 jsonb         NOT NULL DEFAULT '[]'::jsonb,
  nodes                         jsonb         NOT NULL DEFAULT '[]'::jsonb,
  control_edges                 jsonb         NOT NULL DEFAULT '[]'::jsonb,
  data_bindings                 jsonb         NOT NULL DEFAULT '[]'::jsonb,
  design_settings               jsonb,
  is_favorite                   boolean       NOT NULL DEFAULT false,
  reflection_enabled            boolean       NOT NULL DEFAULT false,
  advisor_scoring_mode          varchar(12)   NOT NULL DEFAULT 'llm'
                                CONSTRAINT playbook_flows_advisor_scoring_mode CHECK (advisor_scoring_mode IN ('llm','heuristic')),
  advisor_autopilot_enabled     boolean       NOT NULL DEFAULT false,
  advisor_autopilot_target_score double precision,
  advisor_autopilot_max_turns   integer,
  created_at                    timestamptz   NOT NULL DEFAULT now(),
  updated_at                    timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_flows_owner_name ON playbook.flows (owner_id, name);
CREATE INDEX IF NOT EXISTS idx_playbook_flows_owner_updated ON playbook.flows (owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_flows_assistant_operation ON playbook.flows (assistant_operation_id) WHERE assistant_operation_id IS NOT NULL;
-- The connector action sync finds the flows whose nodes bind a connector: nodes @> '[{"metadata":{"toolBindings":[{"connectorId":"…"}]}}]'.
CREATE INDEX IF NOT EXISTS idx_playbook_flows_nodes ON playbook.flows USING gin (nodes jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_playbook_flows_trigger_kind ON playbook.flows ((trigger_config ->> 'kind')) WHERE trigger_config IS NOT NULL;

-- A flow's workspaces, in the order the user gave them; deleting a workspace detaches it from every flow.
CREATE TABLE IF NOT EXISTS playbook.flow_workspaces (
  flow_id      char(24) NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  workspace_id char(24) NOT NULL REFERENCES workspace.workspaces(id) ON DELETE CASCADE,
  position     integer  NOT NULL DEFAULT 0,
  PRIMARY KEY (flow_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_playbook_flow_workspaces_workspace ON playbook.flow_workspaces (workspace_id);

CREATE TABLE IF NOT EXISTS playbook.shared_playbooks (
  id          char(24)    PRIMARY KEY,
  playbook_id char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  shared_by   char(24)    NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  shared_with char(24)    NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  permission  varchar(8)  NOT NULL DEFAULT 'read'
              CONSTRAINT playbook_shared_playbooks_permission CHECK (permission IN ('read','write')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_shared_playbooks_recipient ON playbook.shared_playbooks (playbook_id, shared_with);
CREATE INDEX IF NOT EXISTS idx_playbook_shared_playbooks_with ON playbook.shared_playbooks (shared_with, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_shared_playbooks_by ON playbook.shared_playbooks (shared_by);

CREATE TABLE IF NOT EXISTS playbook.node_templates (
  id                          char(24)     PRIMARY KEY,
  key                         varchar(120) NOT NULL,
  node_type                   varchar(20)  NOT NULL
                              CONSTRAINT playbook_node_templates_node_type CHECK (node_type IN ('agent','action','evaluation','iterator','router','human_approval')),
  title                       varchar(160) NOT NULL,
  description                 varchar(600),
  icon                        varchar(80),
  color                       varchar(40),
  category                    varchar(80)  NOT NULL,
  input_ports                 jsonb        NOT NULL DEFAULT '[]'::jsonb,
  output_ports                jsonb        NOT NULL DEFAULT '[]'::jsonb,
  prompt_template             text         NOT NULL DEFAULT '',
  recommended_agent_type_slug text,
  required_tool_names         text[]       NOT NULL DEFAULT '{}',
  assigned_agent_id           text,
  selected_action             text,
  iterator_config             jsonb,
  enabled                     boolean      NOT NULL DEFAULT true,
  router_config               jsonb,
  human_approval_config       jsonb,
  retry_policy                jsonb,
  model_id                    text,
  version                     integer      NOT NULL DEFAULT 1
                              CONSTRAINT playbook_node_templates_version CHECK (version >= 1),
  is_built_in                 boolean      NOT NULL DEFAULT false,
  created_by                  char(24),
  updated_by                  char(24),
  created_at                  timestamptz  NOT NULL DEFAULT now(),
  updated_at                  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_node_templates_key ON playbook.node_templates (key);
CREATE INDEX IF NOT EXISTS idx_playbook_node_templates_category ON playbook.node_templates (category, enabled);
CREATE INDEX IF NOT EXISTS idx_playbook_node_templates_enabled ON playbook.node_templates (enabled, title);

CREATE TABLE IF NOT EXISTS playbook.prompt_templates (
  id              char(24)     PRIMARY KEY,
  key             varchar(120) NOT NULL,
  title           varchar(160) NOT NULL,
  category        varchar(80)  NOT NULL,
  description     varchar(600),
  system_template text         NOT NULL DEFAULT '',
  user_template   text         NOT NULL DEFAULT '',
  enabled         boolean      NOT NULL DEFAULT true,
  version         integer      NOT NULL DEFAULT 1
                  CONSTRAINT playbook_prompt_templates_version CHECK (version >= 1),
  is_built_in     boolean      NOT NULL DEFAULT true,
  created_by      char(24),
  updated_by      char(24),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_prompt_templates_key ON playbook.prompt_templates (key);
CREATE INDEX IF NOT EXISTS idx_playbook_prompt_templates_category ON playbook.prompt_templates (category, enabled);

-- ---------------------------------------------------------------- executions
CREATE TABLE IF NOT EXISTS playbook.executions (
  id                            char(24)     PRIMARY KEY,
  flow_id                       char(24)     NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  owner_id                      char(24)     NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  schema_version                integer      NOT NULL DEFAULT 1,
  status                        varchar(16)  NOT NULL DEFAULT 'queued'
                                CONSTRAINT playbook_executions_status CHECK (status IN ('queued','running','pending_approval','completed','failed','cancelled')),
  started_at                    timestamptz,
  ended_at                      timestamptz,
  error                         text,
  recursion_limit               integer      NOT NULL DEFAULT 25,
  max_parallelism               integer      NOT NULL DEFAULT 5,
  playbook_execution_settings   jsonb,
  planner_snapshot              jsonb,
  input_context                 jsonb,
  snapshot                      jsonb,
  idempotency_key               text,
  pending_approval              jsonb,
  hitl_events                   jsonb        NOT NULL DEFAULT '[]'::jsonb,
  queue_position                integer      NOT NULL DEFAULT 0,
  thread_id                     text,
  single_step_task_id           text,
  advisor_autopilot_enabled     boolean      NOT NULL DEFAULT false,
  advisor_autopilot_target_score double precision,
  advisor_autopilot_max_turns   integer,
  reflection_enabled            boolean      NOT NULL DEFAULT false,
  advisor_scoring_mode          varchar(12)  NOT NULL DEFAULT 'llm'
                                CONSTRAINT playbook_executions_advisor_scoring_mode CHECK (advisor_scoring_mode IN ('llm','heuristic')),
  seeded_task_outputs           jsonb        NOT NULL DEFAULT '[]'::jsonb,
  execution_mode                varchar(16)  NOT NULL DEFAULT 'live'
                                CONSTRAINT playbook_executions_execution_mode CHECK (execution_mode IN ('live','inherit','replay_strict','replay_flex','replay_adaptive')),
  step_execution_modes          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  replay_planning_by_task       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  model_id_override             text,
  replay_source                 jsonb,
  created_at                    timestamptz  NOT NULL DEFAULT now(),
  updated_at                    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_executions_flow_created ON playbook.executions (flow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_executions_owner_status ON playbook.executions (owner_id, status);
CREATE INDEX IF NOT EXISTS idx_playbook_executions_owner_status_created ON playbook.executions (owner_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_playbook_executions_owner_idempotency ON playbook.executions (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Queue drain (oldest queued of an owner) and the stale-run sweep (running for too long).
CREATE INDEX IF NOT EXISTS idx_playbook_executions_queued ON playbook.executions (owner_id, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_playbook_executions_running ON playbook.executions (started_at) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS playbook.task_results (
  id                      char(24)    PRIMARY KEY,
  execution_id            char(24)    NOT NULL REFERENCES playbook.executions(id) ON DELETE CASCADE,
  task_id                 text        NOT NULL,
  parent_task_id          text,
  runtime_subgraph_id     text,
  generated_local_node_id text,
  generated_node_title    text,
  iteration               integer     NOT NULL DEFAULT 0,
  -- 'interrupted': a task paused on a HITL interrupt (the runtime's NodeSuspended); the Mongoose enum never ran on updates.
  status                  varchar(16) NOT NULL DEFAULT 'pending'
                          CONSTRAINT playbook_task_results_status CHECK (status IN ('pending','running','interrupted','completed','failed','skipped','cancelled')),
  output                  jsonb,
  display_text            text,
  outputs                 jsonb,
  artifacts               jsonb,
  components              jsonb,
  iterator_iterations     jsonb,
  error                   text,
  started_at              timestamptz,
  ended_at                timestamptz,
  tool_trace              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  reasoning_chain         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  llm_prompt_trace        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  usage                   jsonb,
  semantic_match          jsonb,
  trace_metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  judge_status            varchar(12) NOT NULL DEFAULT 'idle'
                          CONSTRAINT playbook_task_results_judge_status CHECK (judge_status IN ('idle','evaluating','evaluated','failed')),
  judge_result            jsonb,
  judge_scoring_mode      varchar(12)
                          CONSTRAINT playbook_task_results_judge_scoring_mode CHECK (judge_scoring_mode IS NULL OR judge_scoring_mode IN ('llm','heuristic')),
  judge_error             text,
  judge_history           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_task_results_task ON playbook.task_results (execution_id, task_id, iteration);
CREATE INDEX IF NOT EXISTS idx_playbook_task_results_subgraph ON playbook.task_results (execution_id, runtime_subgraph_id) WHERE runtime_subgraph_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS playbook.router_decisions (
  id             char(24)    PRIMARY KEY,
  execution_id   char(24)    NOT NULL REFERENCES playbook.executions(id) ON DELETE CASCADE,
  router_node_id text        NOT NULL,
  iteration      integer     NOT NULL DEFAULT 0,
  label          text        NOT NULL,
  decided_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_router_decisions_execution ON playbook.router_decisions (execution_id, decided_at);
CREATE INDEX IF NOT EXISTS idx_playbook_router_decisions_router ON playbook.router_decisions (execution_id, router_node_id, iteration);

CREATE TABLE IF NOT EXISTS playbook.dynamic_reasoning_attempts (
  id                    char(24)    PRIMARY KEY,
  execution_id          char(24)    NOT NULL REFERENCES playbook.executions(id) ON DELETE CASCADE,
  flow_id               char(24)    NOT NULL,
  parent_task_id        text        NOT NULL,
  parent_iteration      integer     NOT NULL DEFAULT 0,
  attempt               integer     NOT NULL DEFAULT 0,
  subgraph_id           text,
  status                varchar(12) NOT NULL DEFAULT 'planning'
                        CONSTRAINT playbook_dynamic_reasoning_attempts_status CHECK (status IN ('planning','direct','running','completed','failed')),
  task_fingerprint      text,
  context_fingerprint   text,
  input_context_summary jsonb,
  policy_snapshot       jsonb,
  planner_snapshot      jsonb,
  decision              jsonb,
  revisions             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  accepted_revision     integer,
  accepted_plan         jsonb,
  fallback_reason       text,
  error                 jsonb,
  planning_started_at   timestamptz,
  accepted_at           timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_dynamic_reasoning_attempts_attempt ON playbook.dynamic_reasoning_attempts (execution_id, parent_task_id, parent_iteration, attempt);
CREATE INDEX IF NOT EXISTS idx_playbook_dynamic_reasoning_attempts_status ON playbook.dynamic_reasoning_attempts (execution_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_dynamic_reasoning_attempts_subgraph ON playbook.dynamic_reasoning_attempts (subgraph_id) WHERE subgraph_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS playbook.hitl_memories (
  id                          char(24)    PRIMARY KEY,
  owner_id                    char(24)    NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  flow_id                     char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  node_id                     text,
  memory_type                 varchar(16) NOT NULL DEFAULT 'procedural'
                              CONSTRAINT playbook_hitl_memories_memory_type CHECK (memory_type IN ('semantic','episodic','procedural','approval_policy')),
  source                      varchar(20) NOT NULL DEFAULT 'hitl_feedback'
                              CONSTRAINT playbook_hitl_memories_source CHECK (source IN ('hitl_feedback','blocker_rule','replay_validation','manual')),
  title                       text        NOT NULL,
  content                     text        NOT NULL,
  normalized_instruction      text        NOT NULL,
  applies_to                  varchar(12) NOT NULL DEFAULT 'workflow'
                              CONSTRAINT playbook_hitl_memories_applies_to CHECK (applies_to IN ('node','workflow','agent','workspace')),
  status                      varchar(12) NOT NULL DEFAULT 'draft'
                              CONSTRAINT playbook_hitl_memories_status CHECK (status IN ('active','draft','archived')),
  sensitivity                 varchar(12) NOT NULL DEFAULT 'normal'
                              CONSTRAINT playbook_hitl_memories_sensitivity CHECK (sensitivity IN ('normal','sensitive')),
  created_from_execution_id   text,
  created_from_interrupt_id   text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_hitl_memories_flow ON playbook.hitl_memories (owner_id, flow_id, status);
CREATE INDEX IF NOT EXISTS idx_playbook_hitl_memories_node ON playbook.hitl_memories (owner_id, flow_id, node_id);
CREATE INDEX IF NOT EXISTS idx_playbook_hitl_memories_flow_only ON playbook.hitl_memories (flow_id);

-- Concurrency slots of running executions; swept by the TTL sweeper once expired.
CREATE TABLE IF NOT EXISTS playbook.execution_leases (
  id           char(24)    PRIMARY KEY,
  execution_id char(24)    NOT NULL,
  owner_id     char(24)    NOT NULL,
  flow_id      char(24)    NOT NULL,
  scope_type   varchar(10) NOT NULL
               CONSTRAINT playbook_execution_leases_scope_type CHECK (scope_type IN ('global','owner','flow','provider','model')),
  scope_key    text        NOT NULL,
  slot         integer     NOT NULL
               CONSTRAINT playbook_execution_leases_slot CHECK (slot >= 0),
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_execution_leases_scope ON playbook.execution_leases (execution_id, scope_type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_execution_leases_slot ON playbook.execution_leases (scope_key, slot);
CREATE INDEX IF NOT EXISTS idx_playbook_execution_leases_expires ON playbook.execution_leases (expires_at);

CREATE TABLE IF NOT EXISTS playbook.idempotency_records (
  id                          char(24)    PRIMARY KEY,
  owner_id                    char(24)    NOT NULL,
  idempotency_key             text        NOT NULL,
  payload_hash                text        NOT NULL,
  execution_id                char(24),
  response_body               jsonb,
  expected_state_hash         text,
  expected_definition_revision integer,
  expires_at                  timestamptz NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_idempotency_records_key ON playbook.idempotency_records (owner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_playbook_idempotency_records_expires ON playbook.idempotency_records (expires_at);
CREATE INDEX IF NOT EXISTS idx_playbook_idempotency_records_execution ON playbook.idempotency_records (execution_id) WHERE execution_id IS NOT NULL;

-- Mail-trigger ledger: `ledger_id` is the id the mail code generates (a nanoid), `id` the row key.
CREATE TABLE IF NOT EXISTS playbook.mail_event_ledgers (
  id                  char(24)    PRIMARY KEY,
  ledger_id           text        NOT NULL,
  flow_id             char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  dedupe_key          text        NOT NULL,
  status              varchar(12) NOT NULL DEFAULT 'received'
                      CONSTRAINT playbook_mail_event_ledgers_status CHECK (status IN ('received','normalized','matched','handed_off','deduplicated','ignored','errored')),
  provider            text        NOT NULL DEFAULT 'm365',
  mailbox_app_key     text        NOT NULL,
  provider_message_id text        NOT NULL,
  provider_thread_id  text,
  received_at         timestamptz NOT NULL,
  occurred_at         timestamptz NOT NULL,
  subject             text        NOT NULL DEFAULT '',
  body_text           text        NOT NULL DEFAULT '',
  body_html           text,
  from_participant    jsonb       NOT NULL,
  to_participants     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cc_participants     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  has_attachments     boolean     NOT NULL DEFAULT false,
  attachments         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error               text,
  execution_id        char(24),
  created_at          timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_mail_event_ledgers_dedupe ON playbook.mail_event_ledgers (flow_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_playbook_mail_event_ledgers_flow_created ON playbook.mail_event_ledgers (flow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_mail_event_ledgers_status ON playbook.mail_event_ledgers (status);
CREATE INDEX IF NOT EXISTS idx_playbook_mail_event_ledgers_execution ON playbook.mail_event_ledgers (execution_id) WHERE execution_id IS NOT NULL;
-- The mail trigger addresses an entry by its ledger id (status after matching, attachments, hand-off).
CREATE INDEX IF NOT EXISTS idx_playbook_mail_event_ledgers_ledger_id ON playbook.mail_event_ledgers (ledger_id);

CREATE TABLE IF NOT EXISTS playbook.output_formats (
  id                     char(24)    PRIMARY KEY,
  flow_id                char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  node_id                text        NOT NULL,
  created_by             char(24)    NOT NULL,
  source_execution_id    char(24)    NOT NULL,
  source_execution_number integer    NOT NULL,
  template_version       integer     NOT NULL,
  status                 varchar(10) NOT NULL DEFAULT 'active'
                         CONSTRAINT playbook_output_formats_status CHECK (status IN ('active','inactive','archived')),
  generation_status      varchar(10) NOT NULL DEFAULT 'pending'
                         CONSTRAINT playbook_output_formats_generation_status CHECK (generation_status IN ('pending','ready','failed')),
  generation_error       text,
  source_output          text,
  format_guide           text,
  llm_prompt_trace       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_output_formats_node ON playbook.output_formats (flow_id, node_id, status);

-- ---------------------------------------------------------------- design workspace
CREATE TABLE IF NOT EXISTS playbook.design_messages (
  id                         char(24)    PRIMARY KEY,
  flow_id                    char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  created_by                 char(24)    NOT NULL,
  user_query                 text        NOT NULL DEFAULT '',
  ai_summary                 text        NOT NULL DEFAULT '',
  snapshot_before            jsonb       NOT NULL,
  status                     varchar(10) NOT NULL DEFAULT 'completed'
                             CONSTRAINT playbook_design_messages_status CHECK (status IN ('completed','failed','reverted')),
  reverted_from_message_id   char(24)    REFERENCES playbook.design_messages(id) ON DELETE SET NULL,
  error                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_design_messages_flow ON playbook.design_messages (flow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_design_messages_flow_user ON playbook.design_messages (flow_id, created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_design_messages_reverted ON playbook.design_messages (reverted_from_message_id) WHERE reverted_from_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS playbook.design_operations (
  id                 char(24)    PRIMARY KEY,
  flow_id            char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  owner_id           char(24)    NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  query              text        NOT NULL,
  status             varchar(10) NOT NULL DEFAULT 'queued'
                     CONSTRAINT playbook_design_operations_status CHECK (status IN ('queued','running','applying','completed','failed','cancelled')),
  idempotency_key    text,
  started_at         timestamptz,
  completed_at       timestamptz,
  error              text,
  snapshot_before    jsonb,
  result_preview     jsonb,
  applied_message_id char(24)    REFERENCES playbook.design_messages(id) ON DELETE SET NULL,
  lock_version       integer     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_design_operations_flow ON playbook.design_operations (flow_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_playbook_design_operations_owner ON playbook.design_operations (owner_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_design_operations_key ON playbook.design_operations (owner_id, flow_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_playbook_design_operations_message ON playbook.design_operations (applied_message_id) WHERE applied_message_id IS NOT NULL;

-- ---------------------------------------------------------------- assistant (short-lived rows keyed by string ids, TTL-swept)
CREATE TABLE IF NOT EXISTS playbook.assistant_requests (
  id                          char(24)    PRIMARY KEY,
  request_id                  text        NOT NULL,
  owner_id                    text        NOT NULL,
  agent_id                    text        NOT NULL,
  conversation_id             text        NOT NULL,
  correlation_id              text        NOT NULL,
  operation_kind              varchar(24) NOT NULL
                              CONSTRAINT playbook_assistant_requests_operation_kind CHECK (operation_kind IN ('inspect','existing_construction','generation')),
  playbook_id                 text,
  expected_definition_revision integer,
  context_id                  text        NOT NULL,
  message_hash                text        NOT NULL,
  original_text               text        NOT NULL,
  requested_name              text,
  handoff_context             jsonb,
  handoff_provenance          jsonb,
  workspace_default_ids       text[]      NOT NULL DEFAULT '{}',
  selected_task_id            text,
  execution_id                text,
  attachment_ids              text[]      NOT NULL DEFAULT '{}',
  continuation_id             text,
  assessment                  jsonb,
  assessment_version          integer     NOT NULL DEFAULT 0,
  answers                     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  mutation_operation_id       text,
  assistant_answer            text,
  response_payload            jsonb,
  status                      varchar(24) NOT NULL DEFAULT 'processing'
                              CONSTRAINT playbook_assistant_requests_status CHECK (status IN ('processing','awaiting_clarification','ready','completed','failed')),
  expires_at                  timestamptz NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_assistant_requests_request ON playbook.assistant_requests (request_id);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_requests_conversation ON playbook.assistant_requests (owner_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_requests_playbook ON playbook.assistant_requests (owner_id, playbook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_requests_continuation ON playbook.assistant_requests (continuation_id) WHERE continuation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_requests_status ON playbook.assistant_requests (status);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_requests_expires ON playbook.assistant_requests (expires_at);

CREATE TABLE IF NOT EXISTS playbook.assistant_operations (
  id                         char(24)    PRIMARY KEY,
  operation_id               text        NOT NULL,
  playbook_id                text        NOT NULL,
  owner_id                   text        NOT NULL,
  request_id                 text,
  operation_kind             varchar(16) NOT NULL DEFAULT 'construction'
                             CONSTRAINT playbook_assistant_operations_operation_kind CHECK (operation_kind IN ('construction','generation')),
  origin                     varchar(10) NOT NULL DEFAULT 'designer'
                             CONSTRAINT playbook_assistant_operations_origin CHECK (origin IN ('designer','mcp','advisor')),
  target                     varchar(20) NOT NULL DEFAULT 'canonical'
                             CONSTRAINT playbook_assistant_operations_target CHECK (target IN ('canonical','advisor_preview')),
  apply_target               varchar(20) NOT NULL DEFAULT 'current_playbook'
                             CONSTRAINT playbook_assistant_operations_apply_target CHECK (apply_target IN ('current_playbook','new_playbook')),
  disposition                varchar(10) NOT NULL DEFAULT 'pending'
                             CONSTRAINT playbook_assistant_operations_disposition CHECK (disposition IN ('pending','applying','applied','discarded','reverted')),
  status                     varchar(10) NOT NULL DEFAULT 'queued'
                             CONSTRAINT playbook_assistant_operations_status CHECK (status IN ('queued','running','completed','failed','cancelled')),
  base_definition_revision   integer     NOT NULL
                             CONSTRAINT playbook_assistant_operations_base_revision CHECK (base_definition_revision >= 0),
  last_sequence              integer     NOT NULL DEFAULT 0,
  events                     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  event_bytes                integer     NOT NULL DEFAULT 0,
  worker_id                  text        NOT NULL,
  lease_expires_at           timestamptz,
  terminal_at                timestamptz,
  committed_revision         integer,
  committed_at               timestamptz,
  reverted_revision          integer,
  reverted_at                timestamptz,
  created_playbook_id        text,
  expires_at                 timestamptz NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_assistant_operations_operation ON playbook.assistant_operations (operation_id);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_operations_owner_playbook ON playbook.assistant_operations (owner_id, playbook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_operations_request ON playbook.assistant_operations (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_operations_status ON playbook.assistant_operations (status);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_operations_lease ON playbook.assistant_operations (lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_operations_expires ON playbook.assistant_operations (expires_at);

CREATE TABLE IF NOT EXISTS playbook.assistant_messages (
  id              char(24)    PRIMARY KEY,
  message_id      text        NOT NULL,
  request_id      text        NOT NULL,
  conversation_id text        NOT NULL,
  owner_id        text        NOT NULL,
  playbook_id     text        NOT NULL,
  role            varchar(10) NOT NULL
                  CONSTRAINT playbook_assistant_messages_role CHECK (role IN ('user','assistant')),
  content         text        NOT NULL,
  operation_id    text,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_assistant_messages_message ON playbook.assistant_messages (message_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_assistant_messages_request_role ON playbook.assistant_messages (request_id, role);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_messages_conversation ON playbook.assistant_messages (owner_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_messages_expires ON playbook.assistant_messages (expires_at);

CREATE TABLE IF NOT EXISTS playbook.assistant_revisions (
  id                  char(24)    PRIMARY KEY,
  operation_id        text        NOT NULL,
  playbook_id         text        NOT NULL,
  owner_id            text        NOT NULL,
  definition_revision integer     NOT NULL
                      CONSTRAINT playbook_assistant_revisions_revision CHECK (definition_revision >= 0),
  definition          jsonb       NOT NULL,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_assistant_revisions_operation ON playbook.assistant_revisions (operation_id);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_revisions_playbook ON playbook.assistant_revisions (playbook_id);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_revisions_expires ON playbook.assistant_revisions (expires_at);

CREATE TABLE IF NOT EXISTS playbook.assistant_attachments (
  id                           char(24)    PRIMARY KEY,
  attachment_id                text        NOT NULL,
  request_id                   text        NOT NULL,
  owner_id                     text        NOT NULL,
  playbook_id                  text        NOT NULL,
  expected_definition_revision integer     NOT NULL
                               CONSTRAINT playbook_assistant_attachments_revision CHECK (expected_definition_revision >= 0),
  object_key                   text        NOT NULL,
  media_type                   text        NOT NULL,
  declared_size                bigint      NOT NULL
                               CONSTRAINT playbook_assistant_attachments_declared_size CHECK (declared_size >= 1),
  actual_size                  bigint
                               CONSTRAINT playbook_assistant_attachments_actual_size CHECK (actual_size IS NULL OR actual_size >= 1),
  content_sha256               text,
  status                       varchar(10) NOT NULL DEFAULT 'pending'
                               CONSTRAINT playbook_assistant_attachments_status CHECK (status IN ('pending','confirmed')),
  expires_at                   timestamptz NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_assistant_attachments_attachment ON playbook.assistant_attachments (attachment_id);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_attachments_request ON playbook.assistant_attachments (owner_id, request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_attachments_playbook ON playbook.assistant_attachments (playbook_id);
CREATE INDEX IF NOT EXISTS idx_playbook_assistant_attachments_expires ON playbook.assistant_attachments (expires_at);

-- ---------------------------------------------------------------- replay baselines, run reports, evaluations
-- `doc` carries the template body (tool calls, reasoning outline, fingerprints, accepted examples, ...);
-- the columns are what the services filter and sort on.
CREATE TABLE IF NOT EXISTS playbook.validated_replays (
  id                        char(24)    PRIMARY KEY,
  flow_id                   char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  task_id                   text        NOT NULL,
  iteration                 integer     NOT NULL,
  task_title                text        NOT NULL,
  created_by                text        NOT NULL,
  reference_execution_id    text        NOT NULL,
  reference_execution_number integer    NOT NULL,
  validation_version        integer     NOT NULL,
  status                    varchar(10) NOT NULL DEFAULT 'active'
                            CONSTRAINT playbook_validated_replays_status CHECK (status IN ('active','inactive','archived')),
  mode                      varchar(16) NOT NULL DEFAULT 'replay_strict'
                            CONSTRAINT playbook_validated_replays_mode CHECK (mode IN ('replay_strict','replay_flex','replay_adaptive','strict_replay')),
  is_stale                  boolean     NOT NULL DEFAULT false,
  label                     text,
  doc                       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_validated_replays_version ON playbook.validated_replays (flow_id, task_id, iteration, validation_version);
CREATE INDEX IF NOT EXISTS idx_playbook_validated_replays_flow_task ON playbook.validated_replays (flow_id, task_id, status);
CREATE INDEX IF NOT EXISTS idx_playbook_validated_replays_task ON playbook.validated_replays (task_id);
CREATE INDEX IF NOT EXISTS idx_playbook_validated_replays_reference ON playbook.validated_replays (reference_execution_id);

CREATE TABLE IF NOT EXISTS playbook.replay_run_reports (
  id                 char(24)    PRIMARY KEY,
  execution_id       text        NOT NULL,
  flow_id            char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  task_id            text        NOT NULL,
  iteration          integer     NOT NULL DEFAULT 0,
  replay_id          text        NOT NULL,
  validation_version integer     NOT NULL,
  mode               text        NOT NULL,
  verdict            varchar(10)
                     CONSTRAINT playbook_replay_run_reports_verdict CHECK (verdict IS NULL OR verdict IN ('pass','warning','fail','unknown')),
  overall_score      double precision,
  doc                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_replay_run_reports_execution ON playbook.replay_run_reports (execution_id, task_id, iteration, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_replay_run_reports_flow ON playbook.replay_run_reports (flow_id, task_id, iteration, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_replay_run_reports_flow_replay ON playbook.replay_run_reports (flow_id, task_id, replay_id, iteration, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_replay_run_reports_replay ON playbook.replay_run_reports (replay_id, created_at DESC);

CREATE TABLE IF NOT EXISTS playbook.evaluation_baselines (
  id                   char(24)    PRIMARY KEY,
  flow_id              char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  task_id              text        NOT NULL,
  iteration            integer     NOT NULL DEFAULT 0,
  source_execution_id  text        NOT NULL,
  source_mode          varchar(20) NOT NULL
                       CONSTRAINT playbook_evaluation_baselines_source_mode CHECK (source_mode IN ('selected_execution','current_inputs')),
  input_snapshots      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id   text        NOT NULL,
  replaced_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_evaluation_baselines_task ON playbook.evaluation_baselines (flow_id, task_id, iteration, replaced_at);

CREATE TABLE IF NOT EXISTS playbook.evaluation_executions (
  id                     char(24)    PRIMARY KEY,
  flow_id                char(24)    NOT NULL REFERENCES playbook.flows(id) ON DELETE CASCADE,
  execution_id           text        NOT NULL,
  task_id                text        NOT NULL,
  iteration              integer     NOT NULL DEFAULT 0,
  task_title             text        NOT NULL,
  baseline_id            text,
  mode                   varchar(10) NOT NULL
                         CONSTRAINT playbook_evaluation_executions_mode CHECK (mode IN ('semantic','reference','hybrid')),
  status                 varchar(10) NOT NULL DEFAULT 'completed'
                         CONSTRAINT playbook_evaluation_executions_status CHECK (status IN ('running','completed','failed')),
  score                  double precision,
  verdict                varchar(10)
                         CONSTRAINT playbook_evaluation_executions_verdict CHECK (verdict IS NULL OR verdict IN ('pass','warning','fail')),
  semantic_score         double precision,
  reference_score        double precision,
  artifact_score         double precision,
  format_score           double precision,
  evidence_score         double precision,
  execution_health_score double precision,
  expectation            text        NOT NULL DEFAULT '',
  rubric_version         text        NOT NULL DEFAULT 'evaluation-node-v1',
  judge_model            text,
  summary                text,
  findings               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  metrics                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  started_at             timestamptz,
  completed_at           timestamptz,
  error                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_playbook_evaluation_executions_task ON playbook.evaluation_executions (flow_id, task_id, iteration, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_evaluation_executions_execution ON playbook.evaluation_executions (execution_id);
