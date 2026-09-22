-- 0022_catalog_ops — P1B config & catalog leaves (plan 2026-09-19, step 1B)
-- catalog: settings, appearance logos, guardrails, ai_models, plans, tool
--          categories, tools, skill categories, skills (+files), agent types
--          (+skills junction, prompts)
-- ops:     notifications, health_history
-- All DDL applied once before 1B.1. Ids char(24), app-generated.

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS ops;

-- ── ops ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ops.notifications (
  id            char(24)     PRIMARY KEY,
  user_id       char(24),
  type          varchar(16)  NOT NULL CHECK (type IN ('info','warning','error','success','system')),
  title         varchar(200) NOT NULL,
  message       varchar(2000) NOT NULL,
  data          jsonb,
  actions       jsonb        NOT NULL DEFAULT '[]',
  destination   varchar(64)  NOT NULL DEFAULT 'user',
  status        varchar(16)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','read')),
  source_module varchar(100) NOT NULL,
  priority      varchar(16)  NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  expires_at    timestamptz,
  metadata_extra jsonb,
  sent_at       timestamptz,
  read_at       timestamptz,
  retry_count   integer      NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status_created ON ops.notifications (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_destination_status  ON ops.notifications (destination, status);
CREATE INDEX IF NOT EXISTS idx_notifications_expires             ON ops.notifications (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created             ON ops.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status_retry        ON ops.notifications (status, retry_count);

CREATE TABLE IF NOT EXISTS ops.health_history (
  id          char(24)    PRIMARY KEY,
  status      varchar(16) NOT NULL CHECK (status IN ('healthy','unhealthy','degraded')),
  timestamp   varchar(64) NOT NULL,
  version     varchar(64) NOT NULL,
  uptime      double precision NOT NULL,
  checks      jsonb       NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  expire_at   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_history_recorded        ON ops.health_history (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_history_status_recorded ON ops.health_history (status, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_history_expire          ON ops.health_history (expire_at);

-- ── catalog: settings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.system_settings (
  id         char(24)     PRIMARY KEY,
  key        varchar(100) NOT NULL,
  value      jsonb        NOT NULL,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_settings_key ON catalog.system_settings (key);

CREATE TABLE IF NOT EXISTS catalog.appearance_logos (
  id           char(24)    PRIMARY KEY,
  name         varchar(80) NOT NULL,
  content_type varchar(64) NOT NULL,
  width        integer     NOT NULL,
  height       integer     NOT NULL,
  data         bytea       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.guardrails_settings (
  id                 char(24)    PRIMARY KEY,
  singleton          boolean     NOT NULL DEFAULT true CHECK (singleton),
  force_activation   boolean     NOT NULL DEFAULT false,
  prompt_injection   jsonb       NOT NULL DEFAULT '{}',
  tool_action_review jsonb       NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardrails_settings_singleton ON catalog.guardrails_settings (singleton);

-- ── catalog: models & plans ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.ai_models (
  id                           char(24)     PRIMARY KEY,
  model_id                     varchar(255) NOT NULL,
  name                         varchar(255) NOT NULL,
  chef                         varchar(255) NOT NULL,
  chef_slug                    varchar(255) NOT NULL,
  litellm_model                varchar(255) NOT NULL DEFAULT '',
  providers                    text[]       NOT NULL DEFAULT '{}',
  type                         varchar(64)  NOT NULL DEFAULT '',
  types                        text[]       NOT NULL DEFAULT '{}',
  is_active                    boolean      NOT NULL DEFAULT true,
  is_default                   boolean      NOT NULL DEFAULT false,
  is_conversation_v2_default   boolean      NOT NULL DEFAULT false,
  omit_temperature             boolean      NOT NULL DEFAULT false,
  input_modalities             text[]       NOT NULL DEFAULT '{text}',
  max_input_tokens             integer,
  max_output_tokens            integer,
  input_cost_per_token         double precision,
  output_cost_per_token        double precision,
  cached_input_cost_per_token  double precision,
  supports_reasoning           boolean,
  reasoning_efforts            jsonb        NOT NULL DEFAULT '[]',
  default_reasoning_effort     varchar(64),
  created_at                   timestamptz  NOT NULL DEFAULT now(),
  updated_at                   timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_models_model_id        ON catalog.ai_models (model_id);
CREATE INDEX IF NOT EXISTS idx_ai_models_chef_active           ON catalog.ai_models (chef_slug, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_models_type_active           ON catalog.ai_models (type, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_models_types                 ON catalog.ai_models USING gin (types);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_models_single_default  ON catalog.ai_models (is_default) WHERE is_default;              -- ⚑ was app-enforced only
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_models_single_v2_default ON catalog.ai_models (is_conversation_v2_default) WHERE is_conversation_v2_default;

CREATE TABLE IF NOT EXISTS catalog.plans (
  id                      char(24)     PRIMARY KEY,
  name                    varchar(100) NOT NULL,
  slug                    varchar(50)  NOT NULL CHECK (slug = lower(btrim(slug))),
  description             varchar(500),
  token_limit             bigint       NOT NULL DEFAULT 0,        -- -1 = unlimited
  window_hours            integer      NOT NULL DEFAULT 24 CHECK (window_hours >= 1),
  requests_per_minute     integer      NOT NULL DEFAULT 60,
  max_tokens_per_request  bigint       NOT NULL DEFAULT -1,
  features                text[]       NOT NULL DEFAULT '{}',
  priority                integer      NOT NULL DEFAULT 0,
  price_monthly           numeric(12,2) NOT NULL DEFAULT 0,
  price_yearly            numeric(12,2) NOT NULL DEFAULT 0,
  currency                varchar(3)   NOT NULL DEFAULT 'USD',
  is_active               boolean      NOT NULL DEFAULT true,
  is_default              boolean      NOT NULL DEFAULT false,
  display_order           integer      NOT NULL DEFAULT 0,
  max_workspaces          integer      NOT NULL DEFAULT 3,
  workspace_storage_bytes bigint       NOT NULL DEFAULT 104857600,
  metadata                jsonb        NOT NULL DEFAULT '{}',
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_name           ON catalog.plans (name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_slug           ON catalog.plans (slug);
CREATE INDEX IF NOT EXISTS idx_plans_active_order         ON catalog.plans (is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_plans_priority             ON catalog.plans (priority);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_single_default ON catalog.plans (is_default) WHERE is_default;

-- ── catalog: tools / skills / agent types ─────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.tool_categories (
  id          char(24)      PRIMARY KEY,
  name        varchar(128)  NOT NULL,
  description varchar(1024) NOT NULL DEFAULT '',
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tool_categories_name ON catalog.tool_categories (name);

CREATE TABLE IF NOT EXISTS catalog.tools (
  id                  char(24)     PRIMARY KEY,
  name                varchar(255) NOT NULL,
  description         text         NOT NULL DEFAULT '',
  icon                varchar(64)  NOT NULL DEFAULT '',
  color               varchar(64)  NOT NULL DEFAULT '',
  icon_color          varchar(8)   CHECK (icon_color IN ('light','dark')),
  category_id         char(24)     REFERENCES catalog.tool_categories(id) ON DELETE SET NULL,  -- ⚑ was left dangling
  default_agent_types text[]       NOT NULL DEFAULT '{}',
  attributes          jsonb        NOT NULL DEFAULT '[]',   -- subdoc _ids preserved inside
  required_app_key    varchar(64),
  is_active           boolean      NOT NULL DEFAULT true,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tools_name            ON catalog.tools (name);
CREATE INDEX IF NOT EXISTS idx_tools_category              ON catalog.tools (category_id);
CREATE INDEX IF NOT EXISTS idx_tools_active                ON catalog.tools (is_active);
CREATE INDEX IF NOT EXISTS idx_tools_default_agent_types   ON catalog.tools USING gin (default_agent_types);

CREATE TABLE IF NOT EXISTS catalog.skill_categories (
  id          char(24)      PRIMARY KEY,
  name        varchar(128)  NOT NULL,
  description varchar(1024) NOT NULL DEFAULT '',
  is_system   boolean       NOT NULL DEFAULT false,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_categories_name ON catalog.skill_categories (name);

CREATE TABLE IF NOT EXISTS catalog.skills (
  id            char(24)      PRIMARY KEY,
  slug          varchar(64),
  name          varchar(64)   NOT NULL,
  description   varchar(1024) NOT NULL,
  icon          varchar(64)   NOT NULL DEFAULT '',
  color         varchar(64)   NOT NULL DEFAULT '',
  icon_color    varchar(8),
  category_id   char(24)      REFERENCES catalog.skill_categories(id) ON DELETE SET NULL,  -- ⚑
  license       varchar(255),
  compatibility varchar(500),
  metadata      jsonb         NOT NULL DEFAULT '{}',
  allowed_tools text[]        NOT NULL DEFAULT '{}',
  instructions  varchar(50000),
  is_active     boolean       NOT NULL DEFAULT true,
  created_by    char(24)      NOT NULL,          -- may be the system sentinel → no user FK
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_owner_name ON catalog.skills (name, created_by);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_owner_slug ON catalog.skills (slug, created_by) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skills_active_owner     ON catalog.skills (is_active, created_by);
CREATE INDEX IF NOT EXISTS idx_skills_category         ON catalog.skills (category_id);
CREATE INDEX IF NOT EXISTS idx_skills_created_by       ON catalog.skills (created_by);

-- skills.files[] (content up to 500 kB each) → child table, loaded only when requested.
CREATE TABLE IF NOT EXISTS catalog.skill_files (
  id        char(24)     PRIMARY KEY,          -- preserved subdoc _id
  skill_id  char(24)     NOT NULL REFERENCES catalog.skills(id) ON DELETE CASCADE,
  path      varchar(255) NOT NULL,
  kind      varchar(16)  NOT NULL CHECK (kind IN ('reference','asset')),
  mime_type varchar(128),
  content   text         NOT NULL,
  position  integer      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_skill_files_skill ON catalog.skill_files (skill_id, position);

CREATE TABLE IF NOT EXISTS catalog.agent_types (
  id             char(24)     PRIMARY KEY,
  name           varchar(100) NOT NULL,
  slug           varchar(100) NOT NULL,
  default_prompt varchar(50000),
  is_active      boolean      NOT NULL DEFAULT true,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_types_name ON catalog.agent_types (name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_types_slug ON catalog.agent_types (slug);
CREATE INDEX IF NOT EXISTS idx_agent_types_active     ON catalog.agent_types (is_active);

-- agent_types.skills[] → junction (replaces the $pull in skill.service.ts:259).
CREATE TABLE IF NOT EXISTS catalog.agent_type_skills (
  agent_type_id char(24) NOT NULL REFERENCES catalog.agent_types(id) ON DELETE CASCADE,
  skill_id      char(24) NOT NULL REFERENCES catalog.skills(id)      ON DELETE CASCADE,
  position      integer  NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_type_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_type_skills_skill ON catalog.agent_type_skills (skill_id);

CREATE TABLE IF NOT EXISTS catalog.agent_type_prompts (
  id            char(24)     PRIMARY KEY,
  agent_type_id char(24)     NOT NULL REFERENCES catalog.agent_types(id) ON DELETE CASCADE,
  model_id      varchar(255) NOT NULL,          -- ai_models.model_id, soft link (models are deactivated, not deleted)
  prompt        varchar(50000) NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_type_prompts_type_model ON catalog.agent_type_prompts (agent_type_id, model_id);
