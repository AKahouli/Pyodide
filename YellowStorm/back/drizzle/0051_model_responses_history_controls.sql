ALTER TABLE "catalog"."ai_models"
  ADD COLUMN "responses_history_mode" varchar(16) NOT NULL DEFAULT 'application',
  ADD COLUMN "reasoning_history" varchar(16) NOT NULL DEFAULT 'auto',
  ADD COLUMN "reasoning_summary" varchar(16) NOT NULL DEFAULT 'off';
--> statement-breakpoint
ALTER TABLE "catalog"."ai_models"
  ADD CONSTRAINT "ai_models_responses_history_mode_check" CHECK (responses_history_mode IN ('application', 'provider')),
  ADD CONSTRAINT "ai_models_reasoning_history_check" CHECK (reasoning_history IN ('none', 'last', 'all', 'auto')),
  ADD CONSTRAINT "ai_models_reasoning_summary_check" CHECK (reasoning_summary IN ('off', 'auto', 'concise', 'detailed')),
  ADD CONSTRAINT "ai_models_provider_reasoning_history_check" CHECK (conversation_api <> 'responses' OR responses_history_mode <> 'provider' OR reasoning_history = 'auto');
