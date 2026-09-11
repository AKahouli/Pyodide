import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Logical Search evaluation runs. Persisted in Postgres (requirement) while
 * referenced entities (agent, flow, workspace, execution) stay in Mongo →
 * char(24) ids without cross-DB FKs, like the agents schema.
 */
export const logicalSearchEvaluations = pgTable(
  'logical_search_evaluations',
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
    answerNodeId: varchar('answer_node_id', { length: 64 }),
    summary: jsonb('summary'),
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
