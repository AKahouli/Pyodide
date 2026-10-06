import { sql } from 'drizzle-orm';
import {
  char,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const evaluationSchema = pgSchema('evaluation');

/**
 * Logical Search evaluation runs. Persisted in the `evaluation` schema while
 * referenced entities (agent, flow, workspace, execution) stay in Mongo →
 * char(24) ids without cross-DB FKs, like the agents schema.
 */
export const evaluationRuns = evaluationSchema.table(
  'evaluation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: char('owner_id', { length: 24 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    // dataset_ready → prepared → running → completed | failed
    status: varchar('status', { length: 30 }).notNull().default('dataset_ready'),
    sourceFileName: varchar('source_file_name', { length: 300 }).notNull(),
    queryCount: integer('query_count').notNull().default(0),
    // { queries: [{ query_id, query, answer, required_file: string[], page: number[] }] }
    queries: jsonb('queries').notNull().default(sql`'{"queries": []}'::jsonb`),
    agentId: char('agent_id', { length: 24 }),
    flowId: char('flow_id', { length: 24 }),
    workspaceId: char('workspace_id', { length: 24 }),
    executionId: char('execution_id', { length: 24 }),
    modelId: varchar('model_id', { length: 128 }),
    answerNodeId: varchar('answer_node_id', { length: 64 }),
    summary: jsonb('summary'),
    // LLM-generated narrative report (structured sections), overwritten on regenerate.
    narrative: jsonb('narrative'),
    // Prepared run inputs (config + request template + evaluator agent id...), so
    // a run/resume no longer depends on the on-disk run directory.
    prepared: jsonb('prepared'),
    // Last known run progress (done/total/current query), read by the live UI.
    progress: jsonb('progress'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'lse_status_values',
      sql`${t.status} IN ('dataset_ready', 'prepared', 'running', 'completed', 'failed')`,
    ),
    check('lse_query_count_non_negative', sql`${t.queryCount} >= 0`),
    index('idx_lse_owner_created').on(t.ownerId, sql`${t.createdAt} DESC`),
    index('idx_lse_status').on(t.status),
  ],
);

/**
 * Per-query results of a Logical Search evaluation run, written in real time as
 * each query completes (one row per benchmark question per run).
 */
export const evaluationResults = evaluationSchema.table(
  'evaluation_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evaluationId: uuid('evaluation_id').notNull().references(() => evaluationRuns.id, { onDelete: 'cascade' }),
    queryId: varchar('query_id', { length: 64 }).notNull(),
    query: text('query').notNull(),
    expectedAnswer: text('expected_answer').notNull(),
    generatedAnswer: text('generated_answer').notNull().default(''),
    // completed | failed (normalized from the run result status)
    status: varchar('status', { length: 30 }).notNull(),
    durationMs: integer('duration_ms'),
    targetDurationMs: integer('target_duration_ms'),
    judgeDurationMs: integer('judge_duration_ms'),
    judgeScore: doublePrecision('judge_score'),
    judgeFaithfulnessScore: doublePrecision('judge_faithfulness_score'),
    judgeReasoning: text('judge_reasoning'),
    retrievedFiles: jsonb('retrieved_files').$type<string[]>(),
    toolCalls: jsonb('tool_calls'),
    // Full run result payload, so results/export can be rebuilt from the DB
    // without depending on the on-disk run directory (Option B).
    payload: jsonb('payload'),
    tokenUsage: jsonb('token_usage'),
    // Split token consumption: eval-target vs eval-judge, plus the global total.
    targetPromptTokens: integer('target_prompt_tokens'),
    targetCompletionTokens: integer('target_completion_tokens'),
    targetTotalTokens: integer('target_total_tokens'),
    judgePromptTokens: integer('judge_prompt_tokens'),
    judgeCompletionTokens: integer('judge_completion_tokens'),
    judgeTotalTokens: integer('judge_total_tokens'),
    globalTotalTokens: integer('global_total_tokens'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'lser_status_values',
      sql`${t.status} IN ('completed', 'failed')`,
    ),
    uniqueIndex('idx_lser_evaluation_query').on(t.evaluationId, t.queryId),
    index('idx_lser_evaluation').on(t.evaluationId),
  ],
);