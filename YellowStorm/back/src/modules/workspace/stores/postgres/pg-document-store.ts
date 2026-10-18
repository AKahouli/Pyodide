import { ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { escapeLike } from '@common/postgres/like';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable, withTransaction } from '@common/postgres/transaction';
import { documentRowToRecord } from '../../persistence/postgres/pg-workspace-document-read.adapter';
import { DOCUMENT_STORE, type DocumentStore, type DocumentCreateInput, type DocumentUpdatePatch, type DocumentListParams, type FolderDuplicateProbe, type WorkspaceDocumentListParams } from '../document-store';
import type { WorkspaceDocumentRecord } from '../../ports/workspace-records';

const DOCUMENTS = schema.workspaceDocuments;

function documentOrderClause(col: string | undefined, direction: 'asc' | 'desc'): SQL {
  const column =
    col === 'originalName' ? DOCUMENTS.originalName : col === 'filename' ? DOCUMENTS.filename : col === 'updatedAt' ? DOCUMENTS.updatedAt : DOCUMENTS.createdAt;
  return direction === 'asc' ? asc(column) : desc(column);
}

@Injectable()
export class PgDocumentStore implements DocumentStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async listPendingAssetCleanup(workspaceId: string, actorId?: string): Promise<WorkspaceDocumentRecord[]> {
    const rows = await this.q.select().from(DOCUMENTS).where(and(eq(DOCUMENTS.workspaceId, workspaceId),
      actorId ? eq(DOCUMENTS.createdBy, actorId) : undefined, sql`${DOCUMENTS.metadata}->>'assetDeletedAt' IS NOT NULL`,
      sql`(${DOCUMENTS.metadata}->>'assetBlobCleanup' IS DISTINCT FROM 'done' OR ${DOCUMENTS.metadata}->>'assetIndexCleanup' IS DISTINCT FROM 'done')`))
      .orderBy(desc(DOCUMENTS.updatedAt), desc(DOCUMENTS.id)).limit(50);
    return rows.map(documentRowToRecord);
  }

  async getAssetRevocationState(workspaceId: string): Promise<{ epoch: string | null; cleanupPending: boolean }> {
    const [row] = await this.q.select({
      count: sql<number>`count(*)`.mapWith(Number), latest: sql<string | null>`max(${DOCUMENTS.metadata}->>'assetDeletedAt')`,
      pending: sql<boolean>`coalesce(bool_or(${DOCUMENTS.metadata}->>'assetBlobCleanup' IS DISTINCT FROM 'done'), false)`,
    }).from(DOCUMENTS).where(and(eq(DOCUMENTS.workspaceId, workspaceId), sql`${DOCUMENTS.metadata}->>'assetDeletedAt' IS NOT NULL`));
    return { epoch: row?.count ? `${row.count}:${row.latest}` : null, cleanupPending: row?.pending ?? false };
  }

  private get q() {
    return resolveQueryable(this.db);
  }

  async create(input: DocumentCreateInput): Promise<WorkspaceDocumentRecord> {
    return withTransaction(this.db, async () => {
      if (!input.isFolder && input.size > 0) await this.assertStorageCapacity(input.workspaceId, input.size);
      const rows = await this.q
        .insert(DOCUMENTS)
        .values({
          id: input.id ?? newObjectId(),
          filename: input.filename,
          originalName: input.originalName,
          mimeType: input.mimeType,
          size: input.size,
          path: input.path,
          url: input.url,
          contentHash: input.contentHash,
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          status: input.status,
          uploadedAt: input.uploadedAt,
          indexingStatus: input.indexingStatus,
          parentId: input.parentId ?? null,
          isFolder: input.isFolder ?? false,
          folderName: input.folderName,
          type: input.type,
          sourceUrl: input.sourceUrl,
          metadata: input.metadata,
        })
        .returning();
      return documentRowToRecord(rows[0]);
    });
  }

  /** Pending document rows reserve capacity before any blob is written. */
  private async assertStorageCapacity(workspaceId: string, additionalSize: number): Promise<void> {
    // A workspace row lock serializes admission across every process and uploader.
    const [workspace] = await this.q.select().from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId)).for('update');
    if (!workspace) throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    const [usage] = await this.q.select({
      pending: sql<number>`coalesce(sum(case when ${DOCUMENTS.status} in ('pending', 'uploading') then ${DOCUMENTS.size} else 0 end), 0)`.mapWith(Number),
      completed: sql<number>`coalesce(sum(case when ${DOCUMENTS.status} not in ('pending', 'uploading') then ${DOCUMENTS.size} else 0 end), 0)`.mapWith(Number),
    }).from(DOCUMENTS).where(and(eq(DOCUMENTS.workspaceId, workspaceId), eq(DOCUMENTS.isFolder, false),
      sql`${DOCUMENTS.metadata}->>'assetDeletedAt' IS NULL`));
    // Completion updates the row before the legacy counter. The maximum covers
    // that interval without counting completed bytes twice.
    const available = workspace.allocatedStorage - Math.max(workspace.usedStorage, usage.completed) - usage.pending;
    if (additionalSize > available) throw new ForbiddenException(
      ErrorCode.WORKSPACE_STORAGE_QUOTA_EXCEEDED,
      `Insufficient storage. Available: ${Math.max(0, Math.round(available / 1048576))}MB`,
    );
  }

  async findById(id: string): Promise<WorkspaceDocumentRecord | null> {
    const rows = await this.q.select().from(DOCUMENTS).where(eq(DOCUMENTS.id, id)).limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async findByIdAndWorkspace(id: string, workspaceId: string): Promise<WorkspaceDocumentRecord | null> {
    const rows = await this.q
      .select()
      .from(DOCUMENTS)
      .where(and(eq(DOCUMENTS.id, id), eq(DOCUMENTS.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async findByIds(ids: string[]): Promise<WorkspaceDocumentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.q.select().from(DOCUMENTS).where(inArray(DOCUMENTS.id, ids));
    return rows.map(documentRowToRecord);
  }

  async findByIdsInWorkspace(workspaceId: string, ids: string[]): Promise<WorkspaceDocumentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.q
      .select()
      .from(DOCUMENTS)
      .where(and(inArray(DOCUMENTS.id, ids), eq(DOCUMENTS.workspaceId, workspaceId)));
    return rows.map(documentRowToRecord);
  }

  async originalNameExists(workspaceId: string, originalName: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: DOCUMENTS.id })
      .from(DOCUMENTS)
      .where(and(eq(DOCUMENTS.workspaceId, workspaceId), eq(DOCUMENTS.originalName, originalName), eq(DOCUMENTS.isFolder, false)))
      .limit(1);
    return rows.length > 0;
  }

  async findFileByName(workspaceId: string, originalName: string): Promise<WorkspaceDocumentRecord | null> {
    const rows = await this.q
      .select()
      .from(DOCUMENTS)
      .where(and(eq(DOCUMENTS.workspaceId, workspaceId), eq(DOCUMENTS.originalName, originalName), eq(DOCUMENTS.isFolder, false)))
      .limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async findFolderDuplicate(probe: FolderDuplicateProbe): Promise<WorkspaceDocumentRecord | null> {
    const conditions = [
      eq(DOCUMENTS.workspaceId, probe.workspaceId),
      eq(DOCUMENTS.createdBy, probe.createdBy),
      eq(DOCUMENTS.isFolder, true),
      eq(DOCUMENTS.folderName, probe.folderName),
      probe.parentId === null ? isNull(DOCUMENTS.parentId) : eq(DOCUMENTS.parentId, probe.parentId),
    ];
    if (probe.excludeId) conditions.push(ne(DOCUMENTS.id, probe.excludeId));
    const rows = await this.q.select().from(DOCUMENTS).where(and(...conditions)).limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async findChildFolderIds(parentId: string): Promise<string[]> {
    const rows = await this.q
      .select({ id: DOCUMENTS.id })
      .from(DOCUMENTS)
      .where(and(eq(DOCUMENTS.parentId, parentId), eq(DOCUMENTS.isFolder, true)));
    return rows.map((r) => r.id);
  }

  async withWorkspaceTreeLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return withTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`workspace-tree:${workspaceId}`}))`);
      return fn();
    });
  }

  async findDirectChildren(parentId: string, workspaceId: string): Promise<WorkspaceDocumentRecord[]> {
    const rows = await this.q
      .select()
      .from(DOCUMENTS)
      .where(and(eq(DOCUMENTS.parentId, parentId), eq(DOCUMENTS.workspaceId, workspaceId)));
    return rows.map(documentRowToRecord);
  }

  async findAllByWorkspaceId(workspaceId: string): Promise<WorkspaceDocumentRecord[]> {
    const rows = await this.q.select().from(DOCUMENTS).where(eq(DOCUMENTS.workspaceId, workspaceId));
    return rows.map(documentRowToRecord);
  }

  async listByWorkspace(workspaceId: string, params: WorkspaceDocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }> {
    const { status, search, parentId, sortBy, sortOrder, skip, limit } = params;
    const conditions = [eq(DOCUMENTS.workspaceId, workspaceId), sql`${DOCUMENTS.metadata}->>'assetDeletedAt' IS NULL`];
    if (status) conditions.push(eq(DOCUMENTS.status, status));
    // undefined = all levels; null = root level (parity with the Mongo query).
    if (parentId === null) conditions.push(isNull(DOCUMENTS.parentId));
    else if (parentId !== undefined) conditions.push(eq(DOCUMENTS.parentId, parentId));
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(or(ilike(DOCUMENTS.originalName, pattern), ilike(DOCUMENTS.folderName, pattern),
        ilike(sql`${DOCUMENTS.metadata}->>'assetDisplayName'`, pattern))!);
    }
    const where = and(...conditions);
    const [rows, countRows] = await Promise.all([
      this.q
        .select()
        .from(DOCUMENTS)
        .where(where)
        .orderBy(desc(DOCUMENTS.isFolder), documentOrderClause(sortBy, sortOrder))
        .offset(skip)
        .limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(DOCUMENTS).where(where),
    ]);
    return { items: rows.map(documentRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async listByWorkspaces(workspaceIds: string[], params: DocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }> {
    if (workspaceIds.length === 0) return { items: [], total: 0 };
    const { status, search, searchFilename, sortBy, sortOrder, skip, limit } = params;
    const conditions = [inArray(DOCUMENTS.workspaceId, workspaceIds), sql`${DOCUMENTS.metadata}->>'assetDeletedAt' IS NULL`];
    if (status) conditions.push(eq(DOCUMENTS.status, status));
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(
        or(ilike(DOCUMENTS.originalName, pattern), ilike(sql`${DOCUMENTS.metadata}->>'assetDisplayName'`, pattern),
          ...(searchFilename ? [ilike(DOCUMENTS.filename, pattern)] : []))!,
      );
    }
    const where = and(...conditions);
    const [rows, countRows] = await Promise.all([
      this.q.select().from(DOCUMENTS).where(where).orderBy(documentOrderClause(sortBy, sortOrder)).offset(skip).limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(DOCUMENTS).where(where),
    ]);
    return { items: rows.map(documentRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async listFolders(workspaceId: string): Promise<WorkspaceDocumentRecord[]> {
    const rows = await this.q
      .select()
      .from(DOCUMENTS)
      .where(and(eq(DOCUMENTS.workspaceId, workspaceId), eq(DOCUMENTS.isFolder, true), eq(DOCUMENTS.status, 'completed')))
      .orderBy(asc(DOCUMENTS.originalName));
    return rows.map(documentRowToRecord);
  }

  async listFolderContents(workspaceId: string, folderId: string, params: DocumentListParams): Promise<{ items: WorkspaceDocumentRecord[]; total: number }> {
    const { search, sortBy, sortOrder, skip, limit } = params;
    const conditions = [
      eq(DOCUMENTS.workspaceId, workspaceId),
      eq(DOCUMENTS.parentId, folderId),
      sql`${DOCUMENTS.metadata}->>'assetDeletedAt' IS NULL`,
      eq(DOCUMENTS.status, 'completed'),
    ];
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(or(ilike(DOCUMENTS.originalName, pattern), ilike(DOCUMENTS.folderName, pattern),
        ilike(sql`${DOCUMENTS.metadata}->>'assetDisplayName'`, pattern))!);
    }
    const where = and(...conditions);
    const [rows, countRows] = await Promise.all([
      this.q
        .select()
        .from(DOCUMENTS)
        .where(where)
        .orderBy(desc(DOCUMENTS.isFolder), documentOrderClause(sortBy, sortOrder))
        .offset(skip)
        .limit(limit),
      this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(DOCUMENTS).where(where),
    ]);
    return { items: rows.map(documentRowToRecord), total: countRows[0]?.n ?? 0 };
  }

  async findUrlSources(workspaceId: string): Promise<Pick<WorkspaceDocumentRecord, 'id' | 'sourceUrl' | 'status' | 'indexingStatus'>[]> {
    const rows = await this.q
      .select({ id: DOCUMENTS.id, sourceUrl: DOCUMENTS.sourceUrl, status: DOCUMENTS.status, indexingStatus: DOCUMENTS.indexingStatus })
      .from(DOCUMENTS)
      .where(and(eq(DOCUMENTS.workspaceId, workspaceId), eq(DOCUMENTS.type, 'url'), isNotNull(DOCUMENTS.sourceUrl)));
    return rows.map((r) => ({ ...r, sourceUrl: r.sourceUrl ?? undefined }));
  }

  async updateById(id: string, patch: DocumentUpdatePatch): Promise<WorkspaceDocumentRecord | null> {
    return withTransaction(this.db, async () => {
      if (patch.size !== undefined) {
        const existing = await this.findById(id);
        if (!existing) return null;
        await this.q.select({ id: schema.workspaces.id }).from(schema.workspaces)
          .where(eq(schema.workspaces.id, existing.workspaceId)).for('update');
        const current = await this.findById(id);
        if (!current) return null;
        if (!current.isFolder && patch.size > current.size) {
          await this.assertStorageCapacity(current.workspaceId, patch.size - current.size);
        }
      }
      const values: Record<string, unknown> = {};
      for (const key of ['filename', 'originalName', 'path', 'url', 'contentHash', 'size', 'status', 'errorMessage', 'folderName', 'metadata', 'indexingStatus', 'indexingError', 'uploadedAt'] as const) {
        if (patch[key] !== undefined) values[key] = patch[key];
      }
      if (Object.keys(values).length === 0) return this.findById(id);
      values.updatedAt = new Date();
      const rows = await this.q
        .update(DOCUMENTS)
        .set(values as Partial<typeof DOCUMENTS.$inferInsert>)
        .where(eq(DOCUMENTS.id, id))
        .returning();
      return rows[0] ? documentRowToRecord(rows[0]) : null;
    });
  }


  async mergeMetadata(workspaceId: string, documentId: string, patch: Record<string, string>): Promise<void> {
    await this.q
      .update(DOCUMENTS)
      .set({
        metadata: sql`coalesce(${DOCUMENTS.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(and(eq(DOCUMENTS.id, documentId), eq(DOCUMENTS.workspaceId, workspaceId)));
  }

  async markUploaded(id: string, fields: { status: string; uploadedAt: Date; url?: string; metadata?: Record<string, string> }): Promise<WorkspaceDocumentRecord | null> {
    return withTransaction(this.db, async () => {
      const existing = await this.findById(id);
      if (!existing) return null;
      await this.q.select({ id: schema.workspaces.id }).from(schema.workspaces)
        .where(eq(schema.workspaces.id, existing.workspaceId)).for('update');
      const [updated] = await this.q.update(DOCUMENTS).set({ ...fields, updatedAt: new Date() })
        .where(and(eq(DOCUMENTS.id, id), eq(DOCUMENTS.status, 'pending'))).returning();
      if (!updated) return null; // Another completion already owns accounting/events.
      await this.q.update(schema.workspaces).set({
        usedStorage: sql`${schema.workspaces.usedStorage} + ${updated.size}`,
        documentCount: sql`${schema.workspaces.documentCount} + 1`, updatedAt: new Date(),
      }).where(eq(schema.workspaces.id, updated.workspaceId));
      return documentRowToRecord(updated);
    });
  }

  async renameOriginalName(id: string, originalName: string): Promise<WorkspaceDocumentRecord | null> {
    return this.updateById(id, { originalName });
  }

  async renameFolder(id: string, folderName: string): Promise<WorkspaceDocumentRecord | null> {
    return this.updateById(id, { originalName: folderName, folderName });
  }

  async setParent(id: string, parentId: string | null): Promise<void> {
    await this.q
      .update(DOCUMENTS)
      .set({ parentId, updatedAt: new Date() })
      .where(eq(DOCUMENTS.id, id));
  }

  async withUploadingDocument<T>(id: string, action: () => Promise<T>): Promise<T> {
    return withTransaction(this.db, async () => {
      const [row] = await this.q.select({ id: DOCUMENTS.id }).from(DOCUMENTS)
        .where(and(eq(DOCUMENTS.id, id), eq(DOCUMENTS.status, 'uploading'))).for('update');
      if (!row) throw new NotFoundException(ErrorCode.WORKSPACE_DOCUMENT_NOT_FOUND, 'Upload reservation no longer exists');
      return action();
    });
  }

  async deleteAbandonedDirectUploads(createdBefore: Date): Promise<WorkspaceDocumentRecord[]> {
    return withTransaction(this.db, async () => {
      const abandoned = await this.q.select({ id: DOCUMENTS.id }).from(DOCUMENTS)
        .where(and(eq(DOCUMENTS.status, 'uploading'), eq(DOCUMENTS.isFolder, false),
          sql`${DOCUMENTS.createdAt} < ${createdBefore}`)).limit(100).for('update', { skipLocked: true });
      if (!abandoned.length) return [];
      const deleted = await this.q.delete(DOCUMENTS).where(inArray(DOCUMENTS.id, abandoned.map(row => row.id))).returning();
      return deleted.map(documentRowToRecord);
    });
  }

  async findExpiredPendingUploads(now: Date, legacyCreatedBefore: Date): Promise<WorkspaceDocumentRecord[]> {
    const rows = await this.q.select().from(DOCUMENTS).where(and(
      eq(DOCUMENTS.status, 'pending'), eq(DOCUMENTS.isFolder, false),
      or(
        sql`${DOCUMENTS.metadata}->>'uploadExpiresAt' <= ${now.toISOString()}`,
        and(sql`${DOCUMENTS.metadata}->>'uploadExpiresAt' IS NULL`, sql`${DOCUMENTS.createdAt} < ${legacyCreatedBefore}`),
      ),
    ));
    return rows.map(documentRowToRecord);
  }

  async deletePendingUpload(id: string, workspaceId: string): Promise<WorkspaceDocumentRecord | null> {
    const [deleted] = await this.q.delete(DOCUMENTS).where(and(eq(DOCUMENTS.id, id),
      eq(DOCUMENTS.workspaceId, workspaceId), eq(DOCUMENTS.status, 'pending'))).returning();
    return deleted ? documentRowToRecord(deleted) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(DOCUMENTS).where(eq(DOCUMENTS.id, id));
  }

  async deleteByIdAndWorkspace(id: string, workspaceId: string): Promise<void> {
    await this.q.delete(DOCUMENTS).where(and(eq(DOCUMENTS.id, id), eq(DOCUMENTS.workspaceId, workspaceId)));
  }

  async deleteManyByWorkspace(workspaceId: string): Promise<number> {
    const rows = await this.q.delete(DOCUMENTS).where(eq(DOCUMENTS.workspaceId, workspaceId)).returning({ id: DOCUMENTS.id });
    return rows.length;
  }
}
