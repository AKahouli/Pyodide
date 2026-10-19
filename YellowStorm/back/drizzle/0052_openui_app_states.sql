SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "conversation"."openui_app_states" (
  "actor_id" char(24) NOT NULL,
  "conversation_id" char(24) NOT NULL REFERENCES "conversation"."conversations"("id") ON DELETE CASCADE,
  "source_message_id" char(24) NOT NULL REFERENCES "conversation"."messages"("id") ON DELETE CASCADE,
  "component_id" varchar(128) NOT NULL,
  "program_digest" char(64) NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "library_version" varchar(40) NOT NULL DEFAULT 'yellowstorm-miniapp-v1',
  "state_revision" integer NOT NULL DEFAULT 1,
  "state" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("actor_id", "conversation_id", "source_message_id", "component_id", "program_digest"),
  CONSTRAINT "openui_app_states_actor_id" CHECK ("actor_id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "openui_app_states_program_digest" CHECK ("program_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "openui_app_states_revision" CHECK ("state_revision" > 0),
  CONSTRAINT "openui_app_states_contract" CHECK ("schema_version" = 1 AND "library_version" = 'yellowstorm-miniapp-v1'),
  CONSTRAINT "openui_app_states_json" CHECK (jsonb_typeof("state") = 'object' AND octet_length("state"::text) <= 24576)
);
--> statement-breakpoint
CREATE INDEX "idx_openui_app_states_conversation" ON "conversation"."openui_app_states" ("conversation_id");
--> statement-breakpoint
CREATE INDEX "idx_openui_app_states_message" ON "conversation"."openui_app_states" ("source_message_id");
