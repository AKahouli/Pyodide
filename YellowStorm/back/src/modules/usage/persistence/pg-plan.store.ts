import { Inject } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import type { CreatePlanData, UpdatePlanData } from '../interfaces/plan.interface';
import { PLAN_STORE, type PlanRecord, type PlanStore } from './plan.store';

type Row = typeof schema.catalogPlans.$inferSelect;

function toRecord(row: Row): PlanRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    tokenLimit: row.tokenLimit,
    windowHours: row.windowHours,
    requestsPerMinute: row.requestsPerMinute,
    maxTokensPerRequest: row.maxTokensPerRequest,
    features: row.features ?? [],
    priority: row.priority,
    // numeric columns come back as strings — plans are consumed as numbers
    priceMonthly: Number(row.priceMonthly),
    priceYearly: Number(row.priceYearly),
    currency: row.currency,
    isActive: row.isActive,
    isDefault: row.isDefault,
    displayOrder: row.displayOrder,
    maxWorkspaces: row.maxWorkspaces,
    workspaceStorageBytes: row.workspaceStorageBytes,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Column-shaped values: numeric columns are string-typed in drizzle. */
type PlanValues = Omit<CreatePlanData, 'priceMonthly' | 'priceYearly'> & {
  priceMonthly?: string;
  priceYearly?: string;
};

function toValues(data: CreatePlanData | UpdatePlanData): PlanValues {
  const { priceMonthly, priceYearly, ...rest } = data;
  const cleaned = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, unknown>;
  if (typeof priceMonthly === 'number') cleaned.priceMonthly = String(priceMonthly);
  if (typeof priceYearly === 'number') cleaned.priceYearly = String(priceYearly);
  return cleaned as PlanValues;
}

/** PostgreSQL catalog.plans implementation of PlanStore (plan 1B.3.2). */
export class PgPlanStore implements PlanStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findActive(): Promise<PlanRecord[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogPlans)
      .where(eq(schema.catalogPlans.isActive, true))
      .orderBy(asc(schema.catalogPlans.displayOrder));
    return rows.map(toRecord);
  }

  async findAll(): Promise<PlanRecord[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogPlans)
      .orderBy(asc(schema.catalogPlans.displayOrder));
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<PlanRecord | null> {
    const [row] = await this.q.select().from(schema.catalogPlans).where(eq(schema.catalogPlans.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async findBySlug(slug: string): Promise<PlanRecord | null> {
    const [row] = await this.q.select().from(schema.catalogPlans).where(eq(schema.catalogPlans.slug, slug)).limit(1);
    return row ? toRecord(row) : null;
  }

  async findFlaggedDefault(): Promise<PlanRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogPlans)
      .where(and(eq(schema.catalogPlans.isDefault, true), eq(schema.catalogPlans.isActive, true)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async seed(data: CreatePlanData): Promise<void> {
    await this.q
      .insert(schema.catalogPlans)
      .values({ id: newObjectId(), ...toValues(data) })
      .onConflictDoNothing({ target: schema.catalogPlans.slug });
  }

  async insert(data: CreatePlanData): Promise<PlanRecord | null> {
    return withTransaction(this.db, async (tx) => {
      if (data.isDefault) {
        await tx
          .update(schema.catalogPlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(schema.catalogPlans.isDefault, true));
      }
      const [row] = await tx
        .insert(schema.catalogPlans)
        .values({ id: newObjectId(), ...toValues(data) })
        .onConflictDoNothing({ target: schema.catalogPlans.slug })
        .returning();
      return row ? toRecord(row) : null;
    });
  }

  async update(id: string, patch: UpdatePlanData): Promise<PlanRecord | null> {
    return withTransaction(this.db, async (tx) => {
      if (patch.isDefault) {
        await tx
          .update(schema.catalogPlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(ne(schema.catalogPlans.id, id), eq(schema.catalogPlans.isDefault, true)));
      }
      const [row] = await tx
        .update(schema.catalogPlans)
        .set({ ...toValues(patch), updatedAt: new Date() })
        .where(eq(schema.catalogPlans.id, id))
        .returning();
      return row ? toRecord(row) : null;
    });
  }
}
