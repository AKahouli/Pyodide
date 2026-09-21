import { Inject } from '@nestjs/common';
import { and, arrayContains, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  TOOL_CATEGORY_STORE,
  TOOL_STORE,
  type NewToolRow,
  type ToolCategoryRow,
  type ToolCategoryStore,
  type ToolListQuery,
  type ToolRow,
  type ToolStore,
} from './tool.store';

type CategoryRow = typeof schema.catalogToolCategories.$inferSelect;
type ToolT = typeof schema.catalogTools.$inferSelect;

function categoryToRow(r: CategoryRow): ToolCategoryRow {
  return { id: r.id, name: r.name, description: r.description, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

/** Redis-align attribute subdocument ids: absent → generate, so responses stay stable. */
function normalizeAttributes(attributes: ToolRow['attributes']): ToolRow['attributes'] {
  return (attributes ?? []).map((attr) => ({ ...attr, id: attr.id ?? newObjectId() }));
}

function toolToRow(r: ToolT): ToolRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    icon: r.icon,
    color: r.color,
    iconColor: r.iconColor ?? 'light',
    categoryId: r.categoryId ?? null,
    defaultAgentTypes: r.defaultAgentTypes ?? [],
    attributes: normalizeAttributes((r.attributes ?? []) as unknown as ToolRow['attributes']),
    requiredAppKey: r.requiredAppKey ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PgToolCategoryStore implements ToolCategoryStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findAll(): Promise<ToolCategoryRow[]> {
    const rows = await this.q.select().from(schema.catalogToolCategories).orderBy(asc(schema.catalogToolCategories.name));
    return rows.map(categoryToRow);
  }

  async findById(id: string): Promise<ToolCategoryRow | null> {
    const [row] = await this.q.select().from(schema.catalogToolCategories).where(eq(schema.catalogToolCategories.id, id)).limit(1);
    return row ? categoryToRow(row) : null;
  }

  async findByName(name: string): Promise<ToolCategoryRow | null> {
    const [row] = await this.q.select().from(schema.catalogToolCategories).where(eq(schema.catalogToolCategories.name, name)).limit(1);
    return row ? categoryToRow(row) : null;
  }

  async insert(data: { name: string; description: string }): Promise<ToolCategoryRow> {
    const [row] = await this.q
      .insert(schema.catalogToolCategories)
      .values({ id: newObjectId(), ...data })
      .returning();
    return categoryToRow(row);
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<ToolCategoryRow | null> {
    const [row] = await this.q
      .update(schema.catalogToolCategories)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.catalogToolCategories.id, id))
      .returning();
    return row ? categoryToRow(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.q
      .delete(schema.catalogToolCategories)
      .where(eq(schema.catalogToolCategories.id, id))
      .returning({ id: schema.catalogToolCategories.id });
    return rows.length > 0;
  }
}

export class PgToolStore implements ToolStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<ToolRow | null> {
    const [row] = await this.q.select().from(schema.catalogTools).where(eq(schema.catalogTools.id, id)).limit(1);
    return row ? toolToRow(row) : null;
  }

  async findByName(name: string): Promise<ToolRow | null> {
    const [row] = await this.q.select().from(schema.catalogTools).where(eq(schema.catalogTools.name, name)).limit(1);
    return row ? toolToRow(row) : null;
  }

  async insert(row: NewToolRow): Promise<ToolRow> {
    const [inserted] = await this.q
      .insert(schema.catalogTools)
      .values({ id: newObjectId(), ...row, attributes: normalizeAttributes(row.attributes ?? []) } as unknown as typeof schema.catalogTools.$inferInsert)
      .returning();
    return toolToRow(inserted);
  }

  async update(id: string, patch: Partial<NewToolRow>): Promise<ToolRow | null> {
    const [row] = await this.q
      .update(schema.catalogTools)
      .set({ ...patch, updatedAt: new Date() } as unknown as Partial<typeof schema.catalogTools.$inferInsert>)
      .where(eq(schema.catalogTools.id, id))
      .returning();
    return row ? toolToRow(row) : null;
  }

  async delete(id: string): Promise<ToolRow | null> {
    const [row] = await this.q.delete(schema.catalogTools).where(eq(schema.catalogTools.id, id)).returning();
    return row ? toolToRow(row) : null;
  }

  async list(query: ToolListQuery): Promise<{ rows: ToolRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.search) {
      const pattern = `%${query.search}%`;
      conditions.push(or(ilike(schema.catalogTools.name, pattern), ilike(schema.catalogTools.description, pattern))!);
    }
    if (query.agentType) conditions.push(arrayContains(schema.catalogTools.defaultAgentTypes, [query.agentType]));
    if (query.isActive !== undefined) conditions.push(eq(schema.catalogTools.isActive, query.isActive));
    const filter = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [tally]] = await Promise.all([
      this.q
        .select()
        .from(schema.catalogTools)
        .where(filter)
        .orderBy(desc(schema.catalogTools.createdAt))
        .offset((query.page - 1) * query.limit)
        .limit(query.limit),
      this.q.select({ n: sql<number>`count(*)::int` }).from(schema.catalogTools).where(filter),
    ]);

    return { rows: rows.map(toolToRow), total: tally?.n ?? 0 };
  }

  async findByAgentType(agentType: string): Promise<ToolRow[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogTools)
      .where(and(eq(schema.catalogTools.isActive, true), arrayContains(schema.catalogTools.defaultAgentTypes, [agentType])))
      .orderBy(asc(schema.catalogTools.name));
    return rows.map(toolToRow);
  }

  async findAllActive(): Promise<ToolRow[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogTools)
      .where(eq(schema.catalogTools.isActive, true))
      .orderBy(asc(schema.catalogTools.name));
    return rows.map(toolToRow);
  }

  async findByIds(ids: string[]): Promise<ToolRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.q
      .select()
      .from(schema.catalogTools)
      .where(and(inArray(schema.catalogTools.id, ids), eq(schema.catalogTools.isActive, true)))
      .orderBy(asc(schema.catalogTools.name));
    return rows.map(toolToRow);
  }
}
