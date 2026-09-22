import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, pgSchema, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): this file is pulled in by ts-node migration/backfill
// scripts that don't register tsconfig path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

export const projectSchema = pgSchema('project');

export const projects = projectSchema.table(
  'projects',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    createdBy: objectId('created_by').notNull(),
    isPublic: boolean('is_public').notNull().default(false),
    shareCount: integer('share_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_projects_owner_name').on(t.createdBy, t.name),
    index('idx_projects_owner_created').on(t.createdBy, sql`${t.createdAt} DESC`),
  ],
);

export const projectShares = projectSchema.table(
  'project_shares',
  {
    id: objectId('id').primaryKey(),
    projectId: objectId('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: objectId('owner_id').notNull(),
    sharedWithUserId: objectId('shared_with_user_id').notNull(),
    permission: varchar('permission', { length: 16 }).notNull(),
    sharedBy: objectId('shared_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('project_shares_permission', sql`${t.permission} IN ('read', 'readwrite')`),
    uniqueIndex('uq_project_shares_project_user').on(t.projectId, t.sharedWithUserId),
    index('idx_project_shares_user_created').on(t.sharedWithUserId, sql`${t.createdAt} DESC`),
    index('idx_project_shares_project_created').on(t.projectId, sql`${t.createdAt} DESC`),
    index('idx_project_shares_owner').on(t.ownerId),
  ],
);
