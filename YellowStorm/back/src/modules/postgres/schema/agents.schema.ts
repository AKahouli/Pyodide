import { sql } from 'drizzle-orm';
import {
  pgTable,
  char,
  varchar,
  text,
  boolean,
  real,
  smallint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';

/**
 * Agent relational schema. Mirrors back/db/postgres/agent.schema.sql (the
 * contract shared with other services). ids are Mongo ObjectId hex → char(24).
 * Ref-side ids point at Mongo docs → no cross-DB FK; only agent_id has a real FK.
 */
export const agents = pgTable(
  'agents',
  {
    id: char('id', { length: 24 }).primaryKey(),

    name: varchar('name', { length: 50 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().default(''),
    role: text('role').notNull(),
    description: varchar('description', { length: 1000 }).notNull().default(''),
    temperature: real('temperature').notNull().default(0),
    llmModel: varchar('llm_model', { length: 100 }),
    reasoningEffort: varchar('reasoning_effort', { length: 50 }),
    email: varchar('email', { length: 320 }),
    instruction: text('instruction').notNull().default(''),
    ignorePrePrompt: boolean('ignore_pre_prompt').notNull().default(false),

    agentTypeId: char('agent_type_id', { length: 24 }).notNull(),
    agentTypeSlug: varchar('agent_type_slug', { length: 100 }).notNull().default(''),

    enableTemporaryChildAgents: boolean('enable_temporary_child_agents').notNull().default(false),
    maxTemporaryChildAgents: smallint('max_temporary_child_agents').notNull().default(4),

    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    isDefaultForType: boolean('is_default_for_type').notNull().default(false),

    createdBy: char('created_by', { length: 24 }).notNull(),

    guardrails: jsonb('guardrails').notNull().default(sql`'{}'::jsonb`),
    deploymentSettings: jsonb('deployment_settings').notNull().default(sql`'{}'::jsonb`),

    a2aPublished: boolean('a2a_published').notNull().default(false),
    a2aAgentId: text('a2a_agent_id'),
    a2aAgentCardUrl: text('a2a_agent_card_url'),
    a2aApiKeyHeader: text('a2a_api_key_header'),
    a2aPublishedAt: timestamp('a2a_published_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agents_temperature_range', sql`${t.temperature} >= 0 AND ${t.temperature} <= 1`),
    check('agents_max_children_range', sql`${t.maxTemporaryChildAgents} BETWEEN 1 AND 8`),
    index('idx_agents_created_by_is_active').on(t.createdBy, t.isActive),
    index('idx_agents_is_default_is_active').on(t.isDefault, t.isActive),
    uniqueIndex('uq_agents_name_created_by').on(t.name, t.createdBy),
    uniqueIndex('uq_agents_created_by_slug_non_default')
      .on(t.createdBy, t.slug)
      .where(sql`${t.isDefault} = false AND ${t.slug} <> ''`),
    uniqueIndex('uq_agents_slug_default')
      .on(t.slug, t.isDefault)
      .where(sql`${t.isDefault} = true AND ${t.slug} <> ''`),
    index('idx_agents_type_created_by_default_for_type').on(t.agentTypeId, t.createdBy, t.isDefaultForType),
    index('idx_agents_type_is_default_default_for_type').on(t.agentTypeId, t.isDefault, t.isDefaultForType),
    index('idx_agents_agent_type_slug').on(t.agentTypeSlug),
    index('idx_agents_is_active').on(t.isActive),
  ],
);

export const agentTools = pgTable(
  'agent_tools',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    toolId: char('tool_id', { length: 24 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.toolId] }),
    index('idx_agent_tools_tool_id').on(t.toolId),
  ],
);

export const agentSkills = pgTable(
  'agent_skills',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    skillId: char('skill_id', { length: 24 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('idx_agent_skills_skill_id').on(t.skillId),
  ],
);

export const agentDisabledSkills = pgTable(
  'agent_disabled_skills',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    skillId: char('skill_id', { length: 24 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('idx_agent_disabled_skills_skill_id').on(t.skillId),
  ],
);

export const agentConnectors = pgTable(
  'agent_connectors',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    connectorId: char('connector_id', { length: 24 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.connectorId] }),
    index('idx_agent_connectors_connector_id').on(t.connectorId),
  ],
);

export const agentKnowledgeBases = pgTable(
  'agent_knowledge_bases',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    workspaceId: char('workspace_id', { length: 24 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.workspaceId] }),
    index('idx_agent_knowledge_bases_workspace_id').on(t.workspaceId),
  ],
);

export const agentConnectorActions = pgTable(
  'agent_connector_actions',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    connectorId: char('connector_id', { length: 24 }).notNull(),
    actionKeys: text('action_keys').array().notNull().default(sql`'{}'`),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.connectorId] }),
    index('idx_agent_connector_actions_connector_id').on(t.connectorId),
  ],
);
