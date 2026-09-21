ALTER TABLE "app_data"."apps"
  ADD COLUMN IF NOT EXISTS "jwt_secret" varchar(128),
  ADD COLUMN IF NOT EXISTS "end_user_auth_enabled" boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "app_data"."end_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "email" varchar(320) NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "display_name" varchar(128),
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "chk_app_data_end_users_status" CHECK ("status" IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_end_users_app_email"
  ON "app_data"."end_users" ("app_id", "email");
CREATE INDEX IF NOT EXISTS "idx_app_data_end_users_app"
  ON "app_data"."end_users" ("app_id");

CREATE TABLE IF NOT EXISTS "app_data"."end_user_grants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "app_data"."apps"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "app_data"."end_users"("id") ON DELETE cascade,
  "can_create" boolean DEFAULT false NOT NULL,
  "can_read" boolean DEFAULT false NOT NULL,
  "can_update" boolean DEFAULT false NOT NULL,
  "can_delete" boolean DEFAULT false NOT NULL,
  "can_use_ai" boolean DEFAULT false NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_app_data_end_user_grants_app_user"
  ON "app_data"."end_user_grants" ("app_id", "user_id");