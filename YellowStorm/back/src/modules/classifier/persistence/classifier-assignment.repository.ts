import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isForeignKeyViolation, isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { AssignmentSource, type ClassifierAssignmentRecord } from '../classifier.types';

const t = schema.classifierFileAssignments;

type Row = typeof t.$inferSelect;

function toRecord(row: Row): ClassifierAssignmentRecord {
  return { ...row, assignmentSource: row.assignmentSource as AssignmentSource };
}

export interface PlaybookAssignmentInput {
  workspaceId: string;
  documentId: string;
  folderId: string;
  runId: string;
  assignedBy: string;
  overwrite: boolean;
}

/** PostgreSQL classifier.file_assignments repository (roadmap P6). One row per (workspace, document). */
@Injectable()
export class ClassifierAssignmentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async listByWorkspace(workspaceId: string): Promise<ClassifierAssignmentRecord[]> {
    if (!isObjectId(workspaceId)) return [];
    const rows = await this.q.select().from(t).where(eq(t.workspaceId, normalizeObjectId(workspaceId)));
    return rows.map(toRecord);
  }

  /** Files of the workspace that already sit in a folder. */
  async countClassified(workspaceId: string): Promise<number> {
    if (!isObjectId(workspaceId)) return 0;
    const [row] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(t)
      .where(and(eq(t.workspaceId, normalizeObjectId(workspaceId)), isNotNull(t.folderId)));
    return row?.count ?? 0;
  }

  /** Files a person moves by hand: creates or overwrites the row and forgets any earlier run. */
  async upsertManual(input: { workspaceId: string; documentId: string; folderId: string | null; assignedBy: string }): Promise<ClassifierAssignmentRecord> {
    const workspaceId = normalizeObjectId(input.workspaceId);
    const documentId = normalizeObjectId(input.documentId);
    const folderId = input.folderId ? normalizeObjectId(input.folderId) : null;
    const assignedBy = normalizeObjectId(input.assignedBy);
    const [row] = await this.q
      .insert(t)
      .values({ id: newObjectId(), workspaceId, documentId, folderId, assignmentSource: AssignmentSource.MANUAL, classificationRunId: null, assignedBy })
      .onConflictDoUpdate({
        target: [t.workspaceId, t.documentId],
        set: { folderId, assignmentSource: AssignmentSource.MANUAL, assignedBy, classificationRunId: null, updatedAt: new Date() },
      })
      .returning();
    return toRecord(row);
  }

  /**
   * One result of a playbook run. A file that is not in a folder yet is always classified; one that
   * already is only when `overwrite` is set. Returns whether the row changed. An entry that points at
   * a folder or document that no longer exists is skipped instead of failing the whole batch.
   */
  async applyPlaybookResult(input: PlaybookAssignmentInput): Promise<boolean> {
    const workspaceId = normalizeObjectId(input.workspaceId);
    const documentId = normalizeObjectId(input.documentId);
    const folderId = normalizeObjectId(input.folderId);
    const runId = normalizeObjectId(input.runId);
    const assignedBy = normalizeObjectId(input.assignedBy);
    try {
      // Own transaction (a savepoint inside a caller's): a rejected entry must not poison an outer one.
      const rows = await withTransaction(this.db, () => this.q
        .insert(t)
        .values({ id: newObjectId(), workspaceId, documentId, folderId, assignmentSource: AssignmentSource.PLAYBOOK, classificationRunId: runId, assignedBy })
        .onConflictDoUpdate({
          target: [t.workspaceId, t.documentId],
          set: { folderId, assignmentSource: AssignmentSource.PLAYBOOK, assignedBy, classificationRunId: runId, updatedAt: new Date() },
          setWhere: input.overwrite ? undefined : isNull(t.folderId),
        })
        .returning({ id: t.id }));
      return rows.length > 0;
    } catch (error) {
      if (isForeignKeyViolation(error)) return false;
      throw error;
    }
  }
}
