CREATE SCHEMA "evaluation";

ALTER TABLE "logical_search_evaluations" SET SCHEMA "evaluation";
ALTER TABLE "evaluation"."logical_search_evaluations" RENAME TO "evaluation";

CREATE TABLE "evaluation"."evaluation_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"evaluation_id" uuid NOT NULL REFERENCES "evaluation"."evaluation"("id") ON DELETE cascade ON UPDATE no action,
	"query_id" varchar(64) NOT NULL,
	"query" text NOT NULL,
	"expected_answer" text NOT NULL,
	"generated_answer" text NOT NULL DEFAULT '',
	"status" varchar(30) NOT NULL,
	"duration_ms" integer,
	"target_duration_ms" integer,
	"judge_duration_ms" integer,
	"judge_score" double precision,
	"judge_faithfulness_score" double precision,
	"judge_reasoning" text,
	"retrieved_files" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lser_status_values" CHECK ("evaluation_result"."status" IN ('completed', 'failed'))
);
CREATE UNIQUE INDEX "idx_lser_evaluation_query" ON "evaluation"."evaluation_result" USING btree ("evaluation_id","query_id");
CREATE INDEX "idx_lser_evaluation" ON "evaluation"."evaluation_result" USING btree ("evaluation_id");