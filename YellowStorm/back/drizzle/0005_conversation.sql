CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
CREATE SCHEMA "conversation";
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_group_invites" (
	"conversation_id" char(24) NOT NULL,
	"position" integer NOT NULL,
	"email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"status" varchar(20) NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"job" text,
	CONSTRAINT "conversation_group_invites_conversation_id_position_pk" PRIMARY KEY("conversation_id","position"),
	CONSTRAINT "conversation_group_invites_status" CHECK ("conversation"."conversation_group_invites"."status" IN ('Confirmed', 'Guest'))
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_group_members" (
	"conversation_id" char(24) NOT NULL,
	"user_id" char(24) NOT NULL,
	"position" integer NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"status" varchar(20) NOT NULL,
	"job" text,
	CONSTRAINT "conversation_group_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "conversation_group_members_status" CHECK ("conversation"."conversation_group_members"."status" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_group_tagged_agents" (
	"conversation_id" char(24) NOT NULL,
	"position" integer NOT NULL,
	"agent_id" char(24) NOT NULL,
	CONSTRAINT "conversation_group_tagged_agents_conversation_id_position_pk" PRIMARY KEY("conversation_id","position"),
	CONSTRAINT "conversation_group_tagged_agents_position_non_negative" CHECK ("conversation"."conversation_group_tagged_agents"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_member_mentions" (
	"conversation_id" char(24) NOT NULL,
	"user_id" char(24) NOT NULL,
	"position" integer NOT NULL,
	"message_id" char(24) NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "conversation_member_mentions_conversation_id_user_id_position_pk" PRIMARY KEY("conversation_id","user_id","position")
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_playbook_handoffs" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"handoff_id" uuid NOT NULL,
	"contract_version" integer NOT NULL,
	"owner_id" char(24) NOT NULL,
	"source_conversation_id" char(24) NOT NULL,
	"target_message_id" char(24) NOT NULL,
	"displayed_answer_version" text NOT NULL,
	"creation_request_id" text NOT NULL,
	"creation_request_fingerprint" text NOT NULL,
	"client_branch_selection_fingerprint" text NOT NULL,
	"canonical_path_fingerprint" text NOT NULL,
	"context_fingerprint" text NOT NULL,
	"canonical_selected_answer_ids" varchar(24)[] NOT NULL,
	"platform_conversation_id" char(24) NOT NULL,
	"context" jsonb NOT NULL,
	"candidate_bindings" jsonb NOT NULL,
	"default_workspace_ids" varchar(24)[] NOT NULL,
	"status" varchar(20) DEFAULT 'prepared' NOT NULL,
	"bound_turn_request_id" text,
	"bound_prompt_hash" text,
	"bound_user_message_id" char(24),
	"assistant_request_id" text,
	"prepared_at" timestamp with time zone NOT NULL,
	"bound_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_playbook_handoffs_id_object_id" CHECK ("conversation"."conversation_playbook_handoffs"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "conversation_playbook_handoffs_contract" CHECK ("conversation"."conversation_playbook_handoffs"."contract_version" = 1),
	CONSTRAINT "conversation_playbook_handoffs_status" CHECK ("conversation"."conversation_playbook_handoffs"."status" IN ('prepared', 'bound', 'consumed'))
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_selected_skills" (
	"conversation_id" char(24) NOT NULL,
	"position" integer NOT NULL,
	"skill_id" char(24) NOT NULL,
	CONSTRAINT "conversation_selected_skills_conversation_id_position_pk" PRIMARY KEY("conversation_id","position"),
	CONSTRAINT "conversation_selected_skills_position_non_negative" CHECK ("conversation"."conversation_selected_skills"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_tagged_agents" (
	"conversation_id" char(24) NOT NULL,
	"position" integer NOT NULL,
	"agent_id" char(24) NOT NULL,
	CONSTRAINT "conversation_tagged_agents_conversation_id_position_pk" PRIMARY KEY("conversation_id","position"),
	CONSTRAINT "conversation_tagged_agents_position_non_negative" CHECK ("conversation"."conversation_tagged_agents"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversation_workspaces" (
	"conversation_id" char(24) NOT NULL,
	"position" integer NOT NULL,
	"workspace_id" char(24) NOT NULL,
	CONSTRAINT "conversation_workspaces_conversation_id_position_pk" PRIMARY KEY("conversation_id","position"),
	CONSTRAINT "conversation_workspaces_position_non_negative" CHECK ("conversation"."conversation_workspaces"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation"."conversations" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"runtime_mode" varchar(20) DEFAULT 'standard' NOT NULL,
	"runtime_purpose" varchar(30) DEFAULT 'chat' NOT NULL,
	"pinned_agent_id" char(24),
	"platform_copilot_creation_request_id" text,
	"governed_creation_request_id" text,
	"title" varchar(200) DEFAULT 'New Conversation' NOT NULL,
	"created_by" char(24) NOT NULL,
	"system_workspace_id" char(24),
	"project_id" char(24),
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"shared_from" char(24),
	"initialization_status" varchar(30) DEFAULT 'ready' NOT NULL,
	"branch_seed_attempt_id" text,
	"branch_request_id" text,
	"branch_provenance" jsonb,
	"governance_context" jsonb,
	"is_group" boolean DEFAULT false NOT NULL,
	"is_first_message" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_object_id" CHECK ("conversation"."conversations"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "conversations_runtime_mode" CHECK ("conversation"."conversations"."runtime_mode" IN ('standard', 'governed')),
	CONSTRAINT "conversations_runtime_purpose" CHECK ("conversation"."conversations"."runtime_purpose" IN ('chat', 'platform_copilot')),
	CONSTRAINT "conversations_initialization_status" CHECK ("conversation"."conversations"."initialization_status" IN ('ready', 'pending', 'seeding', 'cleanup_pending')),
	CONSTRAINT "conversations_message_count_non_negative" CHECK ("conversation"."conversations"."message_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation"."messages" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"conversation_id" char(24) NOT NULL,
	"sender_id" char(24),
	"parent_message_id" char(24),
	"conversation_type" varchar(10) NOT NULL,
	"content" text,
	"components" jsonb,
	"attached_file_ids" varchar(24)[],
	"agent_ids" varchar(24)[],
	"member_ids" varchar(24)[],
	"model_id" varchar(100),
	"reasoning_effort" varchar(50),
	"web_search_enabled" boolean DEFAULT false NOT NULL,
	"question_message_id" char(24),
	"answer_message_id" char(24),
	"feedback" varchar(10),
	"feedback_at" timestamp with time zone,
	"is_edited" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp with time zone,
	"is_streaming" boolean DEFAULT false NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"stream_execution_lease_id" text,
	"stream_execution_lease_expires_at" timestamp with time zone,
	"input_tokens" integer,
	"output_tokens" integer,
	"model_request_telemetry" jsonb,
	"duration_ms" integer,
	"time_to_first_chunk" integer,
	"time_to_first_token" integer,
	"request_id" text,
	"guardrail_decision" jsonb,
	"interaction" jsonb,
	"interactions" jsonb,
	"replay_context" jsonb,
	"reliability_evaluation" jsonb,
	"correction_workflow" jsonb,
	"reliability_evaluation_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_object_id" CHECK ("conversation"."messages"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "messages_conversation_type" CHECK ("conversation"."messages"."conversation_type" IN ('user', 'ai')),
	CONSTRAINT "messages_feedback" CHECK ("conversation"."messages"."feedback" IS NULL OR "conversation"."messages"."feedback" IN ('like', 'dislike')),
	CONSTRAINT "messages_content_length" CHECK ("conversation"."messages"."content" IS NULL OR char_length("conversation"."messages"."content") <= 50000),
	CONSTRAINT "messages_metrics_non_negative" CHECK (COALESCE("conversation"."messages"."input_tokens", 0) >= 0 AND COALESCE("conversation"."messages"."output_tokens", 0) >= 0 AND COALESCE("conversation"."messages"."duration_ms", 0) >= 0 AND COALESCE("conversation"."messages"."time_to_first_chunk", 0) >= 0 AND COALESCE("conversation"."messages"."time_to_first_token", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation"."reports" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"conversation_id" char(24) NOT NULL,
	"message_id" char(24) NOT NULL,
	"user_id" char(24) NOT NULL,
	"reason" varchar(40) NOT NULL,
	"description" varchar(2000) NOT NULL,
	"source" varchar(30) DEFAULT 'user' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"admin_notes" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_id_object_id" CHECK ("conversation"."reports"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "reports_reason" CHECK ("conversation"."reports"."reason" IN ('inaccurate', 'wrong_information', 'offensive', 'out_of_context', 'hallucination', 'other')),
	CONSTRAINT "reports_source" CHECK ("conversation"."reports"."source" IN ('user', 'system_correction')),
	CONSTRAINT "reports_status" CHECK ("conversation"."reports"."status" IN ('pending', 'reviewed', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "conversation"."shared_conversations" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"original_conversation_id" char(24) NOT NULL,
	"shared_by" char(24) NOT NULL,
	"share_type" varchar(10) NOT NULL,
	"title" varchar(200) NOT NULL,
	"messages" jsonb,
	"access_token" text,
	"recipient_emails" text[],
	"forked_conversation_ids" varchar(24)[],
	"expires_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_conversations_id_object_id" CHECK ("conversation"."shared_conversations"."id" ~ '^[0-9a-f]{24}$'),
	CONSTRAINT "shared_conversations_type" CHECK ("conversation"."shared_conversations"."share_type" IN ('public', 'private')),
	CONSTRAINT "shared_conversations_view_count_non_negative" CHECK ("conversation"."shared_conversations"."view_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "conversation"."conversation_group_invites" ADD CONSTRAINT "conversation_group_invites_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_group_members" ADD CONSTRAINT "conversation_group_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_group_tagged_agents" ADD CONSTRAINT "conversation_group_tagged_agents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_member_mentions" ADD CONSTRAINT "conversation_member_mentions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_member_mentions" ADD CONSTRAINT "conversation_member_mentions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "conversation"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_selected_skills" ADD CONSTRAINT "conversation_selected_skills_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_tagged_agents" ADD CONSTRAINT "conversation_tagged_agents_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."conversation_workspaces" ADD CONSTRAINT "conversation_workspaces_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD CONSTRAINT "messages_parent_message_id_messages_id_fk" FOREIGN KEY ("parent_message_id") REFERENCES "conversation"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD CONSTRAINT "messages_question_message_id_messages_id_fk" FOREIGN KEY ("question_message_id") REFERENCES "conversation"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."messages" ADD CONSTRAINT "messages_answer_message_id_messages_id_fk" FOREIGN KEY ("answer_message_id") REFERENCES "conversation"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation"."shared_conversations" ADD CONSTRAINT "shared_conversations_original_conversation_id_conversations_id_fk" FOREIGN KEY ("original_conversation_id") REFERENCES "conversation"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversation_group_invites_email" ON "conversation"."conversation_group_invites" USING btree ("normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversation_group_members_position" ON "conversation"."conversation_group_members" USING btree ("conversation_id","position");--> statement-breakpoint
CREATE INDEX "idx_conversation_group_tagged_agents_agent_id" ON "conversation"."conversation_group_tagged_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_member_mentions_message" ON "conversation"."conversation_member_mentions" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversation_playbook_handoffs_handoff_id" ON "conversation"."conversation_playbook_handoffs" USING btree ("handoff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversation_playbook_handoffs_owner_request" ON "conversation"."conversation_playbook_handoffs" USING btree ("owner_id","creation_request_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_playbook_handoffs_platform_status" ON "conversation"."conversation_playbook_handoffs" USING btree ("owner_id","platform_conversation_id","status");--> statement-breakpoint
CREATE INDEX "idx_conversation_playbook_handoffs_expires" ON "conversation"."conversation_playbook_handoffs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_selected_skills_skill_id" ON "conversation"."conversation_selected_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_tagged_agents_agent_id" ON "conversation"."conversation_tagged_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_workspaces_workspace_id" ON "conversation"."conversation_workspaces" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_owner_last_message" ON "conversation"."conversations" USING btree ("created_by","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_owner_archived_last_message" ON "conversation"."conversations" USING btree ("created_by","is_archived","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_owner_created" ON "conversation"."conversations" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_owner_project_last_message" ON "conversation"."conversations" USING btree ("created_by","project_id","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_conversations_runtime_purpose" ON "conversation"."conversations" USING btree ("runtime_purpose");--> statement-breakpoint
CREATE INDEX "idx_conversations_initialization_status" ON "conversation"."conversations" USING btree ("initialization_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversations_platform_creation_request" ON "conversation"."conversations" USING btree ("created_by","platform_copilot_creation_request_id") WHERE "conversation"."conversations"."platform_copilot_creation_request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversations_governed_creation_request" ON "conversation"."conversations" USING btree ("created_by","governed_creation_request_id") WHERE "conversation"."conversations"."governed_creation_request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_conversations_branch_request" ON "conversation"."conversations" USING btree ("created_by","branch_request_id") WHERE "conversation"."conversations"."branch_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_conversations_title_trgm" ON "conversation"."conversations" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_created" ON "conversation"."messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_type" ON "conversation"."messages" USING btree ("conversation_id","conversation_type");--> statement-breakpoint
CREATE INDEX "idx_messages_question_type_created" ON "conversation"."messages" USING btree ("question_message_id","conversation_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_messages_streaming_updated" ON "conversation"."messages" USING btree ("is_streaming","updated_at");--> statement-breakpoint
CREATE INDEX "idx_messages_reliability_heartbeat" ON "conversation"."messages" USING btree ("reliability_evaluation_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_messages_request_identity" ON "conversation"."messages" USING btree ("conversation_id","sender_id","conversation_type","request_id") WHERE "conversation"."messages"."request_id" IS NOT NULL AND "conversation"."messages"."sender_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_messages_content_trgm" ON "conversation"."messages" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reports_user_message" ON "conversation"."reports" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reports_system_correction" ON "conversation"."reports" USING btree ("message_id","source") WHERE "conversation"."reports"."source" = 'system_correction';--> statement-breakpoint
CREATE INDEX "idx_reports_status_created" ON "conversation"."reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_reports_conversation" ON "conversation"."reports" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shared_conversations_access_token" ON "conversation"."shared_conversations" USING btree ("access_token") WHERE "conversation"."shared_conversations"."access_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_shared_conversations_owner_created" ON "conversation"."shared_conversations" USING btree ("shared_by","created_at");--> statement-breakpoint
CREATE INDEX "idx_shared_conversations_expires" ON "conversation"."shared_conversations" USING btree ("expires_at");
