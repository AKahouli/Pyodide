import type { GovernanceDocumentEventRecord } from './governance-records';
import type { GovernanceDocumentEventType } from '../domain/governance-types';


export interface AppendGovernanceDocumentEventInput {
  programId: string;
  governanceDocumentId: string;
  documentId: string;
  eventType: GovernanceDocumentEventType;
  actorId?: string;
  actorEmail?: string;
  actorType?: 'user' | 'system' | 'integration';
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  correlationId?: string;
  causationId?: string;
  deduplicationKey?: string;
}

/** Append-only store for governance_document_events. */
export interface GovernanceEventStore {
  /** Insert; on a deduplication-key conflict returns the already-stored event. */
  append(input: AppendGovernanceDocumentEventInput): Promise<GovernanceDocumentEventRecord>;
  findByDeduplicationKey(governanceDocumentId: string, key: string): Promise<GovernanceDocumentEventRecord | null>;
  listByGovernanceDocument(governanceDocumentId: string): Promise<GovernanceDocumentEventRecord[]>;
}
