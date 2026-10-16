-- Evaluation results: split token usage per node (eval-target vs eval-judge).
SET LOCAL lock_timeout = '5s';

ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN IF NOT EXISTS "target_prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN IF NOT EXISTS "target_completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN IF NOT EXISTS "target_total_tokens" integer;--> statement-breakpoint
ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN IF NOT EXISTS "judge_prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN IF NOT EXISTS "judge_completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN IF NOT EXISTS "judge_total_tokens" integer;--> statement-breakpoint
ALTER TABLE "evaluation"."evaluation_result" ADD COLUMN IF NOT EXISTS "global_total_tokens" integer;
