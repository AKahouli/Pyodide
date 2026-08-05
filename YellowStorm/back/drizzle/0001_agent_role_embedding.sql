CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "role_embedding" halfvec(3072);
--> statement-breakpoint
CREATE INDEX "idx_agents_role_embedding" ON "agents" USING hnsw ("role_embedding" halfvec_cosine_ops);
