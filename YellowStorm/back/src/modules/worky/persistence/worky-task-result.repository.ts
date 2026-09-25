import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, isUniqueViolation, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyTaskResultRecord } from '../worky.types';

const t = schema.workyTaskResults;

export interface NewWorkyTaskResult {
  taskId: string;
  status: string;
  summary: string;
  payload: Record<string, unknown> | null;
  contentArtifactId: string | null;
  createdByWorkerId: string | null;
}

/** A concurrent writer may take the version between the read and the insert; the retry reads it again. */
const MAX_VERSION_ATTEMPTS = 5;

/** PostgreSQL worky.task_results repository (roadmap P7). */
@Injectable()
export class WorkyTaskResultRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /**
   * Stores the result as the task's next version. The unique (task, version) index settles a race:
   * the loser sees a unique violation and takes the version after the winner's.
   */
  async append(input: NewWorkyTaskResult): Promise<WorkyTaskResultRecord> {
    const taskId = normalizeObjectId(input.taskId);
    for (let attempt = 1; ; attempt += 1) {
      try {
        // The INSERT numbers the version itself, so a clash needs two writers in the same instant.
        // (Inside an ambient transaction a unique violation aborts it: call this outside one.)
        const [row] = await this.q
          .insert(t)
          .values({
            id: newObjectId(),
            taskId,
            version: sql`(SELECT coalesce(max(v.version), 0) + 1 FROM worky.task_results v WHERE v.task_id = ${taskId})`,
            status: input.status,
            summary: stripNul(input.summary),
            payload: input.payload ? stripNul(input.payload) : null,
            contentArtifactId: input.contentArtifactId ? normalizeObjectId(input.contentArtifactId) : null,
            createdByWorkerId: input.createdByWorkerId ? normalizeObjectId(input.createdByWorkerId) : null,
          })
          .returning();
        return row;
      } catch (err) {
        if (!isUniqueViolation(err, 'uq_worky_task_results_version') || attempt >= MAX_VERSION_ATTEMPTS) throw err;
      }
    }
  }

  /** The task's results, newest version first. */
  async listForTask(taskId: string): Promise<WorkyTaskResultRecord[]> {
    if (!isObjectId(taskId)) return [];
    return this.q.select().from(t).where(eq(t.taskId, normalizeObjectId(taskId))).orderBy(desc(t.version));
  }
}
