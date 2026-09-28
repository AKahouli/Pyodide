-- Telegram evolution: guest chat bindings + owner validation (human-in-the-loop).
SET LOCAL lock_timeout = '5s';

ALTER TABLE channels.telegram_chat_bindings
  ADD COLUMN IF NOT EXISTS binding_type varchar(16) NOT NULL DEFAULT 'member';

ALTER TABLE channels.telegram_chat_bindings
  DROP CONSTRAINT IF EXISTS telegram_chat_bindings_type_enum;
ALTER TABLE channels.telegram_chat_bindings
  ADD CONSTRAINT telegram_chat_bindings_type_enum CHECK (binding_type IN ('member','guest'));

CREATE TABLE IF NOT EXISTS channels.telegram_human_validations (
  id                     char(24)     PRIMARY KEY,
  integration_id         char(24)     NOT NULL REFERENCES channels.telegram_integrations(id) ON DELETE CASCADE,
  agent_id               char(24)     NOT NULL,
  conversation_id        char(24)     NOT NULL,
  guest_telegram_chat_id varchar(64)  NOT NULL DEFAULT '',
  guest_label            varchar(200),
  question               text         NOT NULL,
  choices                text[]       NOT NULL DEFAULT '{}',
  status                 varchar(16)  NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','answered','expired','failed')),
  answer                 text,
  answered_at            timestamptz,
  expires_at             timestamptz  NOT NULL,
  owner_message_id       integer,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_validations_integration_status
  ON channels.telegram_human_validations (integration_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_telegram_validations_conversation
  ON channels.telegram_human_validations (conversation_id, status);
