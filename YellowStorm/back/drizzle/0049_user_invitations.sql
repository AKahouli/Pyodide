-- 0049_user_invitations — super-admin email invitations.
-- A super admin invites a user by email from #/admin/users; the invitee gets a
-- single-use link valid 24h that pre-fills (read-only) the existing register
-- modal. The raw token is never stored — only its SHA-256 hash, matching the
-- password-reset / app-share token at-rest rule. Rows are kept after consume
-- for audit; consumed_at + expires_at enforce single use and expiry.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS identity.user_invitations (
  id          char(24)     PRIMARY KEY,
  email       varchar(320) NOT NULL CHECK (email = lower(btrim(email))),
  token_hash  text         NOT NULL,
  invited_by  char(24)     REFERENCES identity.users(id),
  expires_at  timestamptz  NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invitations_token_hash ON identity.user_invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email     ON identity.user_invitations (email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_expires_at ON identity.user_invitations (expires_at);
