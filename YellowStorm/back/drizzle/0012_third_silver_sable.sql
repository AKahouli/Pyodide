CREATE SCHEMA "app_data";
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_executions" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"conversation_id" char(24) NOT NULL,
	"user_id" char(24) NOT NULL,
	"message_id" char(24) NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"owner_replica_id" text,
	"cancel_requested_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"expires_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_executions_id_object_id" CHECK ("conversation"."conversation_executions"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "conversation_executions_status" CHECK ("conversation"."conversation_executions"."status" IN ('running', 'cancelled', 'completed', 'failed', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "app_data"."apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_data_id" varchar(32) NOT NULL,
	"workspace_id" varchar(128) NOT NULL,
	"owner_user_id" varchar(24) NOT NULL,
	"jwt_secret" varchar(128),
	"end_user_auth_enabled" boolean DEFAULT false NOT NULL,
	"lifecycle_state" varchar(32) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_app_data_apps_lifecycle" CHECK ("app_data"."apps"."lifecycle_state" IN ('active', 'archived', 'purge_pending', 'purged'))
);
--> statement-breakpoint
CREATE TABLE "app_data"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"actor_principal" varchar(64) NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_data"."end_user_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_update" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_data"."end_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"display_name" varchar(128),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_app_data_end_users_status" CHECK ("app_data"."end_users"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "app_data"."environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"environment" varchar(8) NOT NULL,
	"schema_name" varchar(128) NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_app_data_env_environment" CHECK ("app_data"."environments"."environment" IN ('dev', 'prod'))
);
--> statement-breakpoint
CREATE TABLE "app_data"."migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"environment" varchar(8) NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"plan_json" jsonb NOT NULL,
	"classification" varchar(16) NOT NULL,
	"tool_call_id" varchar(128),
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_app_data_migrations_classification" CHECK ("app_data"."migrations"."classification" IN ('safe', 'destructive'))
);
--> statement-breakpoint
CREATE TABLE "app_data"."policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"environment" varchar(8) NOT NULL,
	"table_name" varchar(63) NOT NULL,
	"policy_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_data"."release_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" varchar(128) NOT NULL,
	"revision_id" varchar(128) NOT NULL,
	"app_id" uuid NOT NULL,
	"required_schema_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_data"."schema_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"environment" varchar(8) NOT NULL,
	"version" integer NOT NULL,
	"manifest_hash" varchar(64) NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
