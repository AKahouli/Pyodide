export type SourceValidityMode = 'fixed_date' | 'relative_duration' | 'until_replaced' | 'until_funds_exhausted' | 'open_ended' | 'unknown';
export type SourceBusinessValidityStatus = 'unknown' | 'scheduled' | 'valid' | 'needs_review' | 'expired' | 'conflicting' | 'suspended';

export interface SourceValidityEvidence {
  id: string;
  field: 'effectiveFrom' | 'effectiveUntil' | 'publishedAt' | 'modifiedAt' | 'validityMode';
  value?: unknown;
  origin: 'manual' | 'technical_metadata' | 'document_metadata';
  documentId?: string;
  page?: number;
  sectionId?: string;
  blockId?: string;
  excerpt?: string;
  confidence: number;
  validatedBy?: string;
  validatedAt?: Date;
}

export interface SourceValidity {
  mode: SourceValidityMode;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
  inclusiveEnd?: boolean;
  businessStatus: SourceBusinessValidityStatus;
  lastReviewedAt?: Date;
  nextReviewAt?: Date;
  reviewFrequencyDays?: number;
  confidence: number;
  evidence: SourceValidityEvidence[];
  manuallyOverridden: boolean;
}

export const DEFAULT_UNKNOWN_VALIDITY: SourceValidity = Object.freeze({
  mode: 'unknown', businessStatus: 'unknown', confidence: 0, evidence: [], manuallyOverridden: false,
});
