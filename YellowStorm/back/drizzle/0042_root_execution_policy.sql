-- WP01 root-delegation persistence: versioned root_execution_policy on agents,
-- the allowlist junctions (direct specialists + source Teams), and the root
-- binding + work epoch on conversation.conversations.
--
-- Absent policy = no new behavior: legacy temporary-child fields keep their
-- meaning for unenrolled callers, and standard conversations simply have a
-- null root binding. The epoch is the cancellation/admission fence for root
-- work (Stop-all increments it under the control lock in later WPs).
--
-- Junctions cascade from agents so deleting a root or a specialist cleans its
-- allowlist entries. Teams junction intentionally has NO FK to teams.teams:
-- the resolver validates existence/grants at read time and a deleted Team
-- must only stop supplying members, not fail the root record.
-- Numbered 0042 after 0041_classifier_runs_playbook_fk.
SET LOCAL lock_timeout = '5s';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS root_execution_policy jsonb;

CREATE TABLE IF NOT EXISTS agent_root_delegate_agents (
  root_agent_id     char(24) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  delegate_agent_id char(24) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (root_agent_id, delegate_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_root_delegate_agents_delegate ON agent_root_delegate_agents (delegate_agent_id);

CREATE TABLE IF NOT EXISTS agent_root_delegate_teams (
  root_agent_id char(24) NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  team_id       char(24) NOT NULL,
  PRIMARY KEY (root_agent_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_root_delegate_teams_team ON agent_root_delegate_teams (team_id);

ALTER TABLE conversation.conversations ADD COLUMN IF NOT EXISTS root_agent_id char(24);
ALTER TABLE conversation.conversations ADD COLUMN IF NOT EXISTS root_work_epoch integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_conversations_root_agent ON conversation.conversations (root_agent_id)
  WHERE root_agent_id IS NOT NULL;
