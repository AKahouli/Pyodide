CREATE TABLE IF NOT EXISTS "conversation"."conversation_usage_events" (
  "id" char(24) PRIMARY KEY NOT NULL,
  "event_key" text NOT NULL,
  "conversation_id" char(24) NOT NULL,
  "message_id" char(24) NOT NULL,
  "execution_id" text NOT NULL,
  "agent_id" varchar(100),
  "provider" varchar(100),
  "model" varchar(200) NOT NULL,
  "input_tokens" integer NOT NULL,
  "output_tokens" integer NOT NULL,
  "cached_input_tokens" integer DEFAULT 0 NOT NULL,
  "reasoning_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer NOT NULL,
  "cost_usd" double precision,
  "pricing_version" varchar(100),
  "carbon_grams_co2e" double precision,
  "carbon_methodology" varchar(100),
  "carbon_factor_version" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_usage_events_id_object_id" CHECK ("id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "conversation_usage_events_counts_non_negative" CHECK (
    "input_tokens" >= 0 AND "output_tokens" >= 0 AND "cached_input_tokens" >= 0
    AND "reasoning_tokens" >= 0 AND "total_tokens" >= 0
  ),
  CONSTRAINT "conversation_usage_events_estimates_non_negative" CHECK (
    COALESCE("cost_usd", 0) >= 0 AND COALESCE("carbon_grams_co2e", 0) >= 0
  ),
  CONSTRAINT "conversation_usage_events_conversation_fk" FOREIGN KEY ("conversation_id")
    REFERENCES "conversation"."conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "conversation_usage_events_message_fk" FOREIGN KEY ("message_id")
    REFERENCES "conversation"."messages"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversation_usage_events_event_key"
  ON "conversation"."conversation_usage_events" USING btree ("event_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversation_usage_events_conversation_created"
  ON "conversation"."conversation_usage_events" USING btree ("conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversation_usage_events_model_created"
  ON "conversation"."conversation_usage_events" USING btree ("model", "created_at");
--> statement-breakpoint
INSERT INTO "conversation"."conversation_usage_events" (
  "id", "event_key", "conversation_id", "message_id", "execution_id", "model",
  "input_tokens", "output_tokens", "total_tokens", "created_at"
)
SELECT
  "id", 'legacy-message:' || "id", "conversation_id", "id", 'legacy-message:' || "id",
  COALESCE("model_id", 'unknown'), COALESCE("input_tokens", 0), COALESCE("output_tokens", 0),
  COALESCE("input_tokens", 0) + COALESCE("output_tokens", 0), "created_at"
FROM "conversation"."messages"
WHERE "conversation_type" = 'ai'
  AND COALESCE("input_tokens", 0) + COALESCE("output_tokens", 0) > 0
ON CONFLICT ("event_key") DO NOTHING;
