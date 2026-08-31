DROP INDEX IF EXISTS "idx_agents_role_embedding";
--> statement-breakpoint
ALTER TABLE "agents"
  ALTER COLUMN "role_embedding" TYPE halfvec(2560)
  USING NULL::halfvec(2560);
--> statement-breakpoint
CREATE INDEX "idx_agents_role_embedding" ON "agents" USING hnsw ("role_embedding" halfvec_cosine_ops);
