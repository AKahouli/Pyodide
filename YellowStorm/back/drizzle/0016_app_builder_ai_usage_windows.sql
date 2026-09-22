CREATE TABLE "conversation"."app_builder_ai_usage_windows" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"window_hours" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"offer_id" varchar(100),
	"offer_slug" varchar(50),
	"token_limit_at_creation" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ab_ai_usage_windows_id_object_id" CHECK ("conversation"."app_builder_ai_usage_windows"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "ab_ai_usage_windows_window_hours_positive" CHECK ("conversation"."app_builder_ai_usage_windows"."window_hours" > 0),
	CONSTRAINT "ab_ai_usage_windows_counts_non_negative" CHECK ("conversation"."app_builder_ai_usage_windows"."input_tokens" >= 0 AND "conversation"."app_builder_ai_usage_windows"."output_tokens" >= 0 AND "conversation"."app_builder_ai_usage_windows"."total_tokens" >= 0 AND "conversation"."app_builder_ai_usage_windows"."request_count" >= 0),
	CONSTRAINT "ab_ai_usage_windows_valid_range" CHECK ("conversation"."app_builder_ai_usage_windows"."window_end" > "conversation"."app_builder_ai_usage_windows"."window_start")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ab_ai_usage_windows_user_window" ON "conversation"."app_builder_ai_usage_windows" USING btree ("user_id","window_start","window_end");
--> statement-breakpoint
CREATE INDEX "idx_ab_ai_usage_windows_user_end" ON "conversation"."app_builder_ai_usage_windows" USING btree ("user_id","window_end" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "idx_ab_ai_usage_windows_start_offer" ON "conversation"."app_builder_ai_usage_windows" USING btree ("window_start","offer_slug");
