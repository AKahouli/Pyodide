import type { GovernanceDocumentRecord } from './governance-records';

export const GOVERNANCE_DOCUMENT_STORE = Symbol('GOVERNANCE_DOCUMENT_STORE');

export interface GovernanceDocumentUpsertInput {
  programId: string;
  documentId: string;
  workspaceId: string;
  validity: Record<string, unknown>;
  ownerUserId?: string;
  ownerScopeId?: string;
  integrationEvent?: { id: string; occurredAt: Date };
}

/** Fields a guarded update may write. `undefined` = leave unchanged. */
export interface GovernanceDocumentUpdateSet {
  status?: GovernanceDocumentRecord['status'];
  reviewComment?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  ownerUserId?: string | null;
  ownerScopeId?: string | null;
  validity?: Record<string, unknown>;
  workspaceId?: string;
  archivedAt?: Date;
  archivedBy?: string;
  archiveReason?: string | null;
  submittedForReviewBy?: string;
  submittedForReviewAt?: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  publishedBy?: string;
  publishedAt?: Date;
  lastIntegrationEventId?: string;
  lastIntegrationEventAt?: Date;
}

export interface GovernanceDocumentUpdate {
  set: GovernanceDocumentUpdateSet;
  /** Clears optional fields (Mongo `$unset`-equivalent). */
  unset?: Array<'archivedAt' | 'archivedBy' | 'archiveReason'>;
  bumpGovernanceRevision?: boolean;
  bumpTemporalDecisionRevision?: boolean;
}

export interface GovernanceDocumentUpdateGuard {
  governanceRevision?: number;
  temporalDecisionRevision?: number;
  statusEquals?: GovernanceDocumentRecord['status'];
  statusNotEquals?: GovernanceDocumentRecord['status'];
}

/**
 * Internal write/read store for the governance_documents aggregate. The
 * promoted `validity_next_review_at` / `validity_business_status` columns are
 * always written together with `validity` by the store implementations.
 */
export interface GovernanceDocumentStore {
  findByProgramAndDocumentId(programId: string, documentId: string): Promise<GovernanceDocumentRecord | null>;
  /** Insert-or-update keyed on (programId, documentId): $setOnInsert defaults + workspace refresh. */
  upsertFromWorkspace(input: GovernanceDocumentUpsertInput): Promise<GovernanceDocumentRecord>;
  listForProgramWorkspaces(programId: string, workspaceIds: string[], includeArchived: boolean): Promise<GovernanceDocumentRecord[]>;
  findById(id: string): Promise<GovernanceDocumentRecord | null>;
  updateGuarded(id: string, guard: GovernanceDocumentUpdateGuard, update: GovernanceDocumentUpdate): Promise<GovernanceDocumentRecord | null>;
  /** Integration-event deduplicated archive on workspace document deletion; null when already applied. */
  archiveFromWorkspaceDeletion(programId: string, documentId: string, actorId: string, event: { id: string; occurredAt: Date }): Promise<GovernanceDocumentRecord | null>;
  deleteByIdGuarded(id: string, expectedGovernanceRevision: number): Promise<boolean>;
  countByProgram(programId: string): Promise<number>;
  /** Scheduler selection: due documents, oldest review date first. */
  listDueForReview(now: Date, limit: number): Promise<GovernanceDocumentRecord[]>;
  /**
   * Optimistic review-due flip: sets `validity.businessStatus = 'needs_review'`
   * (with promoted column + governance revision bump) only when the stored
   * business status and next-review timestamp are still the observed values.
   * Returns false when another writer won the race (Mongo modifiedCount !== 1).
   */
  markNeedsReviewIfUnchanged(id: string, previousBusinessStatus: string | null | undefined, previousNextReviewAt: Date | undefined | null): Promise<boolean>;
  /** Knowledge recommendation apply: merges validity patch on a non-rejected/archived document. */
  patchValidityForDocument(programId: string, documentId: string, patch: { nextReviewAt: Date; reviewFrequencyDays: number }): Promise<GovernanceDocumentRecord | null>;
  /** Metadata candidate accept: sets `metadata.<key>` on a non-rejected/archived document. */
  setMetadataField(programId: string, documentId: string, key: string, value: unknown): Promise<GovernanceDocumentRecord | null>;
  /** Reconciliation scan: batches of documents by ascending id cursor. */
  listByIdCursor(programId: string, workspaceId: string, afterId: string | undefined, limit: number): Promise<GovernanceDocumentRecord[]>;
  /** Scope-tree cleanup: clears ownerScopeId on the scope's documents (revision bumped). */
  clearOwnerScopes(programId: string, scopeIds: string[]): Promise<void>;
  /** Knowledge assessment sweep: oldest-updated non-rejected/archived documents. */
  listNonArchived(limit: number): Promise<GovernanceDocumentRecord[]>;
}
