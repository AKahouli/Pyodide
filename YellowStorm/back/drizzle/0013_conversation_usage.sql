CREATE TABLE "conversation"."usage_windows" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"window_hours" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"plan_id" varchar(100),
	"plan_slug" varchar(50),
	"token_limit_at_creation" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_windows_id_object_id" CHECK ("conversation"."usage_windows"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "usage_windows_window_hours_positive" CHECK ("conversation"."usage_windows"."window_hours" > 0),
	CONSTRAINT "usage_windows_counts_non_negative" CHECK ("conversation"."usage_windows"."input_tokens" >= 0 AND "conversation"."usage_windows"."output_tokens" >= 0 AND "conversation"."usage_windows"."total_tokens" >= 0 AND "conversation"."usage_windows"."request_count" >= 0),
	CONSTRAINT "usage_windows_valid_range" CHECK ("conversation"."usage_windows"."window_end" > "conversation"."usage_windows"."window_start")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_usage_windows_user_window" ON "conversation"."usage_windows" USING btree ("user_id","window_start","window_end");
--> statement-breakpoint
CREATE INDEX "idx_usage_windows_user_end" ON "conversation"."usage_windows" USING btree ("user_id","window_end" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "idx_usage_windows_start_plan" ON "conversation"."usage_windows" USING btree ("window_start","plan_slug");
--> statement-breakpoint
CREATE TABLE "conversation"."usage_logs" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"usage_type" varchar(20) DEFAULT 'chat' NOT NULL,
	"model_name" varchar(100),
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"duration_ms" integer,
	"conversation_id" varchar(100),
	"endpoint" varchar(200),
	"ip_address" varchar(45),
	"user_agent" varchar(500),
	"success" boolean DEFAULT true NOT NULL,
	"error_code" varchar(50),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_logs_id_object_id" CHECK ("conversation"."usage_logs"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "usage_logs_type" CHECK ("conversation"."usage_logs"."usage_type" IN ('chat', 'completion', 'embedding', 'playbook', 'other')),
	CONSTRAINT "usage_logs_metrics_non_negative" CHECK ("conversation"."usage_logs"."input_tokens" >= 0 AND "conversation"."usage_logs"."output_tokens" >= 0 AND "conversation"."usage_logs"."total_tokens" >= 0 AND COALESCE("conversation"."usage_logs"."duration_ms", 0) >= 0)
);
--> statement-breakpoint
CREATE INDEX "idx_usage_logs_user_created" ON "conversation"."usage_logs" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "idx_usage_logs_type_model_created" ON "conversation"."usage_logs" USING btree ("usage_type","model_name","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "idx_usage_logs_created" ON "conversation"."usage_logs" USING btree ("created_at" DESC NULLS LAST);
