import { sql } from 'drizzle-orm';
import { check, index, pgTable, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { agents } from './agents.schema';
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P4 agent shares (plan 2026-09-19 step 4a) — same schema as agents for the FK. */
export const sharedAgents = pgTable(
  'shared_agents',
  {
    id: objectId('id').primaryKey(),
    agentId: objectId('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    sharedBy: objectId('shared_by').notNull(),
    sharedWith: objectId('shared_with').notNull(),
    permission: varchar('permission', { length: 8 }).notNull().default('read'),
    ...timestamps(),
  },
  (t) => [
    check('shared_agents_permission_enum', sql`${t.permission} IN ('read','write')`),
    uniqueIndex('uq_shared_agents_agent_user').on(t.agentId, t.sharedWith),
    index('idx_shared_agents_with_created').on(t.sharedWith, t.createdAt.desc()),
    index('idx_shared_agents_by').on(t.sharedBy),
  ],
);
