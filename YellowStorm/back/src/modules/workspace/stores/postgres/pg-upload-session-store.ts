import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable, withTransaction } from '@common/postgres/transaction';
import { UPLOAD_SESSION_STORE, type UploadSessionStore, type UploadSessionCreateInput, type UploadSessionRecord } from '../upload-session-store';

const SESSIONS = schema.uploadSessions;
const FILES = schema.uploadSessionFiles;

type SessionRow = typeof SESSIONS.$inferSelect;
type FileRow = typeof FILES.$inferSelect;

function toRecord(session: SessionRow, files: FileRow[]): UploadSessionRecord {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    userId: session.userId,
    status: session.status,
    files: files.map((f) => ({
      index: f.fileIndex,
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.size,
      documentId: f.documentId ?? undefined,
      uploadUrl: f.uploadUrl ?? undefined,
      status: f.status,
      progress: f.progress,
      error: f.error ?? undefined,
    })),
    totalFiles: session.totalFiles,
    totalSize: session.totalSize,
    completedFiles: session.completedFiles,
    failedFiles: session.failedFiles,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** PG shape: upload_sessions + upload_session_files child table (plan D.2). */
/** Upper bound on expired sessions swept per cleanup run. */
export const DEFAULT_EXPIRED_SESSION_LIMIT = 500;

@Injectable()
export class PgUploadSessionStore implements UploadSessionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async create(input: UploadSessionCreateInput): Promise<UploadSessionRecord> {
    return withTransaction(this.db, async (tx) => {
      const sessionId = newObjectId();
      const [session] = await tx
        .insert(SESSIONS)
        .values({
          id: sessionId,
          workspaceId: input.workspaceId,
          userId: input.userId,
          status: input.status,
          totalFiles: input.totalFiles,
          totalSize: input.totalSize,
          completedFiles: input.completedFiles,
          failedFiles: input.failedFiles,
          expiresAt: input.expiresAt,
        })
        .returning();
      const fileRows = await tx
        .insert(FILES)
        .values(
          input.files.map((f) => ({
            sessionId,
            fileIndex: f.index,
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.size,
            documentId: f.documentId,
            uploadUrl: f.uploadUrl,
            status: f.status,
            progress: f.progress,
          })),
        )
        .returning();
      return toRecord(session, fileRows);
    });
  }

  async findByIdWorkspaceUser(sessionId: string, workspaceId: string, userId: string): Promise<UploadSessionRecord | null> {
    const rows = await this.q
      .select()
      .from(SESSIONS)
      .where(and(eq(SESSIONS.id, sessionId), eq(SESSIONS.workspaceId, workspaceId), eq(SESSIONS.userId, userId)))
      .limit(1);
    if (!rows[0]) return null;
    const files = await this.q.select().from(FILES).where(eq(FILES.sessionId, sessionId)).orderBy(asc(FILES.fileIndex));
    return toRecord(rows[0], files);
  }

  async findExpired(now: Date, limit = DEFAULT_EXPIRED_SESSION_LIMIT): Promise<UploadSessionRecord[]> {
    const sessions = await this.q
      .select()
      .from(SESSIONS)
      .where(and(lt(SESSIONS.expiresAt, now), inArray(SESSIONS.status, ['pending', 'in_progress'])))
      .orderBy(asc(SESSIONS.expiresAt))
      .limit(limit);
    if (sessions.length === 0) return [];
    // One files query for the whole batch instead of one per session.
    const files = await this.q
      .select()
      .from(FILES)
      .where(inArray(FILES.sessionId, sessions.map((session) => session.id)))
      .orderBy(asc(FILES.sessionId), asc(FILES.fileIndex));
    const filesBySession = new Map<string, (typeof files)[number][]>();
    for (const file of files) {
      const bucket = filesBySession.get(file.sessionId) ?? [];
      bucket.push(file);
      filesBySession.set(file.sessionId, bucket);
    }
    return sessions.map((session) => toRecord(session, filesBySession.get(session.id) ?? []));
  }

  /** Single-row UPDATE on upload_session_files — the reason files are a child table. */
  async updateFileProgress(sessionId: string, fileIndex: number, patch: { status?: string; progress?: number; error?: string }): Promise<void> {
    const values: Partial<typeof FILES.$inferInsert> = {};
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.progress !== undefined) values.progress = patch.progress;
    if (patch.error !== undefined) values.error = patch.error;
    if (Object.keys(values).length === 0) return;
    await this.q.update(FILES).set(values).where(and(eq(FILES.sessionId, sessionId), eq(FILES.fileIndex, fileIndex)));
  }

  async setStatus(sessionId: string, status: string): Promise<void> {
    await this.q.update(SESSIONS).set({ status, updatedAt: new Date() }).where(eq(SESSIONS.id, sessionId));
  }

  async setOutcome(sessionId: string, outcome: { status: string; completedFiles: number; failedFiles: number }): Promise<void> {
    await this.q
      .update(SESSIONS)
      .set({ status: outcome.status, completedFiles: outcome.completedFiles, failedFiles: outcome.failedFiles, updatedAt: new Date() })
      .where(eq(SESSIONS.id, sessionId));
  }

  async markExpired(sessionId: string): Promise<void> {
    await this.q.update(SESSIONS).set({ status: 'expired', updatedAt: new Date() }).where(eq(SESSIONS.id, sessionId));
  }

  /** Child files cascade via FK ON DELETE CASCADE. */
  async deleteManyByWorkspace(workspaceId: string): Promise<void> {
    await this.q.delete(SESSIONS).where(eq(SESSIONS.workspaceId, workspaceId));
  }
}
