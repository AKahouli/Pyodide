CREATE TABLE "logical_search_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" char(24) NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(30) DEFAULT 'dataset_ready' NOT NULL,
	"source_file_name" varchar(300) NOT NULL,
	"query_count" integer DEFAULT 0 NOT NULL,
	"queries" jsonb DEFAULT '{"queries": []}'::jsonb NOT NULL,
	"agent_id" char(24),
	"flow_id" char(24),
	"workspace_id" char(24),
	"execution_id" char(24),
	"answer_node_id" varchar(64),
	"summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lse_status_values" CHECK ("logical_search_evaluations"."status" IN ('dataset_ready', 'prepared', 'running', 'completed', 'failed')),
	CONSTRAINT "lse_query_count_non_negative" CHECK ("logical_search_evaluations"."query_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_lse_owner_created" ON "logical_search_evaluations" USING btree ("owner_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_lse_status" ON "logical_search_evaluations" USING btree ("status");
