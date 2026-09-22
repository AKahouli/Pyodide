import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import { escapeLike } from '@common/postgres/like';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  AGENT_TYPE_STORE,
  type AgentTypeListQuery,
  type AgentTypePromptRow,
  type AgentTypeRow,
  type AgentTypeStore,
  type NewAgentTypeRow,
} from './agent-type.store';

type TypeT = typeof schema.catalogAgentTypes.$inferSelect;
type PromptT = typeof schema.catalogAgentTypePrompts.$inferSelect;

function promptToRow(r: PromptT): AgentTypePromptRow {
  return {
    id: r.id,
    agentTypeId: r.agentTypeId,
    modelId: r.modelId,
    prompt: r.prompt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** PostgreSQL catalog.agent_types implementation of AgentTypeStore (plan 1B.4.3). */
export class PgAgentTypeStore implements AgentTypeStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Hydrate one row with its skill ids ordered by junction position. */
  private async hydrate(row: TypeT): Promise<AgentTypeRow> {
    const junctions = await this.q
      .select({ skillId: schema.catalogAgentTypeSkills.skillId })
      .from(schema.catalogAgentTypeSkills)
      .where(eq(schema.catalogAgentTypeSkills.agentTypeId, row.id))
      .orderBy(asc(schema.catalogAgentTypeSkills.position));
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      defaultPrompt: row.defaultPrompt ?? '',
      skills: junctions.map((j) => j.skillId),
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async hydrateAll(rows: TypeT[]): Promise<AgentTypeRow[]> {
    if (rows.length === 0) return [];
    const junctions = await this.q
      .select({ agentTypeId: schema.catalogAgentTypeSkills.agentTypeId, skillId: schema.catalogAgentTypeSkills.skillId })
      .from(schema.catalogAgentTypeSkills)
      .where(inArray(schema.catalogAgentTypeSkills.agentTypeId, rows.map((r) => r.id)))
      .orderBy(asc(schema.catalogAgentTypeSkills.position));
    const byType = new Map<string, string[]>();
    for (const j of junctions) {
      const list = byType.get(j.agentTypeId) ?? [];
      list.push(j.skillId);
      byType.set(j.agentTypeId, list);
    }
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      defaultPrompt: row.defaultPrompt ?? '',
      skills: byType.get(row.id) ?? [],
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /** Replace the skill junction for a type (position = array order). */
  private async replaceSkills(tx: PgQueryable<typeof schema>, agentTypeId: string, skills: string[]): Promise<void> {
    await tx.delete(schema.catalogAgentTypeSkills).where(eq(schema.catalogAgentTypeSkills.agentTypeId, agentTypeId));
    if (skills.length > 0) {
      await tx.insert(schema.catalogAgentTypeSkills).values(
        skills.map((skillId, position) => ({ agentTypeId, skillId, position })),
      );
    }
  }

  async findById(id: string): Promise<AgentTypeRow | null> {
    const [row] = await this.q.select().from(schema.catalogAgentTypes).where(eq(schema.catalogAgentTypes.id, id)).limit(1);
    return row ? this.hydrate(row) : null;
  }

  async findByIds(ids: string[]): Promise<AgentTypeRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.q.select().from(schema.catalogAgentTypes).where(inArray(schema.catalogAgentTypes.id, ids));
    return this.hydrateAll(rows);
  }

  async findBySlug(slug: string, activeOnly = false): Promise<AgentTypeRow | null> {
    const conditions: SQL[] = [eq(schema.catalogAgentTypes.slug, slug)];
    if (activeOnly) conditions.push(eq(schema.catalogAgentTypes.isActive, true));
    const [row] = await this.q.select().from(schema.catalogAgentTypes).where(and(...conditions)).limit(1);
    return row ? this.hydrate(row) : null;
  }

  async findByNameOrSlug(name: string, slug: string): Promise<AgentTypeRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAgentTypes)
      .where(sql`${schema.catalogAgentTypes.name} = ${name} OR ${schema.catalogAgentTypes.slug} = ${slug}`)
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  async findByNameOrSlugExcluding(excludeId: string, name: string, slug: string): Promise<AgentTypeRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAgentTypes)
      .where(sql`${schema.catalogAgentTypes.id} <> ${excludeId} AND (${schema.catalogAgentTypes.name} = ${name} OR ${schema.catalogAgentTypes.slug} = ${slug})`)
      .limit(1);
    return row ? this.hydrate(row) : null;
  }

  async insert(row: NewAgentTypeRow): Promise<AgentTypeRow> {
    return withTransaction(this.db, async (tx) => {
      const id = newObjectId();
      const [inserted] = await tx
        .insert(schema.catalogAgentTypes)
        .values({
          id,
          name: row.name,
          slug: row.slug,
          defaultPrompt: row.defaultPrompt,
          isActive: row.isActive,
        })
        .returning();
      await this.replaceSkills(tx, id, row.skills);
      return this.hydrate(inserted);
    });
  }

  async update(id: string, patch: Partial<Omit<NewAgentTypeRow, 'skills'>> & { skills?: string[] }): Promise<AgentTypeRow | null> {
    return withTransaction(this.db, async (tx) => {
      const { skills, ...columns } = patch;
      const [row] = await tx
        .update(schema.catalogAgentTypes)
        .set({ ...columns, updatedAt: new Date() })
        .where(eq(schema.catalogAgentTypes.id, id))
        .returning();
      if (!row) return null;
      if (skills) await this.replaceSkills(tx, id, skills);
      return this.hydrate(row);
    });
  }

  async delete(id: string): Promise<AgentTypeRow | null> {
    // Type, junction rows and prompts go in one statement each via cascade.
    const [row] = await this.q.delete(schema.catalogAgentTypes).where(eq(schema.catalogAgentTypes.id, id)).returning();
    return row
      ? { id: row.id, name: row.name, slug: row.slug, defaultPrompt: row.defaultPrompt ?? '', skills: [], isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt }
      : null;
  }

  async list(query: AgentTypeListQuery): Promise<{ rows: AgentTypeRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.search) conditions.push(ilike(schema.catalogAgentTypes.name, `%${escapeLike(query.search)}%`));
    if (query.isActive !== undefined) conditions.push(eq(schema.catalogAgentTypes.isActive, query.isActive));
    const filter = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [tally]] = await Promise.all([
      this.q
        .select()
        .from(schema.catalogAgentTypes)
        .where(filter)
        .orderBy(desc(schema.catalogAgentTypes.createdAt))
        .offset((query.page - 1) * query.limit)
        .limit(query.limit),
      this.q.select({ n: sql<number>`count(*)::int` }).from(schema.catalogAgentTypes).where(filter),
    ]);

    return { rows: await this.hydrateAll(rows), total: tally?.n ?? 0 };
  }

  async findAllActive(): Promise<AgentTypeRow[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogAgentTypes)
      .where(eq(schema.catalogAgentTypes.isActive, true))
      .orderBy(asc(schema.catalogAgentTypes.name));
    return this.hydrateAll(rows);
  }

  async findOrCreateBySlug(
    slug: string,
    data: { name: string; defaultPrompt: string; isActive: boolean },
  ): Promise<AgentTypeRow> {
    await this.q
      .insert(schema.catalogAgentTypes)
      .values({ id: newObjectId(), name: data.name, slug, defaultPrompt: data.defaultPrompt, isActive: data.isActive })
      .onConflictDoNothing({ target: schema.catalogAgentTypes.slug });
    const row = await this.findBySlug(slug);
    if (!row) throw new Error(`agent_type ${slug} vanished after upsert`);
    return row;
  }

  async promptCount(agentTypeId: string): Promise<number> {
    const [tally] = await this.q
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.catalogAgentTypePrompts)
      .where(eq(schema.catalogAgentTypePrompts.agentTypeId, agentTypeId));
    return tally?.n ?? 0;
  }

  async promptCountsFor(agentTypeIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (agentTypeIds.length === 0) return map;
    const rows = await this.q
      .select({ agentTypeId: schema.catalogAgentTypePrompts.agentTypeId, n: sql<number>`count(*)::int` })
      .from(schema.catalogAgentTypePrompts)
      .where(inArray(schema.catalogAgentTypePrompts.agentTypeId, agentTypeIds))
      .groupBy(schema.catalogAgentTypePrompts.agentTypeId);
    for (const row of rows) map.set(row.agentTypeId, row.n);
    return map;
  }

  async promptsFor(agentTypeId: string): Promise<AgentTypePromptRow[]> {
    const rows = await this.q
      .select()
      .from(schema.catalogAgentTypePrompts)
      .where(eq(schema.catalogAgentTypePrompts.agentTypeId, agentTypeId))
      .orderBy(asc(schema.catalogAgentTypePrompts.modelId));
    return rows.map(promptToRow);
  }

  async upsertPrompt(agentTypeId: string, modelId: string, prompt: string): Promise<AgentTypePromptRow> {
    const [row] = await this.q
      .insert(schema.catalogAgentTypePrompts)
      .values({ id: newObjectId(), agentTypeId, modelId, prompt })
      .onConflictDoUpdate({
        target: [schema.catalogAgentTypePrompts.agentTypeId, schema.catalogAgentTypePrompts.modelId],
        set: { prompt, updatedAt: new Date() },
      })
      .returning();
    return promptToRow(row);
  }

  async deletePrompt(agentTypeId: string, modelId: string): Promise<AgentTypePromptRow | null> {
    const [row] = await this.q
      .delete(schema.catalogAgentTypePrompts)
      .where(and(eq(schema.catalogAgentTypePrompts.agentTypeId, agentTypeId), eq(schema.catalogAgentTypePrompts.modelId, modelId)))
      .returning();
    return row ? promptToRow(row) : null;
  }

  async findPrompt(agentTypeId: string, modelId: string): Promise<AgentTypePromptRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.catalogAgentTypePrompts)
      .where(and(eq(schema.catalogAgentTypePrompts.agentTypeId, agentTypeId), eq(schema.catalogAgentTypePrompts.modelId, modelId)))
      .limit(1);
    return row ? promptToRow(row) : null;
  }

  async findPromptsForPairs(pairs: { agentTypeId: string; modelId: string }[]): Promise<AgentTypePromptRow[]> {
    if (pairs.length === 0) return [];
    const tuples = pairs.map((p) => sql`(${schema.catalogAgentTypePrompts.agentTypeId} = ${p.agentTypeId} AND ${schema.catalogAgentTypePrompts.modelId} = ${p.modelId})`);
    const rows = await this.q
      .select()
      .from(schema.catalogAgentTypePrompts)
      .where(sql.join(tuples, sql` OR `));
    return rows.map(promptToRow);
  }
}
