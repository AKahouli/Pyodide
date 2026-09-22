CREATE SCHEMA IF NOT EXISTS semantic_access;

CREATE TABLE IF NOT EXISTS semantic_access.read_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id TEXT NOT NULL,
  model_id UUID NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  scope_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  jti TEXT NOT NULL UNIQUE,
  CHECK (expires_at > issued_at)
);

CREATE TABLE IF NOT EXISTS semantic_access.read_grant_sources (
  grant_id UUID NOT NULL REFERENCES semantic_access.read_grants(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  asset_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_read_grant_sources_uidx
  ON semantic_access.read_grant_sources (grant_id, workspace_id, COALESCE(asset_id, ''));
CREATE INDEX IF NOT EXISTS semantic_read_grants_actor_model_idx
  ON semantic_access.read_grants (actor_user_id, model_id);
CREATE INDEX IF NOT EXISTS semantic_read_grants_expires_idx
  ON semantic_access.read_grants (expires_at);
CREATE INDEX IF NOT EXISTS semantic_read_grant_sources_scope_idx
  ON semantic_access.read_grant_sources (grant_id, workspace_id, asset_id);

REVOKE ALL ON SCHEMA semantic_access FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA semantic_access FROM PUBLIC;
