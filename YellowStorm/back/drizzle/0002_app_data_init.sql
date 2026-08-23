CREATE SCHEMA IF NOT EXISTS "app_data";

CREATE TABLE IF NOT EXISTS "app_data"."apps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_data_id" varchar(32) NOT NULL,
  "workspace_id" varchar(128) NOT NULL,
  "owner_user_id" varchar(24) NOT NULL,
  "lifecycle_state" varchar(32) DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chk_app_data_apps_lifecycle" CHECK ("lifecycle_state" IN ('active', 'archived', 'purge_pending', 'purged'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_apps_app_data_id" ON "app_data"."apps" ("app_data_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_apps_workspace_id" ON "app_data"."apps" ("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_app_data_apps_owner" ON "app_data"."apps" ("owner_user_id");

CREATE TABLE IF NOT EXISTS "app_data"."environments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "environment" varchar(8) NOT NULL,
  "schema_name" varchar(128) NOT NULL,
  "current_version" integer DEFAULT 0 NOT NULL,
  "provisioned_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chk_app_data_env_environment" CHECK ("environment" IN ('dev', 'prod'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_env_app_env" ON "app_data"."environments" ("app_id", "environment");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_env_schema_name" ON "app_data"."environments" ("schema_name");

CREATE TABLE IF NOT EXISTS "app_data"."schema_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "environment" varchar(8) NOT NULL,
  "version" integer NOT NULL,
  "manifest_hash" varchar(64) NOT NULL,
  "manifest_json" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_schema_version" ON "app_data"."schema_versions" ("app_id", "environment", "version");
CREATE INDEX IF NOT EXISTS "idx_app_data_schema_versions_app" ON "app_data"."schema_versions" ("app_id", "environment");

CREATE TABLE IF NOT EXISTS "app_data"."migrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "environment" varchar(8) NOT NULL,
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "plan_json" jsonb NOT NULL,
  "classification" varchar(16) NOT NULL,
  "tool_call_id" varchar(128),
  "applied_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chk_app_data_migrations_classification" CHECK ("classification" IN ('safe', 'destructive'))
);

CREATE INDEX IF NOT EXISTS "idx_app_data_migrations_app" ON "app_data"."migrations" ("app_id", "environment");

CREATE TABLE IF NOT EXISTS "app_data"."policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "environment" varchar(8) NOT NULL,
  "table_name" varchar(63) NOT NULL,
  "policy_json" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_policies_table" ON "app_data"."policies" ("app_id", "environment", "table_name");

CREATE TABLE IF NOT EXISTS "app_data"."release_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" varchar(128) NOT NULL,
  "revision_id" varchar(128) NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "required_schema_version" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_release_binding" ON "app_data"."release_bindings" ("workspace_id", "revision_id");
CREATE INDEX IF NOT EXISTS "idx_app_data_release_bindings_app" ON "app_data"."release_bindings" ("app_id");

CREATE TABLE IF NOT EXISTS "app_data"."audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "event_type" varchar(64) NOT NULL,
  "actor_principal" varchar(64) NOT NULL,
  "metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_app_data_audit_app_created" ON "app_data"."audit_events" ("app_id", "created_at");
