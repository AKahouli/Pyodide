import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { resolveQueryable } from '@common/postgres/transaction';
import type { IndexingStatePatch } from '../../ports/workspace-document-write.port';

const DOCUMENTS = schema.workspaceDocuments;

/**
 * PG implementation of the indexing write port. Unlike the Mongo adapter
 * (read-modify-save), this is a single UPDATE: keys present in the patch with
 * an undefined value SET the column to NULL (the PG rendering of "cleared"),
 * defined values SET the column, absent keys are untouched — the same contract,
 * expressed natively.
 */
@Injectable()
export class PgWorkspaceDocumentWriteAdapter {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async updateIndexingState(id: string, patch: IndexingStatePatch): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    // patch key -> table property (two legacy snake_case names differ from the drizzle property)
    const keyMap: Record<string, string> = {
      status: 'status',
      indexingStatus: 'indexingStatus',
      indexingError: 'indexingError',
      indexingTaskName: 'indexingTaskName',
      indexingTaskId: 'indexingTaskId',
      indexingAttemptId: 'indexingAttemptId',
      indexingAttemptStartedAt: 'indexingAttemptStartedAt',
      indexingAttemptCompletedAt: 'indexingAttemptCompletedAt',
      indexingStartedAt: 'indexingStartedAt',
      lastIndexedAt: 'lastIndexedAt',
      detected_language: 'detectedLanguage',
      chunk_size: 'chunkSize',
      filename: 'filename',
    };
    for (const [patchKey, column] of Object.entries(keyMap)) {
      if (!Object.prototype.hasOwnProperty.call(patch, patchKey)) continue;
      const value = patch[patchKey as keyof IndexingStatePatch];
      set[column] = value === undefined ? null : value;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'metadata')) {
      set.metadata = patch.metadata ?? null;
    }
    if (Object.keys(set).length === 1) return; // only updatedAt — nothing to write
    await this.q.update(DOCUMENTS).set(set).where(eq(DOCUMENTS.id, id));
  }
}
