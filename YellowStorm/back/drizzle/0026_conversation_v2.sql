-- P8 conversation-v2: dedicated schema (do not reuse conversation.* V1 tables).
SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS conversation_v2;

CREATE TABLE IF NOT EXISTS conversation_v2.sessions (
  id                              char(24) PRIMARY KEY,
  owner_id                        char(24)     NOT NULL,
  ai_session_id                   text,
  title                           varchar(500) NOT NULL DEFAULT '',
  status                          varchar(16)  NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','waiting','paused','stopped','completed','error')),
  last_event_at                   timestamptz  NOT NULL DEFAULT now(),
  is_shared                       boolean      NOT NULL DEFAULT false,
  share_token_hash                text,
  deleted_at                      timestamptz,
  deploy_status                   varchar(16)  NOT NULL DEFAULT 'idle'
                                  CHECK (deploy_status IN ('idle','deploying','deployed','error')),
  deployed_url                    text,
  deployed_app_title              text,
  last_deployed_at                timestamptz,
  last_deployed_revision_id       text,
  has_ai_features                 boolean      NOT NULL DEFAULT false,
  ai_features_checked_revision_id text,
  workspace_ids                   char(24)[]   NOT NULL DEFAULT '{}',
  selected_skill_ids              char(24)[]   NOT NULL DEFAULT '{}',
  selected_connector_ids          char(24)[]   NOT NULL DEFAULT '{}',
  event_sequence                  integer      NOT NULL DEFAULT 0 CHECK (event_sequence >= 0),
  event_count                     integer      NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  system_workspace_id             char(24),
  created_at                      timestamptz  NOT NULL DEFAULT now(),
  updated_at                      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_c2_sessions_owner_deleted_last
  ON conversation_v2.sessions (owner_id, deleted_at, last_event_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_sessions_ai_session
  ON conversation_v2.sessions (ai_session_id) WHERE ai_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_sessions_share_token
  ON conversation_v2.sessions (share_token_hash) WHERE share_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_v2.events (
  id          char(24) PRIMARY KEY,
  session_id  char(24)     NOT NULL REFERENCES conversation_v2.sessions(id) ON DELETE CASCADE,
  sequence    integer      NOT NULL CHECK (sequence >= 0),
  event_id    text         NOT NULL,
  type        varchar(32)  NOT NULL
              CHECK (type IN (
                'message','tool','step','plan','title','done','wait','error',
                'application_component','app_build_progress'
              )),
  emitted_at  integer      NOT NULL,
  payload     jsonb        NOT NULL,
  model_id    varchar(200),
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_events_session_sequence
  ON conversation_v2.events (session_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_events_session_event_id
  ON conversation_v2.events (session_id, event_id);
CREATE INDEX IF NOT EXISTS idx_c2_events_session_type_sequence
  ON conversation_v2.events (session_id, type, sequence);

CREATE TABLE IF NOT EXISTS conversation_v2.app_shares (
  id                   char(24) PRIMARY KEY,
  session_id           char(24)     NOT NULL REFERENCES conversation_v2.sessions(id) ON DELETE CASCADE,
  owner_id             char(24)     NOT NULL,
  recipient_user_id    char(24),
  recipient_email      text,
  title                varchar(500) NOT NULL,
  deployed_url         text         NOT NULL,
  last_deployed_at     timestamptz,
  include_conversation boolean      NOT NULL DEFAULT true,
  invite_token_hash    text,
  invite_expires_at    timestamptz,
  invite_consumed_at   timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_shares_session_user
  ON conversation_v2.app_shares (session_id, recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_shares_session_email
  ON conversation_v2.app_shares (session_id, recipient_email)
  WHERE recipient_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_c2_shares_invite_token
  ON conversation_v2.app_shares (invite_token_hash)
  WHERE invite_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_c2_shares_recipient_updated
  ON conversation_v2.app_shares (recipient_user_id, updated_at DESC);
