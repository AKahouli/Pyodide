import type { DocumentFilter } from './document-filter';


/**
 * Field patch for the indexing pipeline's document mutations. NOTE: never pass
 * undefined for `status` or `indexingStatus` — both columns are NOT NULL in PG
 * (present-undefined would violate the constraint rather than reset to default).
 * Semantics match
 * Mongoose instance assignment: keys PRESENT with an undefined value clear the
 * field; keys ABSENT are left untouched; `metadata` (when present) replaces
 * the whole object. The store persists via save() (Mongo adapter) so validators
 * and timestamps keep their old behavior.
 */
export interface IndexingStatePatch {
  status?: string | undefined;
  indexingStatus?: string | undefined;
  indexingError?: string | undefined;
  indexingTaskName?: string | undefined;
  indexingTaskId?: string | undefined;
  indexingAttemptId?: string | undefined;
  indexingAttemptStartedAt?: Date | undefined;
  indexingAttemptCompletedAt?: Date | undefined;
  indexingStartedAt?: Date | undefined;
  lastIndexedAt?: Date | undefined;
  detected_language?: string | undefined;
  chunk_size?: number | undefined;
  metadata?: Record<string, string>;
  filename?: string | undefined;
}

export interface WorkspaceDocumentWritePort {
  /** Read-modify-write single document. No-op when the document is gone. */
  updateIndexingState(id: string, patch: IndexingStatePatch): Promise<void>;
}
