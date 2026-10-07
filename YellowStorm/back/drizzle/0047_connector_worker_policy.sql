SET LOCAL lock_timeout = '5s';
ALTER TABLE integrations.connectors ADD COLUMN IF NOT EXISTS worker_policy jsonb NOT NULL DEFAULT '{"enabled":true,"defaultExecutionKind":"leaf","agentLaunchEnabled":false}'::jsonb;