DROP INDEX "conversation"."idx_conversation_group_invites_email";--> statement-breakpoint
DROP INDEX "conversation"."idx_conversation_playbook_handoffs_expires";--> statement-breakpoint
DROP INDEX "conversation"."idx_conversations_owner_last_message";--> statement-breakpoint
DROP INDEX "conversation"."idx_conversations_owner_created";--> statement-breakpoint
DROP INDEX "conversation"."idx_conversations_owner_project_last_message";--> statement-breakpoint
DROP INDEX "conversation"."idx_conversations_runtime_purpose";--> statement-breakpoint
DROP INDEX "conversation"."idx_conversations_initialization_status";--> statement-breakpoint
DROP INDEX "conversation"."idx_messages_conversation_created";--> statement-breakpoint
DROP INDEX "conversation"."idx_messages_conversation_type";--> statement-breakpoint
DROP INDEX "conversation"."idx_messages_question_type_created";--> statement-breakpoint
DROP INDEX "conversation"."idx_messages_streaming_updated";--> statement-breakpoint
DROP INDEX "conversation"."idx_messages_reliability_heartbeat";--> statement-breakpoint
DROP INDEX "conversation"."idx_reports_status_created";--> statement-breakpoint
DROP INDEX "conversation"."idx_shared_conversations_expires";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "reasoning_effort" varchar(50);--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "execution_status" varchar(20);--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "execution_attempt_id" text;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "execution_owner_replica_id" text;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "execution_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "last_progress_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "execution_terminal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "interruption_reason" text;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD COLUMN "latency_metrics" jsonb;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_executions" ADD CONSTRAINT "conversation_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."audit_events" ADD CONSTRAINT "audit_events_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."end_user_grants" ADD CONSTRAINT "end_user_grants_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."end_user_grants" ADD CONSTRAINT "end_user_grants_user_id_end_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_data"."end_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."end_users" ADD CONSTRAINT "end_users_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."environments" ADD CONSTRAINT "environments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."migrations" ADD CONSTRAINT "migrations_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."policies" ADD CONSTRAINT "policies_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."release_bindings" ADD CONSTRAINT "release_bindings_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_data"."schema_versions" ADD CONSTRAINT "schema_versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "app_data"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversation_executions_running_conversation" ON "conversation"."conversation_executions" USING btree ("conversation_id") WHERE "conversation"."conversation_executions"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversation_executions_message" ON "conversation"."conversation_executions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_executions_user_running" ON "conversation"."conversation_executions" USING btree ("user_id","id") WHERE "conversation"."conversation_executions"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_apps_app_data_id" ON "app_data"."apps" USING btree ("app_data_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_apps_workspace_id" ON "app_data"."apps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_app_data_apps_owner" ON "app_data"."apps" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_app_data_audit_app_created" ON "app_data"."audit_events" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_end_user_grants_app_user" ON "app_data"."end_user_grants" USING btree ("app_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_end_users_app_email" ON "app_data"."end_users" USING btree ("app_id","email");--> statement-breakpoint
CREATE INDEX "idx_app_data_end_users_app" ON "app_data"."end_users" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_env_app_env" ON "app_data"."environments" USING btree ("app_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_env_schema_name" ON "app_data"."environments" USING btree ("schema_name");--> statement-breakpoint
CREATE INDEX "idx_app_data_migrations_app" ON "app_data"."migrations" USING btree ("app_id","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_policies_table" ON "app_data"."policies" USING btree ("app_id","environment","table_name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_release_binding" ON "app_data"."release_bindings" USING btree ("workspace_id","revision_id");--> statement-breakpoint
CREATE INDEX "idx_app_data_release_bindings_app" ON "app_data"."release_bindings" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_app_data_schema_version" ON "app_data"."schema_versions" USING btree ("app_id","environment","version");--> statement-breakpoint
CREATE INDEX "idx_app_data_schema_versions_app" ON "app_data"."schema_versions" USING btree ("app_id","environment");--> statement-breakpoint
CREATE INDEX "idx_lse_owner_created" ON "logical_search_evaluations" USING btree ("owner_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_lse_status" ON "logical_search_evaluations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_group_invites_conversation_email" ON "conversation"."conversation_group_invites" USING btree ("conversation_id","normalized_email");--> statement-breakpoint
CREATE INDEX "idx_group_members_user_conversation" ON "conversation"."conversation_group_members" USING btree ("user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "idx_mentions_user_unseen_conversation" ON "conversation"."conversation_member_mentions" USING btree ("user_id","conversation_id") WHERE "conversation"."conversation_member_mentions"."seen_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_handoffs_expires_v2" ON "conversation"."conversation_playbook_handoffs" USING btree ("expires_at","id");--> statement-breakpoint
CREATE INDEX "idx_conv_owner_ready_last_v2" ON "conversation"."conversations" USING btree ("created_by","last_message_at" DESC NULLS LAST,"id" DESC) WHERE "conversation"."conversations"."initialization_status" = 'ready' AND "conversation"."conversations"."runtime_purpose" <> 'platform_copilot';--> statement-breakpoint
CREATE INDEX "idx_conv_owner_ready_created_v2" ON "conversation"."conversations" USING btree ("created_by","created_at" DESC,"id" DESC) WHERE "conversation"."conversations"."initialization_status" = 'ready' AND "conversation"."conversations"."runtime_purpose" <> 'platform_copilot';--> statement-breakpoint
CREATE INDEX "idx_conv_owner_ready_title_v2" ON "conversation"."conversations" USING btree ("created_by","title","id") WHERE "conversation"."conversations"."initialization_status" = 'ready' AND "conversation"."conversations"."runtime_purpose" <> 'platform_copilot';--> statement-breakpoint
CREATE INDEX "idx_conv_owner_project_last_v2" ON "conversation"."conversations" USING btree ("created_by","project_id","last_message_at" DESC NULLS LAST,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_conv_platform_owner_last_v2" ON "conversation"."conversations" USING btree ("created_by","last_message_at" DESC NULLS LAST,"created_at" DESC,"id" DESC) WHERE "conversation"."conversations"."runtime_purpose" = 'platform_copilot';--> statement-breakpoint
CREATE INDEX "idx_conv_platform_agent_last_v2" ON "conversation"."conversations" USING btree ("created_by","pinned_agent_id","last_message_at" DESC NULLS LAST,"created_at" DESC,"id" DESC) WHERE "conversation"."conversations"."runtime_purpose" = 'platform_copilot';--> statement-breakpoint
CREATE INDEX "idx_conv_initializing_updated_v2" ON "conversation"."conversations" USING btree ("updated_at","id") WHERE "conversation"."conversations"."initialization_status" IN ('pending', 'seeding', 'cleanup_pending');--> statement-breakpoint
CREATE INDEX "idx_conv_orphan_created_v2" ON "conversation"."conversations" USING btree ("created_at","id") WHERE "conversation"."conversations"."message_count" = 0 AND "conversation"."conversations"."is_first_message" = true AND "conversation"."conversations"."is_shared" = false;--> statement-breakpoint
CREATE INDEX "idx_messages_conv_created_v2" ON "conversation"."messages" USING btree ("conversation_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_messages_conv_type_created_v2" ON "conversation"."messages" USING btree ("conversation_id","conversation_type","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_messages_ai_question_created_v2" ON "conversation"."messages" USING btree ("question_message_id","created_at","id") WHERE "conversation"."messages"."conversation_type" = 'ai';--> statement-breakpoint
CREATE INDEX "idx_messages_streaming_updated_v2" ON "conversation"."messages" USING btree ("updated_at","id") WHERE "conversation"."messages"."is_streaming" = true;--> statement-breakpoint
CREATE INDEX "idx_messages_streaming_lease_expiry_v2" ON "conversation"."messages" USING btree ("stream_execution_lease_expires_at","id") WHERE "conversation"."messages"."is_streaming" = true;--> statement-breakpoint
CREATE INDEX "idx_messages_pending_reliability_v2" ON "conversation"."messages" USING btree ("reliability_evaluation_heartbeat_at","id") WHERE "conversation"."messages"."reliability_evaluation"->>'status' = 'pending';--> statement-breakpoint
CREATE INDEX "idx_reports_created_v2" ON "conversation"."reports" USING btree ("created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_reports_status_created_v2" ON "conversation"."reports" USING btree ("status","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_reports_reason_created_v2" ON "conversation"."reports" USING btree ("reason","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_shared_original_created_v2" ON "conversation"."shared_conversations" USING btree ("original_conversation_id","created_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "idx_shared_expires_v2" ON "conversation"."shared_conversations" USING btree ("expires_at","id") WHERE "conversation"."shared_conversations"."expires_at" IS NOT NULL;