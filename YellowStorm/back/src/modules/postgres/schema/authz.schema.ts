import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P1A authorization tables (plan 2026-09-19 step 1A). */
export const authzSchema = pgSchema('authz');

export const authzRoles = authzSchema.table(
  'roles',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description').notNull(),
    permissions: text('permissions').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    priority: integer('priority').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    check('roles_name_shape', sql`${t.name} = lower(btrim(${t.name}))`),
    uniqueIndex('uq_roles_name').on(t.name),
    index('idx_roles_active').on(t.isActive),
    index('idx_roles_priority').on(t.priority.desc()),
  ],
);

/** Audit history: actor_id deliberately has NO FK (same rule as governance events). */
export const authzAuditLogs = authzSchema.table(
  'audit_logs',
  {
    id: objectId('id').primaryKey(),
    actorId: objectId('actor_id').notNull(),
    actorEmail: varchar('actor_email', { length: 320 }).notNull(),
    action: varchar('action', { length: 128 }).notNull(),
    targetId: objectId('target_id'),
    targetType: varchar('target_type', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    status: varchar('status', { length: 16 }).notNull(),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('audit_logs_status_enum', sql`${t.status} IN ('success','failure')`),
    index('idx_audit_logs_created').on(t.createdAt.desc()),
    index('idx_audit_logs_actor_created').on(t.actorId, t.createdAt.desc()),
    index('idx_audit_logs_action_created').on(t.action, t.createdAt.desc()),
    index('idx_audit_logs_target').on(t.targetType, t.targetId, t.createdAt.desc()),
    index('idx_audit_logs_status').on(t.status),
    index('idx_audit_logs_actor_email_trgm').using('gin', sql`${t.actorEmail} gin_trgm_ops`),
  ],
);
