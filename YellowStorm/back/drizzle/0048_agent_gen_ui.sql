-- Per-agent generative UI toggle (OpenUI). Replaces the front-end `openui-` slug gate:
-- ON = the run appends the OpenUI output-format block to the agent prompt and the
-- front renders the agent's answers with OpenUI.
--
-- Existing agents stay OFF (the column default), except the OpenUI experiment agents
-- the slug convention used to switch on (slug starts with `openui-`). New agents get
-- ON from AgentService.dtoToCreateInput, not from the column default, so system and
-- bootstrap agents (copilot, semantic extraction) never answer in OpenUI by accident.
-- The backfill runs only when this migration adds the column, so a replay never
-- re-enables an agent an admin switched off.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents'
      AND column_name = 'gen_ui_enabled'
      AND table_schema = ANY (current_schemas(false))
  ) THEN
    ALTER TABLE agents ADD COLUMN gen_ui_enabled boolean NOT NULL DEFAULT false;
    UPDATE agents SET gen_ui_enabled = true WHERE left(slug, 7) = 'openui-';
  END IF;
END
$$;
