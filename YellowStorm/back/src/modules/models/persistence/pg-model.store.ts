import { Inject } from '@nestjs/common';
import { and, arrayContains, asc, desc, eq, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  MODEL_STORE,
  type ModelFindOptions,
  type ModelPatch,
  type ModelRow,
  type ModelStore,
  type NewModelRow,
} from './model.store';

type Row = typeof schema.catalogAiModels.$inferSelect;

function toRow(r: Row): ModelRow {
  return {
    id: r.id,
    modelId: r.modelId,
    name: r.name,
    chef: r.chef,
    chefSlug: r.chefSlug,
    litellmModel: r.litellmModel,
    providers: r.providers ?? [],
    type: r.type,
    types: r.types ?? [],
    isActive: r.isActive,
    isDefault: r.isDefault,
    isConversationV2Default: r.isConversationV2Default,
    omitTemperature: r.omitTemperature,
    inputModalities: r.inputModalities ?? [],
    maxInputTokens: r.maxInputTokens,
    maxOutputTokens: r.maxOutputTokens,
    inputCostPerToken: r.inputCostPerToken,
    outputCostPerToken: r.outputCostPerToken,
    cachedInputCostPerToken: r.cachedInputCostPerToken,
    supportsReasoning: r.supportsReasoning,
    reasoningEfforts: r.reasoningEfforts ?? [],
    defaultReasoningEffort: r.defaultReasoningEffort,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** PostgreSQL catalog.ai_models implementation of ModelStore (plan 1B.3.1). */
export class PgModelStore implements ModelStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private chatCondition(): SQL {
    // Mongo `types: 'chat'` matches the array element OR the legacy scalar.
    return or(arrayContains(schema.catalogAiModels.types, ['chat']), eq(schema.catalogAiModels.type, 'chat'))!;
  }

  private listConditions(options: ModelFindOptions): SQL[] {
    const conditions: SQL[] = [];
    if (options.activeOnly) conditions.push(eq(schema.catalogAiModels.isActive, true));
    if (options.chatOnly) conditions.push(this.chatCondition());
    if (options.chefSlug) conditions.push(eq(schema.catalogAiModels.chefSlug, options.chefSlug));
    return conditions;
  }

  async findByModelId(modelId: string): Promise<ModelRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAiModels)
      .where(eq(schema.catalogAiModels.modelId, modelId))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async findByIdOrLitellmModel(id: string): Promise<ModelRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAiModels)
      .where(or(eq(schema.catalogAiModels.modelId, id), eq(schema.catalogAiModels.litellmModel, id)))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async list(options: ModelFindOptions): Promise<ModelRow[]> {
    const conditions = this.listConditions(options);
    const rows = await this.q
      .select()
      .from(schema.catalogAiModels)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.catalogAiModels.chef), asc(schema.catalogAiModels.name));
    return rows.map(toRow);
  }

  async insertIfAbsent(row: NewModelRow): Promise<boolean> {
    const inserted = await this.q
      .insert(schema.catalogAiModels)
      .values({ id: newObjectId(), ...row })
      .onConflictDoNothing({ target: schema.catalogAiModels.modelId })
      .returning({ id: schema.catalogAiModels.id });
    return inserted.length > 0;
  }

  async updateByModelId(modelId: string, patch: ModelPatch): Promise<ModelRow | null> {
    const [row] = await this.q
      .update(schema.catalogAiModels)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.catalogAiModels.modelId, modelId))
      .returning();
    return row ? toRow(row) : null;
  }

  async deactivateNotIn(modelIds: string[]): Promise<number> {
    if (modelIds.length === 0) return 0;
    const rows = await this.q
      .update(schema.catalogAiModels)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(schema.catalogAiModels.isActive, true), notInArray(schema.catalogAiModels.modelId, modelIds)))
      .returning({ id: schema.catalogAiModels.id });
    return rows.length;
  }

  async clearGuardrailsClassifierExcept(modelId: string): Promise<void> {
    const scope = and(ne(schema.catalogAiModels.modelId, modelId), eq(schema.catalogAiModels.isActive, true))!;
    // array_remove drops only the classifier element, like Mongo $pull.
    await this.q
      .update(schema.catalogAiModels)
      .set({
        types: sql`array_remove(${schema.catalogAiModels.types}, 'guardrails_classifier')`,
        updatedAt: new Date(),
      })
      .where(and(scope, arrayContains(schema.catalogAiModels.types, ['guardrails_classifier'])));
    await this.q
      .update(schema.catalogAiModels)
      .set({ type: '', updatedAt: new Date() })
      .where(and(scope, eq(schema.catalogAiModels.type, 'guardrails_classifier')));
  }

  async setExclusiveFlag(modelId: string, flag: 'isDefault' | 'isConversationV2Default'): Promise<ModelRow | null> {
    return withTransaction(this.db, async (tx) => {
      await tx
        .update(schema.catalogAiModels)
        .set({ [flag]: false, updatedAt: new Date() })
        .where(eq(schema.catalogAiModels[flag], true));
      const [row] = await tx
        .update(schema.catalogAiModels)
        .set({ [flag]: true, updatedAt: new Date() })
        .where(eq(schema.catalogAiModels.modelId, modelId))
        .returning();
      return row ? toRow(row) : null;
    });
  }

  async findDefault(): Promise<ModelRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAiModels)
      .where(and(eq(schema.catalogAiModels.isDefault, true), eq(schema.catalogAiModels.isActive, true), this.chatCondition()))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async findConversationV2Default(): Promise<ModelRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAiModels)
      .where(and(eq(schema.catalogAiModels.isConversationV2Default, true), eq(schema.catalogAiModels.isActive, true), this.chatCondition()))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async findGuardrailsClassifier(): Promise<ModelRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAiModels)
      .where(
        and(
          eq(schema.catalogAiModels.isActive, true),
          or(
            arrayContains(schema.catalogAiModels.types, ['guardrails_classifier']),
            eq(schema.catalogAiModels.type, 'guardrails_classifier'),
          ),
        ),
      )
      .orderBy(desc(schema.catalogAiModels.updatedAt))
      .limit(1);
    return row ? toRow(row) : null;
  }
}
