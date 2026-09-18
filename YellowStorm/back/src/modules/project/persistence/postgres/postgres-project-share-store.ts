import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { countOver, pageOf } from '@common/postgres/pagination';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import type { PageRequest, ProjectShareCreateInput, ProjectShareStore } from '../project-share-store';
import { projectShareRowToRecord, type ProjectShareRecord } from '../project-record.mapper';

@Injectable()
export class PostgresProjectShareStore implements ProjectShareStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<ProjectShareRecord | null> {
    const rows = await this.q.select().from(schema.projectShares).where(eq(schema.projectShares.id, id)).limit(1);
    return rows[0] ? projectShareRowToRecord(rows[0]) : null;
  }

  async findOneByProjectAndUser(projectId: string, userId: string): Promise<ProjectShareRecord | null> {
    const rows = await this.q
      .select()
      .from(schema.projectShares)
      .where(
        and(eq(schema.projectShares.projectId, projectId), eq(schema.projectShares.sharedWithUserId, userId)),
      )
      .limit(1);
    return rows[0] ? projectShareRowToRecord(rows[0]) : null;
  }

  async existsForUser(projectId: string, userId: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: schema.projectShares.id })
      .from(schema.projectShares)
      .where(
        and(eq(schema.projectShares.projectId, projectId), eq(schema.projectShares.sharedWithUserId, userId)),
      )
      .limit(1);
    return rows.length > 0;
  }

  async findByProject(
    projectId: string,
    page: PageRequest,
  ): Promise<{ rows: ProjectShareRecord[]; total: number }> {
    const selected = await this.q
      .select({ share: schema.projectShares, total: countOver() })
      .from(schema.projectShares)
      .where(eq(schema.projectShares.projectId, projectId))
      .orderBy(desc(schema.projectShares.createdAt))
      .limit(page.limit)
      .offset(page.offset);
    const { items, total } = pageOf(selected);
    return { rows: items.map((r) => projectShareRowToRecord(r.share)), total };
  }

  async findByUser(userId: string, page: PageRequest): Promise<{ rows: ProjectShareRecord[]; total: number }> {
    const selected = await this.q
      .select({ share: schema.projectShares, total: countOver() })
      .from(schema.projectShares)
      .where(eq(schema.projectShares.sharedWithUserId, userId))
      .orderBy(desc(schema.projectShares.createdAt))
      .limit(page.limit)
      .offset(page.offset);
    const { items, total } = pageOf(selected);
    return { rows: items.map((r) => projectShareRowToRecord(r.share)), total };
  }

  async create(input: ProjectShareCreateInput): Promise<ProjectShareRecord> {
    const [row] = await this.q
      .insert(schema.projectShares)
      .values({
        id: input.id ?? newObjectId(),
        projectId: input.projectId,
        ownerId: input.ownerId,
        sharedWithUserId: input.sharedWithUserId,
        permission: input.permission,
        sharedBy: input.sharedBy,
      })
      .returning();
    return projectShareRowToRecord(row);
  }

  async updatePermission(id: string, permission: 'read' | 'readwrite'): Promise<ProjectShareRecord | null> {
    const [row] = await this.q
      .update(schema.projectShares)
      .set({ permission, updatedAt: new Date() })
      .where(eq(schema.projectShares.id, id))
      .returning();
    return row ? projectShareRowToRecord(row) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(schema.projectShares).where(eq(schema.projectShares.id, id));
  }

  async deleteByProject(projectId: string): Promise<number> {
    const rows = await this.q
      .delete(schema.projectShares)
      .where(eq(schema.projectShares.projectId, projectId))
      .returning({ id: schema.projectShares.id });
    return rows.length;
  }
}
