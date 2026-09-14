-- Durable standard-run execution state (resilience WP06.3).
-- Additive only: existing rows keep NULL execution metadata and remain valid.
ALTER TABLE "conversation"."messages" ADD COLUMN IF NOT EXISTS "execution_status" varchar(20);
ALTER TABLE "conversation"."messages" ADD COLUMN IF NOT EXISTS "execution_attempt_id" text;
ALTER TABLE "conversation"."messages" ADD COLUMN IF NOT EXISTS "execution_owner_replica_id" text;
ALTER TABLE "conversation"."messages" ADD COLUMN IF NOT EXISTS "execution_started_at" timestamp with time zone;
ALTER TABLE "conversation"."messages" ADD COLUMN IF NOT EXISTS "last_progress_at" timestamp with time zone;
ALTER TABLE "conversation"."messages" ADD COLUMN IF NOT EXISTS "execution_terminal_at" timestamp with time zone;
ALTER TABLE "conversation"."messages" ADD COLUMN IF NOT EXISTS "interruption_reason" text;

-- Bounded recovery-worker scans: expired streaming leases by expiry order.
CREATE INDEX IF NOT EXISTS "idx_messages_streaming_lease_expiry_v2"
  ON "conversation"."messages" USING btree ("stream_execution_lease_expires_at", "id")
  WHERE "conversation"."messages"."is_streaming" = true;
