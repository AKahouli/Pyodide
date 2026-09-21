import { sql } from 'drizzle-orm';
import { bigint, boolean, char, check, doublePrecision, index, integer, jsonb, numeric, pgSchema, primaryKey, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
// Relative (not @common/*): pulled in by ts-node migration scripts without path aliases.
import { objectId, timestamps } from '../../../common/postgres/columns';

/** P1B catalog tables (plan 2026-09-19 step 1B). */
export const catalogSchema = pgSchema('catalog');

export const catalogSystemSettings = catalogSchema.table(
  'system_settings',
  {
    id: objectId('id').primaryKey(),
    key: varchar('key', { length: 100 }).notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_system_settings_key').on(t.key)],
);

export const catalogAppearanceLogos = catalogSchema.table('appearance_logos', {
  id: objectId('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  contentType: varchar('content_type', { length: 64 }).notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  /** Logo bytes; the default select excludes this column. */
  data: text('data'),
  ...timestamps(),
});

export const catalogGuardrailsSettings = catalogSchema.table(
  'guardrails_settings',
  {
    id: objectId('id').primaryKey(),
    singleton: boolean('singleton').notNull().default(true),
    forceActivation: boolean('force_activation').notNull().default(false),
    promptInjection: jsonb('prompt_injection').$type<Record<string, unknown>>().notNull().default({}),
    toolActionReview: jsonb('tool_action_review').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [check('guardrails_singleton_true', sql`${t.singleton}`), uniqueIndex('uq_guardrails_settings_singleton').on(t.singleton)],
);

export const catalogAiModels = catalogSchema.table(
  'ai_models',
  {
    id: objectId('id').primaryKey(),
    modelId: varchar('model_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    chef: varchar('chef', { length: 255 }).notNull(),
    chefSlug: varchar('chef_slug', { length: 255 }).notNull(),
    litellmModel: varchar('litellm_model', { length: 255 }).notNull().default(''),
    providers: text('providers').array().notNull().default([]),
    type: varchar('type', { length: 64 }).notNull().default(''),
    types: text('types').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    isConversationV2Default: boolean('is_conversation_v2_default').notNull().default(false),
    omitTemperature: boolean('omit_temperature').notNull().default(false),
    inputModalities: text('input_modalities').array().notNull().default(['text']),
    maxInputTokens: integer('max_input_tokens'),
    maxOutputTokens: integer('max_output_tokens'),
    inputCostPerToken: doublePrecision('input_cost_per_token'),
    outputCostPerToken: doublePrecision('output_cost_per_token'),
    cachedInputCostPerToken: doublePrecision('cached_input_cost_per_token'),
    supportsReasoning: boolean('supports_reasoning'),
    reasoningEfforts: jsonb('reasoning_efforts').$type<unknown[]>().notNull().default([]),
    defaultReasoningEffort: varchar('default_reasoning_effort', { length: 64 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_ai_models_model_id').on(t.modelId),
    index('idx_ai_models_chef_active').on(t.chefSlug, t.isActive),
    index('idx_ai_models_type_active').on(t.type, t.isActive),
    index('idx_ai_models_types').using('gin', t.types),
    uniqueIndex('uq_ai_models_single_default').on(t.isDefault).where(sql`${t.isDefault}`),
    uniqueIndex('uq_ai_models_single_v2_default').on(t.isConversationV2Default).where(sql`${t.isConversationV2Default}`),
  ],
);

export const catalogPlans = catalogSchema.table(
  'plans',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 50 }).notNull(),
    description: varchar('description', { length: 500 }),
    tokenLimit: bigint('token_limit', { mode: 'number' }).notNull().default(0),
    windowHours: integer('window_hours').notNull().default(24),
    requestsPerMinute: integer('requests_per_minute').notNull().default(60),
    maxTokensPerRequest: bigint('max_tokens_per_request', { mode: 'number' }).notNull().default(-1),
    features: text('features').array().notNull().default([]),
    priority: integer('priority').notNull().default(0),
    priceMonthly: numeric('price_monthly', { precision: 12, scale: 2 }).notNull().default('0'),
    priceYearly: numeric('price_yearly', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    isActive: boolean('is_active').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    maxWorkspaces: integer('max_workspaces').notNull().default(3),
    workspaceStorageBytes: bigint('workspace_storage_bytes', { mode: 'number' }).notNull().default(104857600),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    check('plans_slug_shape', sql`${t.slug} = lower(btrim(${t.slug}))`),
    check('plans_window_hours_min', sql`${t.windowHours} >= 1`),
    uniqueIndex('uq_plans_name').on(t.name),
    uniqueIndex('uq_plans_slug').on(t.slug),
    index('idx_plans_active_order').on(t.isActive, t.displayOrder),
    index('idx_plans_priority').on(t.priority),
    uniqueIndex('uq_plans_single_default').on(t.isDefault).where(sql`${t.isDefault}`),
  ],
);

export const catalogToolCategories = catalogSchema.table(
  'tool_categories',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 1024 }).notNull().default(''),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_tool_categories_name').on(t.name)],
);

export const catalogTools = catalogSchema.table(
  'tools',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description').notNull().default(''),
    icon: varchar('icon', { length: 64 }).notNull().default(''),
    color: varchar('color', { length: 64 }).notNull().default(''),
    iconColor: varchar('icon_color', { length: 8 }),
    categoryId: objectId('category_id').references(() => catalogToolCategories.id, { onDelete: 'set null' }),
    defaultAgentTypes: text('default_agent_types').array().notNull().default([]),
    /** Subdocument _ids preserved inside (plan DDL note). */
    attributes: jsonb('attributes').$type<Array<Record<string, unknown>>>().notNull().default([]),
    requiredAppKey: varchar('required_app_key', { length: 64 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_tools_name').on(t.name),
    index('idx_tools_category').on(t.categoryId),
    index('idx_tools_active').on(t.isActive),
    index('idx_tools_default_agent_types').using('gin', t.defaultAgentTypes),
  ],
);

export const catalogSkillCategories = catalogSchema.table(
  'skill_categories',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
      description: varchar('description', { length: 1024 }).notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_skill_categories_name').on(t.name)],
);

export const catalogSkills = catalogSchema.table(
  'skills',
  {
    id: objectId('id').primaryKey(),
    slug: varchar('slug', { length: 64 }),
    name: varchar('name', { length: 64 }).notNull(),
    description: varchar('description', { length: 1024 }).notNull(),
    icon: varchar('icon', { length: 64 }).notNull().default(''),
    color: varchar('color', { length: 64 }).notNull().default(''),
    iconColor: varchar('icon_color', { length: 8 }),
    categoryId: objectId('category_id').references(() => catalogSkillCategories.id, { onDelete: 'set null' }),
    license: varchar('license', { length: 255 }),
    compatibility: varchar('compatibility', { length: 500 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    allowedTools: text('allowed_tools').array().notNull().default([]),
    instructions: varchar('instructions', { length: 50000 }),
    isActive: boolean('is_active').notNull().default(true),
    /** May be the system sentinel → no user FK. */
    createdBy: objectId('created_by').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_skills_owner_name').on(t.name, t.createdBy),
    uniqueIndex('uq_skills_owner_slug').on(t.slug, t.createdBy).where(sql`${t.slug} IS NOT NULL`),
    index('idx_skills_active_owner').on(t.isActive, t.createdBy),
    index('idx_skills_category').on(t.categoryId),
    index('idx_skills_created_by').on(t.createdBy),
  ],
);

export const catalogSkillFiles = catalogSchema.table(
  'skill_files',
  {
    id: objectId('id').primaryKey(),
    skillId: objectId('skill_id')
      .notNull()
      .references(() => catalogSkills.id, { onDelete: 'cascade' }),
    path: varchar('path', { length: 255 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    mimeType: varchar('mime_type', { length: 128 }),
    content: text('content').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [check('skill_files_kind_enum', sql`${t.kind} IN ('reference','asset')`), index('idx_skill_files_skill').on(t.skillId, t.position)],
);

export const catalogAgentTypes = catalogSchema.table(
  'agent_types',
  {
    id: objectId('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    defaultPrompt: varchar('default_prompt', { length: 50000 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('uq_agent_types_name').on(t.name),
    uniqueIndex('uq_agent_types_slug').on(t.slug),
    index('idx_agent_types_active').on(t.isActive),
  ],
);

export const catalogAgentTypeSkills = catalogSchema.table(
  'agent_type_skills',
  {
    agentTypeId: objectId('agent_type_id')
      .notNull()
      .references(() => catalogAgentTypes.id, { onDelete: 'cascade' }),
    skillId: objectId('skill_id')
      .notNull()
      .references(() => catalogSkills.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.agentTypeId, t.skillId] }), index('idx_agent_type_skills_skill').on(t.skillId)],
);

export const catalogAgentTypePrompts = catalogSchema.table(
  'agent_type_prompts',
  {
    id: objectId('id').primaryKey(),
    agentTypeId: objectId('agent_type_id')
      .notNull()
      .references(() => catalogAgentTypes.id, { onDelete: 'cascade' }),
    /** ai_models.model_id, soft link (models are deactivated, not deleted). */
    modelId: varchar('model_id', { length: 255 }).notNull(),
    prompt: varchar('prompt', { length: 50000 }).notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('uq_agent_type_prompts_type_model').on(t.agentTypeId, t.modelId)],
);
