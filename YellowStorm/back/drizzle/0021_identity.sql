-- 0021_identity — P1A identity core (plan 2026-09-19, step 1A)
-- identity: users, user_roles, sessions, auth_providers, oauth_states,
--           provider_link_tokens, user_provider_links, user_groups (+members)
-- authz:    roles, audit_logs
-- Ids: char(24), app-generated (newObjectId). Timestamps: timestamptz default now().

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS authz;

CREATE TABLE IF NOT EXISTS identity.users (
  id                                char(24)     PRIMARY KEY,
  email                             varchar(320) NOT NULL CHECK (email = lower(btrim(email))),
  password_hash                     text         NOT NULL,
  email_verified                    boolean      NOT NULL DEFAULT false,
  email_verification_token          text,
  email_verification_expiry         timestamptz,
  password_reset_token              text,
  password_reset_expiry             timestamptz,
  first_name                        varchar(100),
  last_name                         varchar(100),
  company                           varchar(200),
  profile_role                      varchar(200) NOT NULL DEFAULT '',
  description                       varchar(1000) NOT NULL DEFAULT '',
  color_theme                       varchar(16)  NOT NULL DEFAULT 'default'
                                    CHECK (color_theme IN ('default','yellow','orange','blue')),
  language                          varchar(16)  NOT NULL DEFAULT 'en',
  consent_privacy_policy            boolean      NOT NULL DEFAULT false,
  consent_privacy_policy_accepted_at timestamptz,
  consent_data_sharing              boolean      NOT NULL DEFAULT false,
  consent_data_sharing_accepted_at  timestamptz,
  profile_complete                  boolean      NOT NULL DEFAULT false,
  microsoft_account_id              varchar(255),
  plan_id                           char(24),              -- FK → catalog.plans added in 1B.3
  plan_slug                         varchar(50),
  plan_started_at                   timestamptz,
  permissions_version               integer      NOT NULL DEFAULT 1,
  status                            varchar(16)  NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active','inactive','suspended')),
  registration_approval             varchar(16)  CHECK (registration_approval IN ('pending','approved','rejected')),
  last_login_at                     timestamptz,
  created_at                        timestamptz  NOT NULL DEFAULT now(),
  updated_at                        timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email              ON identity.users (email);
CREATE INDEX IF NOT EXISTS idx_users_microsoft_account        ON identity.users (microsoft_account_id) WHERE microsoft_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_plan                     ON identity.users (plan_id);
CREATE INDEX IF NOT EXISTS idx_users_status                   ON identity.users (status);
CREATE INDEX IF NOT EXISTS idx_users_created                  ON identity.users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON identity.users (email_verification_token) WHERE email_verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token     ON identity.users (password_reset_token)     WHERE password_reset_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_trgm               ON identity.users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_first_name_trgm          ON identity.users USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_last_name_trgm           ON identity.users USING gin (last_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS authz.roles (
  id          char(24)     PRIMARY KEY,
  name        varchar(100) NOT NULL CHECK (name = lower(btrim(name))),
  description text         NOT NULL,
  permissions text[]       NOT NULL DEFAULT '{}',
  is_active   boolean      NOT NULL DEFAULT true,
  is_system   boolean      NOT NULL DEFAULT false,
  priority    integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_name     ON authz.roles (name);
CREATE INDEX IF NOT EXISTS idx_roles_active         ON authz.roles (is_active);
CREATE INDEX IF NOT EXISTS idx_roles_priority       ON authz.roles (priority DESC);

-- users.roles[] → junction; position keeps the array order (roleNames claim order).
CREATE TABLE IF NOT EXISTS identity.user_roles (
  user_id  char(24) NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role_id  char(24) NOT NULL REFERENCES authz.roles(id)    ON DELETE CASCADE,
  position smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON identity.user_roles (role_id);

CREATE TABLE IF NOT EXISTS identity.sessions (
  id                          char(24)    PRIMARY KEY,
  user_id                     char(24)    NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  refresh_token_hash          text        NOT NULL,
  device_info                 jsonb       NOT NULL,
  ip_address                  varchar(64) NOT NULL,
  is_valid                    boolean     NOT NULL DEFAULT true,
  expires_at                  timestamptz NOT NULL,
  last_activity_at            timestamptz,
  token_family                varchar(64) NOT NULL,
  rotated_from_session_id     char(24),
  rotated_to_session_id       char(24),
  rotation_attempt_id         varchar(128),
  rotated_at                  timestamptz,
  rotation_receipt_expires_at timestamptz,
  rotation_receipt_ciphertext text,
  rotation_receipt_key_id     varchar(64),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_valid        ON identity.sessions (user_id, is_valid);
CREATE INDEX IF NOT EXISTS idx_sessions_user_ip           ON identity.sessions (user_id, ip_address);
CREATE INDEX IF NOT EXISTS idx_sessions_expires           ON identity.sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token_family      ON identity.sessions (token_family);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_rotated_from ON identity.sessions (rotated_from_session_id) WHERE rotated_from_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS identity.auth_providers (
  id                char(24)     PRIMARY KEY,
  provider_key      varchar(50)  NOT NULL CHECK (provider_key = lower(btrim(provider_key))),
  display_name      varchar(100) NOT NULL,
  client_id         text         NOT NULL,   -- CryptoService ciphertext, opaque
  client_secret     text         NOT NULL,   -- CryptoService ciphertext, opaque
  tenant_id         text,                    -- CryptoService ciphertext, opaque
  authorization_url text         NOT NULL,
  token_url         text         NOT NULL,
  userinfo_url      text         NOT NULL,
  scopes            text[]       NOT NULL DEFAULT '{openid,email,profile}',
  icon_key          varchar(50),
  sort_order        integer      NOT NULL DEFAULT 0,
  pkce_enabled      boolean      NOT NULL DEFAULT true,
  enabled           boolean      NOT NULL DEFAULT true,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_providers_key   ON identity.auth_providers (provider_key);
CREATE INDEX IF NOT EXISTS idx_auth_providers_enabled_sort ON identity.auth_providers (enabled, sort_order);

CREATE TABLE IF NOT EXISTS identity.oauth_states (
  id            char(24)    PRIMARY KEY,
  state         varchar(256) NOT NULL,
  provider_key  varchar(50) NOT NULL,
  code_verifier text,
  return_url    text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_states_state ON identity.oauth_states (state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires     ON identity.oauth_states (expires_at);

-- Also holds temp-login tokens (sentinel provider_key '__temp_login__').
CREATE TABLE IF NOT EXISTS identity.provider_link_tokens (
  id               char(24)     PRIMARY KEY,
  token            varchar(256) NOT NULL,
  user_id          char(24)     NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider_key     varchar(50)  NOT NULL,
  provider_user_id varchar(255) NOT NULL,
  provider_email   varchar(320) NOT NULL,
  expires_at       timestamptz  NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_link_tokens_token ON identity.provider_link_tokens (token);
CREATE INDEX IF NOT EXISTS idx_provider_link_tokens_user        ON identity.provider_link_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_provider_link_tokens_expires     ON identity.provider_link_tokens (expires_at);

CREATE TABLE IF NOT EXISTS identity.user_provider_links (
  id               char(24)     PRIMARY KEY,
  user_id          char(24)     NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  provider_key     varchar(50)  NOT NULL,
  provider_user_id varchar(255) NOT NULL,
  provider_email   varchar(320) NOT NULL,
  linked_at        timestamptz  NOT NULL DEFAULT now(),
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_provider_links_provider ON identity.user_provider_links (provider_key, provider_user_id);
CREATE INDEX IF NOT EXISTS idx_user_provider_links_user           ON identity.user_provider_links (user_id);

-- Audit history: actor_id deliberately has NO FK (same rule as governance events).
CREATE TABLE IF NOT EXISTS authz.audit_logs (
  id             char(24)    PRIMARY KEY,
  actor_id       char(24)    NOT NULL,
  actor_email    varchar(320) NOT NULL,
  action         varchar(128) NOT NULL,
  target_id      char(24),
  target_type    varchar(64),
  metadata       jsonb,
  ip_address     varchar(64),
  user_agent     text,
  status         varchar(16) NOT NULL CHECK (status IN ('success','failure')),
  failure_reason text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created       ON authz.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON authz.audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON authz.audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target        ON authz.audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status        ON authz.audit_logs (status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_email_trgm ON authz.audit_logs USING gin (actor_email gin_trgm_ops);

CREATE TABLE IF NOT EXISTS identity.user_groups (
  id          char(24)      PRIMARY KEY,
  name        varchar(100)  NOT NULL CHECK (char_length(name) >= 2),
  description varchar(2000) NOT NULL DEFAULT '',
  created_by  char(24)      NOT NULL REFERENCES identity.users(id),
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_groups_owner_name ON identity.user_groups (name, created_by);  -- case-sensitive, as Mongo
CREATE INDEX IF NOT EXISTS idx_user_groups_created_by       ON identity.user_groups (created_by);

CREATE TABLE IF NOT EXISTS identity.user_group_members (
  group_id char(24) NOT NULL REFERENCES identity.user_groups(id) ON DELETE CASCADE,
  user_id  char(24) NOT NULL REFERENCES identity.users(id)       ON DELETE CASCADE,
  position integer  NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_user_group_members_user ON identity.user_group_members (user_id);  -- ⚑ missing in Mongo
