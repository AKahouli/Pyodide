export type DocumentValidityMode = 'fixed_date' | 'relative_duration' | 'until_replaced' | 'until_funds_exhausted' | 'open_ended' | 'unknown';
export type DocumentBusinessValidityStatus = 'unknown' | 'scheduled' | 'valid' | 'needs_review' | 'expired' | 'conflicting' | 'suspended';
export type ValidityEvidenceOrigin = 'manual' | 'technical_metadata' | 'http_header' | 'html_metadata' | 'structured_data' | 'document_metadata' | 'logical_search' | 'llm_extraction' | 'policy';

export interface ValidityEvidence {
  id: string;
  field: 'effectiveFrom' | 'effectiveUntil' | 'publishedAt' | 'modifiedAt' | 'validityMode';
  value?: unknown;
  origin: ValidityEvidenceOrigin;
  documentId: string;
  page?: number;
  sectionId?: string;
  blockId?: string;
  excerpt?: string;
  confidence: number;
  validatedBy?: string;
  validatedAt?: Date;
  extractionMethod?: string;
  capturedAt?: Date;
  isCritical?: boolean;
  supersedesEvidenceId?: string;
}

export interface DocumentValidity {
  mode: DocumentValidityMode;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  inclusiveEnd?: boolean;
  businessStatus: DocumentBusinessValidityStatus;
  lastReviewedAt?: Date;
  nextReviewAt?: Date;
  reviewFrequencyDays?: number;
  confidence: number;
  evidence: ValidityEvidence[];
  manuallyOverridden: boolean;
}

export const DEFAULT_UNKNOWN_VALIDITY: DocumentValidity = Object.freeze({
  mode: 'unknown',
  businessStatus: 'unknown',
  confidence: 0,
  evidence: [],
  manuallyOverridden: false,
});
