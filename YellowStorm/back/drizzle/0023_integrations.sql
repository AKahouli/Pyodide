-- 0023_integrations.sql — P3 integrations schema (plan 2026-09-19 step 3).
-- Tables: connected_app_definitions, user_app_connections,
-- connected_app_oauth_states, connector_categories, connectors,
-- connector_skills, connector_credentials, admin_connector_auth_tokens,
-- admin_connector_oauth_states.
-- All DDL applied once before the P3 cutover. Ids char(24), app-generated.
-- Ciphertext columns keep the Mongo plaintext-at-rest parity (out of scope).

CREATE SCHEMA IF NOT EXISTS integrations;

CREATE TABLE IF NOT EXISTS integrations.connected_app_definitions (
  id                char(24)     PRIMARY KEY,
  app_key           varchar(50)  NOT NULL CHECK (app_key = lower(btrim(app_key))),
  display_name      varchar(100) NOT NULL,
  description       varchar(500),
  icon_key          varchar(50),
  authorization_url text         NOT NULL,
  token_url         text         NOT NULL,
  revoke_url        text,
  client_id         text         NOT NULL,
  client_secret     text         NOT NULL,
  tenant_id         text,
  scopes            text[]       NOT NULL,
  pkce_enabled      boolean      NOT NULL DEFAULT true,
  enabled           boolean      NOT NULL DEFAULT true,
  sort_order        integer      NOT NULL DEFAULT 0,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connected_app_definitions_key ON integrations.connected_app_definitions (app_key);
CREATE INDEX IF NOT EXISTS idx_connected_app_definitions_enabled   ON integrations.connected_app_definitions (enabled, sort_order);

CREATE TABLE IF NOT EXISTS integrations.user_app_connections (
  id                  char(24)     PRIMARY KEY,
  user_id             char(24)     NOT NULL,
  app_key             varchar(50)  NOT NULL,
  access_token        text         NOT NULL,
  refresh_token       text,
  token_expires_at    timestamptz,
  scopes              text[]       NOT NULL DEFAULT '{}',
  provider_account_id varchar(255),
  provider_email      varchar(320),
  status              varchar(16)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','error')),
  last_used_at        timestamptz,
  last_refreshed_at   timestamptz,
  error_message       text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_app_connections_user_app ON integrations.user_app_connections (user_id, app_key);
CREATE INDEX IF NOT EXISTS idx_user_app_connections_app            ON integrations.user_app_connections (app_key);

CREATE TABLE IF NOT EXISTS integrations.connected_app_oauth_states (
  id            char(24)     PRIMARY KEY,
  state         varchar(256) NOT NULL,
  app_key       varchar(50)  NOT NULL,
  user_id       char(24)     NOT NULL,
  code_verifier text,
  expires_at    timestamptz  NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connected_app_oauth_states_state ON integrations.connected_app_oauth_states (state);
CREATE INDEX IF NOT EXISTS idx_connected_app_oauth_states_expires     ON integrations.connected_app_oauth_states (expires_at);
CREATE INDEX IF NOT EXISTS idx_connected_app_oauth_states_user        ON integrations.connected_app_oauth_states (user_id);

CREATE TABLE IF NOT EXISTS integrations.connector_categories (
  id          char(24)      PRIMARY KEY,
  name        varchar(128)  NOT NULL,
  description varchar(1024) NOT NULL DEFAULT '',
  is_system   boolean       NOT NULL DEFAULT false,
  created_by  char(24)      NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_categories_owner_name ON integrations.connector_categories (name, created_by);
CREATE INDEX IF NOT EXISTS idx_connector_categories_created_by       ON integrations.connector_categories (created_by);

CREATE TABLE IF NOT EXISTS integrations.connectors (
  id                  char(24)      PRIMARY KEY,
  slug                varchar(64)   NOT NULL,
  name                varchar(128)  NOT NULL,
  description         varchar(1024) NOT NULL,
  icon                varchar(64)   NOT NULL DEFAULT '',
  color               varchar(64)   NOT NULL DEFAULT '',
  icon_color          varchar(8)    NOT NULL DEFAULT 'light',
  category_id         char(24)      REFERENCES integrations.connector_categories(id) ON DELETE SET NULL,
  auth_type           varchar(16)   NOT NULL DEFAULT 'none',
  auth_config_schema  jsonb         NOT NULL DEFAULT '{}',
  auth_source_type    varchar(32)   NOT NULL DEFAULT 'credential',
  connected_app_key   varchar(64)   NOT NULL DEFAULT '',
  runtime_auth_config jsonb         NOT NULL DEFAULT '{}',
  mcp_transport_type  varchar(32)   NOT NULL DEFAULT 'streamable_http',
  mcp_server_url      varchar(1024) NOT NULL,
  mcp_server_config   jsonb         NOT NULL DEFAULT '{}',
  dynamic_headers     jsonb         NOT NULL DEFAULT '[]',
  actions             jsonb         NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(actions) = 'array'),
  is_active           boolean       NOT NULL DEFAULT true,
  is_system           boolean       NOT NULL DEFAULT false,
  is_hidden           boolean       NOT NULL DEFAULT false,
  created_by          char(24)      NOT NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connectors_owner_slug  ON integrations.connectors (slug, created_by);
CREATE UNIQUE INDEX IF NOT EXISTS uq_connectors_system_slug ON integrations.connectors (slug) WHERE is_system;
CREATE INDEX IF NOT EXISTS idx_connectors_active_owner      ON integrations.connectors (is_active, created_by);
CREATE INDEX IF NOT EXISTS idx_connectors_category          ON integrations.connectors (category_id);
CREATE INDEX IF NOT EXISTS idx_connectors_created_by        ON integrations.connectors (created_by);
CREATE INDEX IF NOT EXISTS idx_connectors_flags             ON integrations.connectors (is_system, is_hidden);

CREATE TABLE IF NOT EXISTS integrations.connector_skills (
  connector_id char(24) NOT NULL REFERENCES integrations.connectors(id) ON DELETE CASCADE,
  skill_id     char(24) NOT NULL,
  position     integer  NOT NULL DEFAULT 0,
  PRIMARY KEY (connector_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_connector_skills_skill ON integrations.connector_skills (skill_id);

CREATE TABLE IF NOT EXISTS integrations.connector_credentials (
  id                char(24)     PRIMARY KEY,
  connector_id      char(24)     NOT NULL REFERENCES integrations.connectors(id) ON DELETE CASCADE,
  display_name      varchar(128) NOT NULL,
  auth_payload      jsonb        NOT NULL DEFAULT '{}',
  status            varchar(16)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid','expired')),
  last_validated_at timestamptz,
  expires_at        timestamptz,
  user_id           char(24)     NOT NULL,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connector_credentials_connector_user ON integrations.connector_credentials (connector_id, user_id);
CREATE INDEX IF NOT EXISTS idx_connector_credentials_user_status    ON integrations.connector_credentials (user_id, status);

CREATE TABLE IF NOT EXISTS integrations.admin_connector_auth_tokens (
  id                  char(24)    PRIMARY KEY,
  user_id             char(24)    NOT NULL,
  app_key             varchar(64) NOT NULL,
  access_token        text,
  refresh_token       text,
  token_expires_at    timestamptz,
  scopes              text[]      NOT NULL DEFAULT '{}',
  provider_account_id varchar(255),
  provider_email      varchar(320),
  connected           boolean     NOT NULL DEFAULT true,
  status              varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','error')),
  disconnected_at     timestamptz,
  last_used_at        timestamptz,
  last_refreshed_at   timestamptz,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_connector_auth_user_app ON integrations.admin_connector_auth_tokens (user_id, app_key);
CREATE INDEX IF NOT EXISTS idx_admin_connector_auth_app_connected  ON integrations.admin_connector_auth_tokens (app_key, connected);

CREATE TABLE IF NOT EXISTS integrations.admin_connector_oauth_states (
  id            char(24)     PRIMARY KEY,
  state         varchar(256) NOT NULL,
  app_key       varchar(64)  NOT NULL,
  user_id       char(24)     NOT NULL,
  code_verifier text,
  expires_at    timestamptz  NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_connector_oauth_states_state ON integrations.admin_connector_oauth_states (state);
CREATE INDEX IF NOT EXISTS idx_admin_connector_oauth_states_expires     ON integrations.admin_connector_oauth_states (expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_connector_oauth_states_user        ON integrations.admin_connector_oauth_states (user_id);
