ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint
ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN "token_usage" jsonb;