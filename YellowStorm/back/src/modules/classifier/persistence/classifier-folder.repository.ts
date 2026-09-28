import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { AssignmentSource, type ClassifierFolderRecord, type FolderCounts } from '../classifier.types';

const t = schema.classifierFolders;
const a = schema.classifierFileAssignments;

export interface CreateFolderInput {
  workspaceId: string;
  parentId: string | null;
  name: string;
  description: string;
  createdBy: string;
}

/** PostgreSQL classifier.folders repository (roadmap P6). Also owns the assignment side effects of deleting a folder. */
@Injectable()
export class ClassifierFolderRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<ClassifierFolderRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(t).where(eq(t.id, normalizeObjectId(id))).limit(1);
    return row ?? null;
  }

  /** Alphabetical by code point, like the Mongo default collation the API always had. */
  async listByWorkspace(workspaceId: string): Promise<ClassifierFolderRecord[]> {
    if (!isObjectId(workspaceId)) return [];
    return this.q
      .select()
      .from(t)
      .where(eq(t.workspaceId, normalizeObjectId(workspaceId)))
      .orderBy(sql`${t.name} COLLATE "C"`, asc(t.id));
  }

  /** Throws the unique violation of `uq_classifier_folders_location` when the name is taken at that location. */
  async create(input: CreateFolderInput): Promise<ClassifierFolderRecord> {
    const [row] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        workspaceId: normalizeObjectId(input.workspaceId),
        parentId: input.parentId ? normalizeObjectId(input.parentId) : null,
        name: input.name,
        description: input.description,
        createdBy: normalizeObjectId(input.createdBy),
      })
      .returning();
    return row;
  }

  async update(id: string, patch: { name?: string; description?: string }): Promise<ClassifierFolderRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(t)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        updatedAt: new Date(),
      })
      .where(eq(t.id, normalizeObjectId(id)))
      .returning();
    return row ?? null;
  }

  async setParent(id: string, parentId: string | null): Promise<ClassifierFolderRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(t)
      .set({ parentId: parentId ? normalizeObjectId(parentId) : null, updatedAt: new Date() })
      .where(eq(t.id, normalizeObjectId(id)))
      .returning();
    return row ?? null;
  }

  async nameTaken(workspaceId: string, parentId: string | null, name: string, excludeId?: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: t.id })
      .from(t)
      .where(and(
        eq(t.workspaceId, normalizeObjectId(workspaceId)),
        parentId ? eq(t.parentId, normalizeObjectId(parentId)) : isNull(t.parentId),
        eq(t.name, name),
        excludeId ? ne(t.id, normalizeObjectId(excludeId)) : undefined,
      ))
      .limit(1);
    return rows.length > 0;
  }

  /** Every folder below `rootId`, at any depth. UNION (not UNION ALL) so a corrupt cycle cannot loop forever. */
  async descendantIds(rootId: string): Promise<string[]> {
    if (!isObjectId(rootId)) return [];
    const result = await this.q.execute<{ id: string }>(sql`
      WITH RECURSIVE tree(id) AS (
        SELECT f.id FROM classifier.folders f WHERE f.parent_id = ${normalizeObjectId(rootId)}
        UNION
        SELECT f.id FROM classifier.folders f JOIN tree ON f.parent_id = tree.id
      )
      SELECT id FROM tree
    `);
    return result.rows.map((row) => row.id);
  }

  /**
   * Deletes a folder and its sub-folders (the foreign key cascades). The files that were mapped to
   * any of them go back to unassigned, in the same transaction. Returns how many sub-folders went with it.
   */
  async deleteWithDescendants(id: string): Promise<number> {
    if (!isObjectId(id)) return 0;
    const rootId = normalizeObjectId(id);
    return withTransaction(this.db, async () => {
      const descendants = await this.descendantIds(rootId);
      await this.q
        .update(a)
        .set({ folderId: null, assignmentSource: AssignmentSource.MANUAL, updatedAt: new Date() })
        .where(inArray(a.folderId, [rootId, ...descendants]));
      await this.q.delete(t).where(eq(t.id, rootId));
      return descendants.length;
    });
  }

  async computeCounts(workspaceId: string, folderIds: string[]): Promise<Map<string, FolderCounts>> {
    const result = new Map<string, FolderCounts>(folderIds.map((id) => [id, { childCount: 0, fileCount: 0 }]));
    if (!isObjectId(workspaceId) || folderIds.length === 0) return result;
    const workspace = normalizeObjectId(workspaceId);
    const [childCounts, fileCounts] = await Promise.all([
      this.q
        .select({ id: t.parentId, count: sql<number>`count(*)::int` })
        .from(t)
        .where(and(eq(t.workspaceId, workspace), inArray(t.parentId, folderIds)))
        .groupBy(t.parentId),
      this.q
        .select({ id: a.folderId, count: sql<number>`count(*)::int` })
        .from(a)
        .where(and(eq(a.workspaceId, workspace), inArray(a.folderId, folderIds)))
        .groupBy(a.folderId),
    ]);
    for (const row of childCounts) {
      const entry = row.id ? result.get(row.id) : undefined;
      if (entry) entry.childCount = row.count;
    }
    for (const row of fileCounts) {
      const entry = row.id ? result.get(row.id) : undefined;
      if (entry) entry.fileCount = row.count;
    }
    return result;
  }
}
