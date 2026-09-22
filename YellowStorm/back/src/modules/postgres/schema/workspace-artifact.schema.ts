import { sql } from 'drizzle-orm';
import { type AnyPgColumn } from 'drizzle-orm/pg-core';
import { char, check, index, integer, jsonb, pgSchema, text, timestamp, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';
import type { DecisionFlowGenerationOptions } from '../../workspace-artifact/interfaces/workspace-artifact.interface';
import type { DecisionFlowPayload } from '../../workspace-artifact/interfaces/decision-flow.interface';
import type { WorkspaceArtifactUsage } from '../../workspace-artifact/persistence/workspace-artifact-store';

export const workspaceSchema = pgSchema('workspace');

export const workspaceArtifacts = workspaceSchema.table(
  'workspace_artifacts',
  {
    id: objectId('id').primaryKey(),
    workspaceId: objectId('workspace_id').notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    name: varchar('name', { length: 150 }).notNull(),
    description: varchar('description', { length: 1000 }),
    status: varchar('status', { length: 32 }).notNull().default('queued'),
    schemaVersion: integer('schema_version').notNull().default(1),
    revision: integer('revision').notNull().default(0),

    primarySource: jsonb('primary_source').$type<{
      documentId: string;
      documentName: string;
      contentHash?: string;
      selection: { mode: 'all' } | { mode: 'pages'; pages: number[] };
    }>().notNull(),
    primarySourceDocumentId: objectId('primary_source_document_id').notNull(),

    generationOptions: jsonb('generation_options').$type<DecisionFlowGenerationOptions>().notNull(),
    payload: jsonb('payload').$type<DecisionFlowPayload>(),

    generationAgentId: objectId('generation_agent_id').notNull(),
    generationRequestedBy: objectId('generation_requested_by').notNull(),
    generationAttempts: integer('generation_attempts').notNull().default(0),
    generationStartedAt: timestamp('generation_started_at', { withTimezone: true }),
    generationCompletedAt: timestamp('generation_completed_at', { withTimezone: true }),
    generationError: text('generation_error'),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    generationUsage: jsonb('generation_usage').$type<WorkspaceArtifactUsage>(),

    clonedFromArtifactId: objectId('cloned_from_artifact_id').references(
      (): AnyPgColumn => workspaceArtifacts.id,
      { onDelete: 'set null' },
    ),
    createdBy: objectId('created_by').notNull(),
    updatedBy: objectId('updated_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('artifacts_schema_version_positive', sql`${t.schemaVersion} >= 1`),
    check('artifacts_revision_non_negative', sql`${t.revision} >= 0`),
    index('idx_artifacts_ws_type_updated').on(t.workspaceId, t.type, sql`${t.updatedAt} DESC`),
    index('idx_artifacts_ws_doc_updated').on(t.workspaceId, t.primarySourceDocumentId, sql`${t.updatedAt} DESC`),
    index('idx_artifacts_status_next').on(t.status, t.nextAttemptAt, t.createdAt),
    index('idx_artifacts_status_lease').on(t.status, t.leaseExpiresAt),
    index('idx_artifacts_created_by').on(t.createdBy),
  ],
);
