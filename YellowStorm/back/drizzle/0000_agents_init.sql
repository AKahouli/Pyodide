CREATE TABLE "agent_connector_actions" (
	"agent_id" char(24) NOT NULL,
	"connector_id" char(24) NOT NULL,
	"action_keys" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "agent_connector_actions_agent_id_connector_id_pk" PRIMARY KEY("agent_id","connector_id")
);
--> statement-breakpoint
CREATE TABLE "agent_connectors" (
	"agent_id" char(24) NOT NULL,
	"connector_id" char(24) NOT NULL,
	CONSTRAINT "agent_connectors_agent_id_connector_id_pk" PRIMARY KEY("agent_id","connector_id")
);
--> statement-breakpoint
CREATE TABLE "agent_disabled_skills" (
	"agent_id" char(24) NOT NULL,
	"skill_id" char(24) NOT NULL,
	CONSTRAINT "agent_disabled_skills_agent_id_skill_id_pk" PRIMARY KEY("agent_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "agent_knowledge_bases" (
	"agent_id" char(24) NOT NULL,
	"workspace_id" char(24) NOT NULL,
	CONSTRAINT "agent_knowledge_bases_agent_id_workspace_id_pk" PRIMARY KEY("agent_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"agent_id" char(24) NOT NULL,
	"skill_id" char(24) NOT NULL,
	CONSTRAINT "agent_skills_agent_id_skill_id_pk" PRIMARY KEY("agent_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "agent_tools" (
	"agent_id" char(24) NOT NULL,
	"tool_id" char(24) NOT NULL,
	CONSTRAINT "agent_tools_agent_id_tool_id_pk" PRIMARY KEY("agent_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" char(24) PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"slug" varchar(100) DEFAULT '' NOT NULL,
	"role" text NOT NULL,
	"description" varchar(1000) DEFAULT '' NOT NULL,
	"temperature" real DEFAULT 0 NOT NULL,
	"llm_model" varchar(100),
	"email" varchar(320),
	"instruction" text DEFAULT '' NOT NULL,
	"ignore_pre_prompt" boolean DEFAULT false NOT NULL,
	"agent_type_id" char(24) NOT NULL,
	"agent_type_slug" varchar(100) DEFAULT '' NOT NULL,
	"enable_temporary_child_agents" boolean DEFAULT false NOT NULL,
	"max_temporary_child_agents" smallint DEFAULT 4 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default_for_type" boolean DEFAULT false NOT NULL,
	"created_by" char(24) NOT NULL,
	"guardrails" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deployment_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"a2a_published" boolean DEFAULT false NOT NULL,
	"a2a_agent_id" text,
	"a2a_agent_card_url" text,
	"a2a_api_key_header" text,
	"a2a_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_temperature_range" CHECK ("agents"."temperature" >= 0 AND "agents"."temperature" <= 1),
	CONSTRAINT "agents_max_children_range" CHECK ("agents"."max_temporary_child_agents" BETWEEN 1 AND 8)
);
--> statement-breakpoint
ALTER TABLE "agent_connector_actions" ADD CONSTRAINT "agent_connector_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_connectors" ADD CONSTRAINT "agent_connectors_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_disabled_skills" ADD CONSTRAINT "agent_disabled_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_knowledge_bases" ADD CONSTRAINT "agent_knowledge_bases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tools" ADD CONSTRAINT "agent_tools_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_connector_actions_connector_id" ON "agent_connector_actions" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "idx_agent_connectors_connector_id" ON "agent_connectors" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "idx_agent_disabled_skills_skill_id" ON "agent_disabled_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "idx_agent_knowledge_bases_workspace_id" ON "agent_knowledge_bases" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_agent_skills_skill_id" ON "agent_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "idx_agent_tools_tool_id" ON "agent_tools" USING btree ("tool_id");--> statement-breakpoint
CREATE INDEX "idx_agents_created_by_is_active" ON "agents" USING btree ("created_by","is_active");--> statement-breakpoint
CREATE INDEX "idx_agents_is_default_is_active" ON "agents" USING btree ("is_default","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agents_name_created_by" ON "agents" USING btree ("name","created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agents_created_by_slug_non_default" ON "agents" USING btree ("created_by","slug") WHERE "agents"."is_default" = false AND "agents"."slug" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agents_slug_default" ON "agents" USING btree ("slug","is_default") WHERE "agents"."is_default" = true AND "agents"."slug" <> '';--> statement-breakpoint
CREATE INDEX "idx_agents_type_created_by_default_for_type" ON "agents" USING btree ("agent_type_id","created_by","is_default_for_type");--> statement-breakpoint
CREATE INDEX "idx_agents_type_is_default_default_for_type" ON "agents" USING btree ("agent_type_id","is_default","is_default_for_type");--> statement-breakpoint
CREATE INDEX "idx_agents_agent_type_slug" ON "agents" USING btree ("agent_type_slug");--> statement-breakpoint
CREATE INDEX "idx_agents_is_active" ON "agents" USING btree ("is_active");