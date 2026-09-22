import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, index, integer, pgSchema, primaryKey, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { agents } from './agents.schema';
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P4 teams schema (plan 2026-09-19 step 4a). */
export const teamsSchema = pgSchema('teams');

export const teams = teamsSchema.table(
  'teams',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 2000 }).notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: objectId('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    check('teams_name_min_length', sql`char_length(btrim(${t.name})) >= 2`),
    uniqueIndex('uq_teams_owner_name').on(t.name, t.createdBy),
    index('idx_teams_owner_active').on(t.createdBy, t.isActive),
    index('idx_teams_name_trgm').using('gin', t.name, sql`gin_trgm_ops`),
  ],
);

/** members[] as a table; `position` = array index (API returns members in array order). */
export const teamMembers = teamsSchema.table(
  'team_members',
  {
    teamId: objectId('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    agentId: objectId('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    parentAgentId: objectId('parent_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    order: integer('order').notNull().default(0),
    positionX: doublePrecision('position_x').notNull().default(0),
    positionY: doublePrecision('position_y').notNull().default(0),
    position: integer('position').notNull(),
  },
  (t) => [
    check('team_members_order_nonneg', sql`${t.order} >= 0`),
    primaryKey({ columns: [t.teamId, t.agentId] }),
    index('idx_team_members_agent').on(t.agentId),
    index('idx_team_members_parent').on(t.parentAgentId).where(sql`${t.parentAgentId} IS NOT NULL`),
  ],
);

export const sharedTeams = teamsSchema.table(
  'shared_teams',
  {
    id: objectId('id').primaryKey(),
    teamId: objectId('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    sharedBy: objectId('shared_by').notNull(),
    sharedWith: objectId('shared_with').notNull(),
    permission: varchar('permission', { length: 8 }).notNull().default('read'),
    ...timestamps(),
  },
  (t) => [
    check('shared_teams_permission_enum', sql`${t.permission} IN ('read','write')`),
    uniqueIndex('uq_shared_teams_team_user').on(t.teamId, t.sharedWith),
    index('idx_shared_teams_with_created').on(t.sharedWith, t.createdAt.desc()),
    index('idx_shared_teams_by').on(t.sharedBy),
  ],
);

export const teamAutoBuilderConfig = teamsSchema.table(
  'auto_builder_config',
  {
    id: objectId('id').primaryKey(),
    singleton: boolean('singleton').notNull().default(true),
    modelId: varchar('model_id', { length: 255 }).notNull(),
    systemPrompt: varchar('system_prompt', { length: 10000 }).notNull(),
    temperature: doublePrecision('temperature').notNull().default(0.7),
    isEnabled: boolean('is_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('team_auto_builder_singleton_true', sql`${t.singleton}`),
    check('team_auto_builder_temperature_range', sql`${t.temperature} BETWEEN 0 AND 2`),
    uniqueIndex('uq_team_auto_builder_singleton').on(t.singleton),
  ],
);
