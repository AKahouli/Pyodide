import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { countOver, isObjectId, newObjectId, normalizeObjectId, pageOf } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { ClassificationRunStatus, type ClassificationRunRecord } from '../classifier.types';

const t = schema.classifierRuns;

type Row = typeof t.$inferSelect;

function toRecord(row: Row): ClassificationRunRecord {
  return { ...row, status: row.status as ClassificationRunStatus };
}

export interface RunStatusPatch {
  status?: ClassificationRunStatus;
  playbookExecutionId?: string;
  classifiedFiles?: number;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

/** PostgreSQL classifier.runs repository (roadmap P6). */
@Injectable()
export class ClassificationRunRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(input: { workspaceId: string; playbookId: string; hint: string | null; overwriteExisting: boolean; totalFiles: number; triggeredBy: string }): Promise<ClassificationRunRecord> {
    const [row] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        workspaceId: normalizeObjectId(input.workspaceId),
        status: ClassificationRunStatus.QUEUED,
        playbookId: normalizeObjectId(input.playbookId),
        hint: input.hint,
        overwriteExisting: input.overwriteExisting,
        totalFiles: input.totalFiles,
        classifiedFiles: 0,
        triggeredBy: normalizeObjectId(input.triggeredBy),
      })
      .returning();
    return toRecord(row);
  }

  async findById(id: string): Promise<ClassificationRunRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(t).where(eq(t.id, normalizeObjectId(id))).limit(1);
    return row ? toRecord(row) : null;
  }

  /** Newest first; `page` starts at 1. */
  async listByWorkspace(workspaceId: string, page: number, limit: number): Promise<{ items: ClassificationRunRecord[]; total: number }> {
    if (!isObjectId(workspaceId)) return { items: [], total: 0 };
    const workspace = normalizeObjectId(workspaceId);
    const offset = (page - 1) * limit;
    const rows = await this.q
      .select({ run: t, total: countOver() })
      .from(t)
      .where(eq(t.workspaceId, workspace))
      .orderBy(desc(t.createdAt), desc(t.id))
      .limit(limit)
      .offset(offset);
    const { items, total } = await pageOf(
      rows.map(({ run, total: count }) => ({ run: toRecord(run), total: count })),
      {
        offset,
        count: async () => {
          const [row] = await this.q.select({ count: sql<number>`count(*)::int` }).from(t).where(eq(t.workspaceId, workspace));
          return row?.count ?? 0;
        },
      },
    );
    return { items: items.map((item) => item.run), total };
  }

  async updateStatus(id: string, patch: RunStatusPatch): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(t)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(t.id, normalizeObjectId(id)));
  }
}
