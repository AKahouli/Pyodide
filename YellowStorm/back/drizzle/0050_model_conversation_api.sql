ALTER TABLE "catalog"."ai_models" ADD COLUMN "conversation_api" varchar(32) DEFAULT 'chat_completions' NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog"."ai_models" ADD CONSTRAINT "ai_models_conversation_api_check" CHECK ("conversation_api" IN ('chat_completions', 'responses'));
