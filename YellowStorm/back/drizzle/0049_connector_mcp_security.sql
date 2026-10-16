SET LOCAL lock_timeout = '5s';
ALTER TABLE integrations.connectors
  ADD COLUMN IF NOT EXISTS mcp_security_policy jsonb NOT NULL DEFAULT '{"version":1,"profile":"configured","actorDelegation":"none","allowPrivateNetwork":false,"requiredPermissions":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS security_revision integer NOT NULL DEFAULT 1;
ALTER TABLE integrations.connectors ADD CONSTRAINT connectors_security_revision_positive CHECK (security_revision > 0);
-- Deliberately no URL/slug-based trust promotion. Administrators must explicitly
-- configure approved connector IDs after deployment (ADR-0018).
