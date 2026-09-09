-- Fleet-wide standard-run admission state (resilience WP07).
-- Additive only. The partial unique index enforces same-conversation
-- exclusivity across actors and replicas at the database level.
CREATE TABLE IF NOT EXISTS "conversation"."conversation_executions" (
  "id" char(24) PRIMARY KEY,
  "conversation_id" char(24) NOT NULL REFERENCES "conversation"."conversations"("id") ON DELETE CASCADE,
  "user_id" char(24) NOT NULL,
  "message_id" char(24) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'running',
  "owner_replica_id" text,
  "cancel_requested_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversation_executions_id_object_id" CHECK ("id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "conversation_executions_status" CHECK ("status" IN ('running', 'cancelled', 'completed', 'failed', 'interrupted'))
);

-- At most ONE running execution per conversation, across all actors/replicas.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversation_executions_running_conversation"
  ON "conversation"."conversation_executions" ("conversation_id")
  WHERE "status" = 'running';

-- At most one execution row per AI message attempt.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversation_executions_message"
  ON "conversation"."conversation_executions" ("message_id");

-- Per-user active-run capacity accounting (bounded index). The expiry filter
-- lives in query predicates (now() is not IMMUTABLE, so it cannot appear in
-- an index predicate); this index still serves the status='running' portion.
CREATE INDEX IF NOT EXISTS "idx_conversation_executions_user_running"
  ON "conversation"."conversation_executions" ("user_id", "id")
  WHERE "status" = 'running';
