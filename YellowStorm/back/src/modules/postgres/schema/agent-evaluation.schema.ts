import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { objectId, timestamps } from '../../../common/postgres/columns';

/**
 * Agent-evaluation schema (roadmap P6): datasets, scenarios, runs and the
 * answer-reliability settings singleton of the Nest evaluation module.
 * Named `agent_evaluation` because `evaluation.*` belongs to another feature.
 */
export const agentEvaluationSchema = pgSchema('agent_evaluation');

export const agentEvaluationDatasets = agentEvaluationSchema.table(
  'datasets',
  {
    id: objectId('id').primaryKey(),
    name: text('name').notNull(),
    items: jsonb('items').$type<Record<string, unknown>[]>().notNull().default([]),
    createdBy: objectId('created_by').notNull(),
    workspaceId: objectId('workspace_id'),
    ...timestamps(),
  },
  (t) => [
    index('idx_ae_datasets_created_by').on(t.createdBy),
    index('idx_ae_datasets_workspace').on(t.workspaceId),
  ],
);

export const agentEvaluationEvaluations = agentEvaluationSchema.table(
  'evaluations',
  {
    id: objectId('id').primaryKey(),
    agentId: objectId('agent_id').notNull(),
    scenarioName: text('scenario_name').notNull(),
    datasetId: objectId('dataset_id'),
    mode: varchar('mode', { length: 16 }).notNull().default('non_strict'),
    results: jsonb('results').$type<Record<string, unknown>[]>().notNull().default([]),
    numRuns: integer('num_runs').notNull().default(1),
    completedRuns: integer('completed_runs').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('processing'),
    createdBy: objectId('created_by').notNull(),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [
    check('ae_evaluations_mode', sql`${t.mode} IN ('strict','non_strict')`),
    check('ae_evaluations_status', sql`${t.status} IN ('processing','completed','failed')`),
    index('idx_ae_evaluations_agent_created').on(t.agentId, t.createdAt.desc()),
    index('idx_ae_evaluations_created_by').on(t.createdBy),
    index('idx_ae_evaluations_dataset').on(t.datasetId),
  ],
);

export const agentEvaluationScenarios = agentEvaluationSchema.table(
  'scenarios',
  {
    id: objectId('id').primaryKey(),
    name: text('name').notNull(),
    agentId: objectId('agent_id').notNull(),
    datasetId: objectId('dataset_id').notNull(),
    numRuns: integer('num_runs').notNull().default(1),
    mode: varchar('mode', { length: 16 }).notNull().default('non_strict'),
    ...timestamps(),
  },
  (t) => [
    check('ae_scenarios_mode', sql`${t.mode} IN ('strict','non_strict')`),
    index('idx_ae_scenarios_agent').on(t.agentId),
    index('idx_ae_scenarios_dataset').on(t.datasetId),
  ],
);

/** Singleton row (the former `{ key: 'global' }` document). */
export const agentEvaluationSettings = agentEvaluationSchema.table(
  'settings',
  {
    id: objectId('id').primaryKey(),
    singleton: boolean('singleton').notNull().default(true),
    responseReliability: jsonb('response_reliability')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps(),
  },
  (t) => [
    check('ae_settings_singleton_true', sql`${t.singleton}`),
    uniqueIndex('uq_ae_settings_singleton').on(t.singleton),
  ],
);
