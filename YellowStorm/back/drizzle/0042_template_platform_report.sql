-- Platform Kit analysis of an uploaded template ZIP, computed at publish time.
-- Lets admins see whether a template will survive Template -> App Builder ->
-- Deployment before a user hits a failed deploy.
SET LOCAL lock_timeout = '5s';

ALTER TABLE conversation_v2.templates
  ADD COLUMN IF NOT EXISTS platform_report jsonb;
