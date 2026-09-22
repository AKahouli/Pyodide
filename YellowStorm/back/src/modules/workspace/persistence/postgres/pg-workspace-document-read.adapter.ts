import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { escapeLike } from '@common/postgres/like';
import { resolveQueryable } from '@common/postgres/transaction';
import type { DocumentFilter, DocumentFindOptions } from '../../ports/document-filter';
import type { WorkspaceDocumentRecord } from '../../ports/workspace-records';

const DOCUMENTS = schema.workspaceDocuments;

/** True when the filter carries an explicit empty id list and can match nothing. */
export function documentFilterMatchesNothing(filter: DocumentFilter): boolean {
  return (filter.ids !== undefined && filter.ids.length === 0)
    || (filter.workspaceIds !== undefined && filter.workspaceIds.length === 0);
}

/** Shared drizzle translation of the typed DocumentFilter (Step D PG side). */
export function documentFilterToWhere(filter: DocumentFilter) {
  const conditions = [];
  if (filter.id) conditions.push(eq(DOCUMENTS.id, filter.id));
  if (filter.workspaceId) conditions.push(eq(DOCUMENTS.workspaceId, filter.workspaceId));
  // An explicit empty list means "match nothing", never "no filter".
  if (filter.workspaceIds) conditions.push(filter.workspaceIds.length ? inArray(DOCUMENTS.workspaceId, filter.workspaceIds) : sql`false`);
  if (filter.ids) conditions.push(filter.ids.length ? inArray(DOCUMENTS.id, filter.ids) : sql`false`);
  if (filter.status) conditions.push(eq(DOCUMENTS.status, filter.status));
  if (filter.indexingStatus) conditions.push(eq(DOCUMENTS.indexingStatus, filter.indexingStatus));
  if (filter.indexingStartedBefore) conditions.push(lt(DOCUMENTS.indexingStartedAt, filter.indexingStartedBefore));
  if (filter.parentId) conditions.push(eq(DOCUMENTS.parentId, filter.parentId));
  // Parity contract (see DocumentFilter.isFolder): false → is_folder = false.
  if (filter.isFolder !== undefined) conditions.push(eq(DOCUMENTS.isFolder, filter.isFolder));
  if (filter.type) conditions.push(eq(DOCUMENTS.type, filter.type));
  if (filter.originalName) conditions.push(eq(DOCUMENTS.originalName, filter.originalName));
  if (filter.originalNameSearch) conditions.push(ilike(DOCUMENTS.originalName, `%${escapeLike(filter.originalNameSearch)}%`));
  if (filter.afterId) conditions.push(gt(DOCUMENTS.id, filter.afterId));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function documentRowToRecord(row: typeof DOCUMENTS.$inferSelect): WorkspaceDocumentRecord {
  return {
    id: row.id,
    filename: row.filename ?? undefined,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    path: row.path ?? undefined,
    url: row.url ?? undefined,
    contentHash: row.contentHash ?? undefined,
    workspaceId: row.workspaceId,
    createdBy: row.createdBy,
    status: row.status,
    uploadedAt: row.uploadedAt ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    metadata: row.metadata ? { ...(row.metadata as Record<string, string>) } : undefined,
    indexingStatus: row.indexingStatus,
    indexingError: row.indexingError ?? undefined,
    indexingTaskName: row.indexingTaskName ?? undefined,
    indexingTaskId: row.indexingTaskId ?? undefined,
    indexingAttemptId: row.indexingAttemptId ?? undefined,
    indexingAttemptStartedAt: row.indexingAttemptStartedAt ?? undefined,
    indexingAttemptCompletedAt: row.indexingAttemptCompletedAt ?? undefined,
    lastIndexedAt: row.lastIndexedAt ?? undefined,
    indexingStartedAt: row.indexingStartedAt ?? undefined,
    detected_language: row.detectedLanguage ?? undefined,
    chunk_size: row.chunkSize ?? undefined,
    parentId: row.parentId ?? undefined,
    isFolder: row.isFolder,
    folderName: row.folderName ?? undefined,
    type: row.type,
    sourceUrl: row.sourceUrl ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgWorkspaceDocumentReadAdapter {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findById(id: string): Promise<WorkspaceDocumentRecord | null> {
    const rows = await this.q.select().from(DOCUMENTS).where(eq(DOCUMENTS.id, id)).limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async findOne(filter: DocumentFilter): Promise<WorkspaceDocumentRecord | null> {
    if (documentFilterMatchesNothing(filter)) return null;
    const rows = await this.q.select().from(DOCUMENTS).where(documentFilterToWhere(filter)).limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async find(filter: DocumentFilter, opts: DocumentFindOptions = {}): Promise<WorkspaceDocumentRecord[]> {
    if (documentFilterMatchesNothing(filter)) return [];
    let query = this.q.select().from(DOCUMENTS).where(documentFilterToWhere(filter)).$dynamic();
    if (opts.sort?.field === 'id') query = query.orderBy(opts.sort.direction === 'asc' ? asc(DOCUMENTS.id) : desc(DOCUMENTS.id));
    else if (opts.sort?.field === 'createdAt') query = query.orderBy(opts.sort.direction === 'asc' ? asc(DOCUMENTS.createdAt) : desc(DOCUMENTS.createdAt));
    else query = query.orderBy(desc(DOCUMENTS.createdAt));
    if (opts.skip) query = query.offset(opts.skip);
    if (opts.limit) query = query.limit(opts.limit);
    const rows = await query;
    return rows.map(documentRowToRecord);
  }

  async countDocuments(filter: DocumentFilter): Promise<number> {
    if (documentFilterMatchesNothing(filter)) return 0;
    const rows = await this.q.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(DOCUMENTS).where(documentFilterToWhere(filter));
    return rows[0]?.n ?? 0;
  }

  async exists(filter: DocumentFilter): Promise<boolean> {
    if (documentFilterMatchesNothing(filter)) return false;
    const rows = await this.q.select({ id: DOCUMENTS.id }).from(DOCUMENTS).where(documentFilterToWhere(filter)).limit(1);
    return rows.length > 0;
  }
}
