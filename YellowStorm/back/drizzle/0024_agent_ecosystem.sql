-- 0024_agent_ecosystem.sql — P4 agent ecosystem (plan 2026-09-19 step 4).
-- Schemas: public.shared_agents, teams.*, channels.*.
-- All DDL applied once before the 4a/4b/4c cutovers. Ids char(24), app-generated.
-- Ciphertext columns (encrypted_bot_token, whatsapp auth blobs) copied byte-exact.

SET LOCAL lock_timeout = '5s';
CREATE SCHEMA IF NOT EXISTS teams;
CREATE SCHEMA IF NOT EXISTS channels;

-- ── shares (same schema as agents) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shared_agents (
  id          char(24)    PRIMARY KEY,
  agent_id    char(24)    NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,  -- replaces removeAllSharesForAgent
  shared_by   char(24)    NOT NULL,
  shared_with char(24)    NOT NULL,
  permission  varchar(8)  NOT NULL DEFAULT 'read' CHECK (permission IN ('read','write')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_agents_agent_user   ON public.shared_agents (agent_id, shared_with);
CREATE INDEX IF NOT EXISTS idx_shared_agents_with_created       ON public.shared_agents (shared_with, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_agents_by                 ON public.shared_agents (shared_by);

-- ── teams ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams.teams (
  id          char(24)      PRIMARY KEY,
  name        varchar(100)  NOT NULL CHECK (char_length(btrim(name)) >= 2),
  description varchar(2000) NOT NULL DEFAULT '',
  is_active   boolean       NOT NULL DEFAULT true,
  created_by  char(24)      NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_owner_name  ON teams.teams (name, created_by);
CREATE INDEX IF NOT EXISTS idx_teams_owner_active      ON teams.teams (created_by, is_active);
CREATE INDEX IF NOT EXISTS idx_teams_name_trgm         ON teams.teams USING gin (name gin_trgm_ops);

-- teams.members[] → table; position = array index (the API returns members in array order).
CREATE TABLE IF NOT EXISTS teams.team_members (
  team_id         char(24)         NOT NULL REFERENCES teams.teams(id)    ON DELETE CASCADE,
  agent_id        char(24)         NOT NULL REFERENCES public.agents(id)  ON DELETE CASCADE,   -- replaces $pull members
  parent_agent_id char(24)         REFERENCES public.agents(id)           ON DELETE SET NULL,  -- replaces arrayFilters $set null
  "order"         integer          NOT NULL DEFAULT 0 CHECK ("order" >= 0),
  position_x      double precision NOT NULL DEFAULT 0,
  position_y      double precision NOT NULL DEFAULT 0,
  position        integer          NOT NULL,
  PRIMARY KEY (team_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_agent  ON teams.team_members (agent_id);
CREATE INDEX IF NOT EXISTS idx_team_members_parent ON teams.team_members (parent_agent_id) WHERE parent_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS teams.shared_teams (
  id          char(24)    PRIMARY KEY,
  team_id     char(24)    NOT NULL REFERENCES teams.teams(id) ON DELETE CASCADE,
  shared_by   char(24)    NOT NULL,
  shared_with char(24)    NOT NULL,
  permission  varchar(8)  NOT NULL DEFAULT 'read' CHECK (permission IN ('read','write')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_teams_team_user ON teams.shared_teams (team_id, shared_with);
CREATE INDEX IF NOT EXISTS idx_shared_teams_with_created    ON teams.shared_teams (shared_with, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_teams_by              ON teams.shared_teams (shared_by);

CREATE TABLE IF NOT EXISTS teams.auto_builder_config (
  id            char(24)         PRIMARY KEY,
  singleton     boolean          NOT NULL DEFAULT true CHECK (singleton),
  model_id      varchar(255)     NOT NULL,
  system_prompt varchar(10000)   NOT NULL,
  temperature   double precision NOT NULL DEFAULT 0.7 CHECK (temperature BETWEEN 0 AND 2),
  is_enabled    boolean          NOT NULL DEFAULT false,
  created_at    timestamptz      NOT NULL DEFAULT now(),
  updated_at    timestamptz      NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_auto_builder_singleton ON teams.auto_builder_config (singleton);

-- ── channels: telegram ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels.telegram_integrations (
  id                  char(24)     PRIMARY KEY,
  user_id             char(24)     NOT NULL,
  agent_id            char(24)     NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,  -- ⚑ safety net, see 4.6
  encrypted_bot_token text         NOT NULL,                -- ciphertext
  bot_username        varchar(100),
  webhook_secret      varchar(128) NOT NULL,
  enabled             boolean      NOT NULL DEFAULT true,
  status              varchar(16)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','error')),
  error_message       varchar(500),
  last_webhook_at     timestamptz,
  last_update_id      bigint,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_integrations_agent ON channels.telegram_integrations (agent_id);
CREATE INDEX IF NOT EXISTS idx_telegram_integrations_user_enabled ON channels.telegram_integrations (user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_telegram_integrations_status       ON channels.telegram_integrations (status);

CREATE TABLE IF NOT EXISTS channels.telegram_chat_bindings (
  id               char(24)    PRIMARY KEY,
  integration_id   char(24)    NOT NULL REFERENCES channels.telegram_integrations(id) ON DELETE CASCADE,
  user_id          char(24)    NOT NULL,
  agent_id         char(24)    NOT NULL,
  telegram_chat_id varchar(64) NOT NULL,
  telegram_user_id varchar(64),
  conversation_id  char(24),                 -- FK → conversation.conversations ON DELETE SET NULL via fk script
  last_message_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_chat_bindings_chat ON channels.telegram_chat_bindings (integration_id, telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_telegram_chat_bindings_user       ON channels.telegram_chat_bindings (user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_chat_bindings_agent      ON channels.telegram_chat_bindings (agent_id);
CREATE INDEX IF NOT EXISTS idx_telegram_chat_bindings_conv       ON channels.telegram_chat_bindings (conversation_id) WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS channels.telegram_link_codes (
  id             char(24)    PRIMARY KEY,
  integration_id char(24)    NOT NULL REFERENCES channels.telegram_integrations(id) ON DELETE CASCADE,
  user_id        char(24)    NOT NULL,
  agent_id       char(24)    NOT NULL,
  code_hash      char(64)    NOT NULL,
  expires_at     timestamptz NOT NULL,
  consumed       boolean     NOT NULL DEFAULT false,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_link_codes_hash      ON channels.telegram_link_codes (code_hash);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_integration     ON channels.telegram_link_codes (integration_id, consumed);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_expires         ON channels.telegram_link_codes (expires_at);

-- ── channels: whatsapp ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels.whatsapp_integrations (
  id               char(24)     PRIMARY KEY,
  user_id          char(24)     NOT NULL,
  agent_id         char(24)     NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,  -- ⚑ safety net, see 4.6
  phone_number     varchar(32),
  display_name     varchar(200),
  status           varchar(16)  NOT NULL DEFAULT 'DISCONNECTED'
                   CHECK (status IN ('PAIRING','CONNECTED','DISCONNECTED','FAILED')),
  session_id       varchar(128),
  last_activity_at timestamptz,
  error_message    varchar(500),
  enabled          boolean      NOT NULL DEFAULT true,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_integrations_agent  ON channels.whatsapp_integrations (agent_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_integrations_user_status  ON channels.whatsapp_integrations (user_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_integrations_session      ON channels.whatsapp_integrations (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_integrations_connected    ON channels.whatsapp_integrations (status, enabled) WHERE status = 'CONNECTED';

-- integration_id is POLYMORPHIC (agent integration | worky stream integration | worky system bot):
-- no FK until worky moves (P7). owner_kind records which.
CREATE TABLE IF NOT EXISTS channels.whatsapp_auth_sessions (
  integration_id        char(24)    PRIMARY KEY,
  owner_kind            varchar(16) NOT NULL CHECK (owner_kind IN ('agent','worky_stream','worky_system_bot')),
  encrypted_credentials text,                   -- ciphertext; nullable: creds and keys are upserted separately
  encrypted_keys        text,                   -- ciphertext; whole signal-key map
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
) WITH (fillfactor = 70);                        -- hot single-row upserts
ALTER TABLE channels.whatsapp_auth_sessions SET (autovacuum_vacuum_scale_factor = 0.05, toast.autovacuum_vacuum_scale_factor = 0.05);

CREATE TABLE IF NOT EXISTS channels.whatsapp_chat_bindings (
  id                char(24)     PRIMARY KEY,
  integration_id    char(24)     NOT NULL,       -- polymorphic, see above
  owner_kind        varchar(16)  NOT NULL CHECK (owner_kind IN ('agent','worky_stream','worky_system_bot')),
  user_id           char(24)     NOT NULL,
  agent_id          char(24)     NOT NULL,
  remote_jid        varchar(128) NOT NULL,
  conversation_id   char(24),                     -- FK → conversation.conversations ON DELETE SET NULL via fk script
  worky_stream_id   char(24),
  last_message_at   timestamptz,
  last_inbound_text text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_chat_bindings_jid   ON channels.whatsapp_chat_bindings (integration_id, remote_jid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_bindings_user        ON channels.whatsapp_chat_bindings (user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_bindings_agent_recent ON channels.whatsapp_chat_bindings (agent_id, last_message_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_bindings_conv        ON channels.whatsapp_chat_bindings (conversation_id) WHERE conversation_id IS NOT NULL;

-- ── channels: widget ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels.widget_tokens (
  id              char(24)     PRIMARY KEY,
  token_hash      char(64)     NOT NULL,
  agent_id        char(24)     NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  label           varchar(200),
  allowed_origins text[]       NOT NULL DEFAULT '{}',
  is_active       boolean      NOT NULL DEFAULT true,
  expires_at      timestamptz,                 -- NOT a TTL: checked in code
  last_used_at    timestamptz,
  created_by      char(24)     NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_tokens_hash       ON channels.widget_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_widget_tokens_agent_active     ON channels.widget_tokens (agent_id, is_active);

CREATE TABLE IF NOT EXISTS channels.widget_sessions (
  id             char(24)    PRIMARY KEY,
  token_hash     char(64)    NOT NULL,
  agent_id       char(24)    NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  visitor_id     varchar(128) NOT NULL,
  metadata       jsonb       NOT NULL DEFAULT '{}',
  client_context jsonb       NOT NULL DEFAULT '{}',
  app_source     jsonb       NOT NULL DEFAULT '{}',
  geo            jsonb       NOT NULL DEFAULT '{"status":"unavailable","reason":"provider_not_configured"}',
  status         varchar(8)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  message_count  integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_widget_sessions_active_visitor ON channels.widget_sessions (token_hash, visitor_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_widget_sessions_agent                ON channels.widget_sessions (agent_id);

CREATE TABLE IF NOT EXISTS channels.widget_messages (
  id            char(24)     PRIMARY KEY,
  session_id    char(24)     NOT NULL REFERENCES channels.widget_sessions(id) ON DELETE CASCADE,
  token_hash    char(64)     NOT NULL,
  agent_id      char(24)     NOT NULL,
  role          varchar(16)  NOT NULL CHECK (role IN ('user','assistant')),
  content       varchar(50000) NOT NULL,
  components    jsonb        NOT NULL DEFAULT '[]',
  interaction   jsonb,
  input_tokens  integer,
  output_tokens integer,
  duration_ms   integer,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_widget_messages_session_created ON channels.widget_messages (session_id, created_at);
