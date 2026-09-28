import type { ValidityEvidence } from '@modules/governance/domain/document-validity';
import type { TemporalCandidate, TemporalValidationResult } from '@modules/governance/domain/temporal-candidate';
import type {
  KnowledgeAssessmentDimensions,
  KnowledgeHealthStatus,
  KnowledgePriority,
  KnowledgeRecommendationType,
} from './domain/knowledge-steward';

/**
 * Plain shapes of the governance.knowledge_* rows (types only since the P6
 * PostgreSQL cutover). Ids are 24-hex strings; optional fields are absent, not
 * null, so the serialized shape matches what the Mongoose documents produced.
 */
export type KnowledgeAlertStatus = 'open' | 'acknowledged' | 'resolved' | 'ignored';
export type KnowledgeAlertCategory = 'validity' | 'freshness' | 'availability' | 'integrity' | 'governance' | 'search_quality' | 'impact';
export type KnowledgeExtractionJobType = 'technical_metadata' | 'temporal_extraction' | 'metadata_enrichment';
export type KnowledgeExtractionJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type KnowledgeRecommendationStatus = 'proposed' | 'accepted' | 'rejected' | 'applied' | 'superseded';
export type MetadataCandidateStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';
export type TemporalCandidateDecisionStatus = 'pending' | 'processing' | 'confirmed' | 'corrected' | 'rejected';

export interface KnowledgeAlertRecord {
  id: string;
  programId: string;
  scopeIds: string[];
  documentId?: string;
  category: KnowledgeAlertCategory;
  severity: KnowledgePriority;
  status: KnowledgeAlertStatus;
  title: string;
  description: string;
  deduplicationKey: string;
  evidenceRefs: string[];
  openedAt: Date;
  resolvedAt?: Date;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeAssessmentRecord {
  id: string;
  programId: string;
  scopeIds: string[];
  documentId: string;
  assessmentVersion: string;
  inputHash: string;
  assessedAt: Date;
  dimensions: KnowledgeAssessmentDimensions;
  overallHealthScore: number;
  status: KnowledgeHealthStatus;
  summary: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeExtractionJobRecord {
  id: string;
  programId: string;
  documentId: string;
  connectorId: string;
  requestedByUserId?: string;
  jobType: KnowledgeExtractionJobType;
  status: KnowledgeExtractionJobStatus;
  inputHash: string;
  engineVersion: string;
  attempts: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  leaseExpiresAt?: Date;
  leaseToken?: string;
  nextAttemptAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeRecommendationRecord {
  id: string;
  programId: string;
  scopeIds: string[];
  documentId?: string;
  alertIds: string[];
  type: KnowledgeRecommendationType;
  priority: KnowledgePriority;
  reason: string;
  impactSummary: string;
  proposedAction?: Record<string, unknown>;
  status: KnowledgeRecommendationStatus;
  deduplicationKey: string;
  decidedBy?: string;
  decidedAt?: Date;
  decisionReason?: string;
  appliedBy?: string;
  appliedAt?: Date;
  applicationToken?: string;
  applicationLeaseExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetadataCandidateRecord {
  id: string;
  programId: string;
  scopeIds: string[];
  documentId: string;
  key: string;
  proposedValue: unknown;
  candidateType: 'document' | 'business' | 'search';
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  evidenceRefs: string[];
  status: MetadataCandidateStatus;
  candidateKey: string;
  acceptedValue?: unknown;
  decidedBy?: string;
  decidedAt?: Date;
  decisionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemporalCandidateRecordRecord {
  id: string;
  programId: string;
  documentId: string;
  jobId: string;
  candidateId: string;
  candidate: TemporalCandidate;
  validation: TemporalValidationResult;
  evidence: ValidityEvidence[];
  decisionStatus: TemporalCandidateDecisionStatus;
  decisionLeaseExpiresAt?: Date;
  decisionToken?: string;
  decidedBy?: string;
  decidedAt?: Date;
  decisionComment?: string;
  correctedCandidate?: TemporalCandidate;
  inputHash: string;
  engineVersion: string;
  createdAt: Date;
  updatedAt: Date;
}
