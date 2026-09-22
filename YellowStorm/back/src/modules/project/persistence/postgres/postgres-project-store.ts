import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { escapeLike } from '@common/postgres/like';
import { resolveQueryable } from '@common/postgres/transaction';
import type { ProjectPatch, ProjectStore, ProjectOneFilter } from '../project-store';
import { projectRowToRecord, type ProjectRecord } from '../project-record.mapper';

@Injectable()
export class PostgresProjectStore implements ProjectStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const rows = await this.q.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
    return rows[0] ? projectRowToRecord(rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<Map<string, ProjectRecord>> {
    const map = new Map<string, ProjectRecord>();
    if (ids.length === 0) return map;
    const rows = await this.q.select().from(schema.projects).where(inArray(schema.projects.id, ids));
    for (const row of rows) map.set(row.id, projectRowToRecord(row));
    return map;
  }

  async findOne(filter: ProjectOneFilter): Promise<ProjectRecord | null> {
    const conditions = [eq(schema.projects.name, filter.name), eq(schema.projects.createdBy, filter.createdBy)];
    if (filter.excludeId) conditions.push(ne(schema.projects.id, filter.excludeId));
    const rows = await this.q
      .select()
      .from(schema.projects)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ? projectRowToRecord(rows[0]) : null;
  }

  async findByOwner(createdBy: string, search?: string): Promise<ProjectRecord[]> {
    const conditions = [eq(schema.projects.createdBy, createdBy)];
    if (search) conditions.push(ilike(schema.projects.name, `%${escapeLike(search)}%`));
    const rows = await this.q
      .select()
      .from(schema.projects)
      .where(and(...conditions))
      .orderBy(desc(schema.projects.createdAt));
    return rows.map(projectRowToRecord);
  }

  async create(input: { name: string; createdBy: string }): Promise<ProjectRecord> {
    const [row] = await this.q
      .insert(schema.projects)
      .values({ id: newObjectId(), name: input.name, createdBy: input.createdBy })
      .returning();
    return projectRowToRecord(row);
  }

  async updateById(id: string, patch: ProjectPatch): Promise<ProjectRecord | null> {
    // No-op patch keeps updatedAt untouched (Mongoose save() parity).
    if (Object.keys(patch).length === 0) return this.findById(id);
    const rows = await this.q
      .update(schema.projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.projects.id, id))
      .returning();
    return rows.length > 0 ? projectRowToRecord(rows[0]) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(schema.projects).where(eq(schema.projects.id, id));
  }

  async existsOwnedBy(id: string, createdBy: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.createdBy, createdBy)))
      .limit(1);
    return rows.length > 0;
  }

  async existsPublic(id: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(and(eq(schema.projects.id, id), eq(schema.projects.isPublic, true)))
      .limit(1);
    return rows.length > 0;
  }

  async incrementShareCount(id: string, delta: number): Promise<void> {
    await this.q
      .update(schema.projects)
      .set({ shareCount: sql`${schema.projects.shareCount} + ${delta}`, updatedAt: new Date() })
      .where(eq(schema.projects.id, id));
  }
}
