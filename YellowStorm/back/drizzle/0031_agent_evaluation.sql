-- P6 agent evaluation: datasets, scenarios, runs and the answer-reliability settings singleton
-- of the Nest evaluation module. The schema is agent_evaluation because `evaluation.*` belongs
-- to another feature. Numbered 0031 to leave 0029/0030 to feat/app-templates.
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS agent_evaluation;

CREATE TABLE IF NOT EXISTS agent_evaluation.datasets (
  id           char(24)    PRIMARY KEY,
  name         text        NOT NULL,
  items        jsonb       NOT NULL DEFAULT '[]',
  created_by   char(24)    NOT NULL REFERENCES identity.users(id),
  workspace_id char(24)    REFERENCES workspace.workspaces(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ae_datasets_created_by ON agent_evaluation.datasets (created_by);
CREATE INDEX IF NOT EXISTS idx_ae_datasets_workspace ON agent_evaluation.datasets (workspace_id);

CREATE TABLE IF NOT EXISTS agent_evaluation.evaluations (
  id             char(24)    PRIMARY KEY,
  agent_id       char(24)    NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  scenario_name  text        NOT NULL,
  dataset_id     char(24)    REFERENCES agent_evaluation.datasets(id) ON DELETE SET NULL,
  mode           varchar(16) NOT NULL DEFAULT 'non_strict'
                 CONSTRAINT ae_evaluations_mode CHECK (mode IN ('strict','non_strict')),
  results        jsonb       NOT NULL DEFAULT '[]',
  num_runs       integer     NOT NULL DEFAULT 1,
  completed_runs integer     NOT NULL DEFAULT 0,
  status         varchar(16) NOT NULL DEFAULT 'processing'
                 CONSTRAINT ae_evaluations_status CHECK (status IN ('processing','completed','failed')),
  created_by     char(24)    NOT NULL REFERENCES identity.users(id),
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ae_evaluations_agent_created
  ON agent_evaluation.evaluations (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ae_evaluations_created_by ON agent_evaluation.evaluations (created_by);
CREATE INDEX IF NOT EXISTS idx_ae_evaluations_dataset ON agent_evaluation.evaluations (dataset_id);

CREATE TABLE IF NOT EXISTS agent_evaluation.scenarios (
  id         char(24)    PRIMARY KEY,
  name       text        NOT NULL,
  agent_id   char(24)    NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  dataset_id char(24)    NOT NULL REFERENCES agent_evaluation.datasets(id) ON DELETE CASCADE,
  num_runs   integer     NOT NULL DEFAULT 1,
  mode       varchar(16) NOT NULL DEFAULT 'non_strict'
             CONSTRAINT ae_scenarios_mode CHECK (mode IN ('strict','non_strict')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ae_scenarios_agent ON agent_evaluation.scenarios (agent_id);
CREATE INDEX IF NOT EXISTS idx_ae_scenarios_dataset ON agent_evaluation.scenarios (dataset_id);

CREATE TABLE IF NOT EXISTS agent_evaluation.settings (
  id                   char(24)    PRIMARY KEY,
  singleton            boolean     NOT NULL DEFAULT true
                       CONSTRAINT ae_settings_singleton_true CHECK (singleton),
  response_reliability jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ae_settings_singleton ON agent_evaluation.settings (singleton);
