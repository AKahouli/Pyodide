-- Per-model LiteLLM drop_params flag (Admin > Model toggle, default false).
-- Lets admins mark models (e.g. proxy-backed Ollama deployments like
-- ornith-1.5:35b) for which LiteLLM must drop unsupported parameters such
-- as parallel_tool_calls instead of raising UnsupportedParamsError.
-- Idempotent: safe to re-run on a live database.

ALTER TABLE catalog.ai_models
  ADD COLUMN IF NOT EXISTS drop_params boolean NOT NULL DEFAULT false;
