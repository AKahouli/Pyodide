import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

/**
 * Classifier tables (roadmap P6): the folder tree of a workspace, the assignment of each
 * document to a folder, the user's classification rules and the classification runs.
 * Every parent reference is a real foreign key in 0034_classifier.sql; `playbook_id`
 * has none until the flow store leaves Mongo (P5).
 */
export const classifierSchema = pgSchema('classifier');

export const classifierFolders = classifierSchema.table(
  'folders',
  {
    id: objectId('id').primaryKey(),
    workspaceId: objectId('workspace_id').notNull(),
    parentId: objectId('parent_id'),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 1000 }).notNull(),
    createdBy: objectId('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('classifier_folders_name', sql`char_length(${t.name}) >= 1`),
    check('classifier_folders_description', sql`char_length(${t.description}) >= 1`),
    // The unique index is NULLS NOT DISTINCT in 0034_classifier.sql — drizzle 0.45 cannot express it.
    uniqueIndex('uq_classifier_folders_location').on(t.workspaceId, t.parentId, t.name),
    index('idx_classifier_folders_parent').on(t.parentId),
    index('idx_classifier_folders_workspace_created').on(t.workspaceId, t.createdAt.desc()),
  ],
);

export const classifierRuns = classifierSchema.table(
  'runs',
  {
    id: objectId('id').primaryKey(),
    workspaceId: objectId('workspace_id').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    playbookId: objectId('playbook_id').notNull(),
    playbookExecutionId: text('playbook_execution_id'),
    hint: text('hint'),
    overwriteExisting: boolean('overwrite_existing').notNull().default(false),
    totalFiles: integer('total_files').notNull().default(0),
    classifiedFiles: integer('classified_files').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    triggeredBy: objectId('triggered_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('classifier_runs_status', sql`${t.status} IN ('queued','running','success','failed','cancelled')`),
    check('classifier_runs_total', sql`${t.totalFiles} >= 0`),
    check('classifier_runs_classified', sql`${t.classifiedFiles} >= 0`),
    index('idx_classifier_runs_workspace_created').on(t.workspaceId, t.createdAt.desc()),
    index('idx_classifier_runs_status_created').on(t.status, t.createdAt.desc()),
  ],
);

export const classifierFileAssignments = classifierSchema.table(
  'file_assignments',
  {
    id: objectId('id').primaryKey(),
    workspaceId: objectId('workspace_id').notNull(),
    documentId: objectId('document_id').notNull(),
    folderId: objectId('folder_id'),
    assignmentSource: varchar('assignment_source', { length: 16 }).notNull().default('manual'),
    classificationRunId: objectId('classification_run_id'),
    assignedBy: objectId('assigned_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('classifier_assignments_source', sql`${t.assignmentSource} IN ('manual','playbook')`),
    uniqueIndex('uq_classifier_assignments_document').on(t.workspaceId, t.documentId),
    index('idx_classifier_assignments_folder').on(t.workspaceId, t.folderId),
    index('idx_classifier_assignments_folder_only').on(t.folderId),
    index('idx_classifier_assignments_document').on(t.documentId),
  ],
);

export const classifierRules = classifierSchema.table(
  'rules',
  {
    id: objectId('id').primaryKey(),
    userId: objectId('user_id').notNull(),
    scope: varchar('scope', { length: 8 }).notNull(),
    workspaceId: objectId('workspace_id'),
    text: varchar('text', { length: 1000 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check('classifier_rules_scope', sql`${t.scope} IN ('global','local')`),
    check('classifier_rules_text', sql`char_length(${t.text}) >= 1`),
    check('classifier_rules_scope_workspace', sql`(${t.scope} = 'global') = (${t.workspaceId} IS NULL)`),
    index('idx_classifier_rules_user_scope').on(t.userId, t.scope, t.workspaceId, t.createdAt.desc()),
    index('idx_classifier_rules_workspace').on(t.workspaceId),
  ],
);
