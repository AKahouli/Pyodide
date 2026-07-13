import type { SourceValidityEvidence, SourceValidityMode } from './source-validity';

export type TemporalCandidateField = 'effectiveFrom' | 'effectiveUntil' | 'publishedAt' | 'modifiedAt' | 'validityMode';
export type TemporalInterpretation = 'business_start' | 'business_end' | 'application_deadline' | 'publication_date' | 'document_revision_date' | 'relative_duration' | 'until_replaced' | 'until_funds_exhausted' | 'unknown';
export type TemporalCriticality = 'low' | 'medium' | 'high';

export interface TemporalCandidate { candidateId: string; field: TemporalCandidateField; value?: string; mode?: SourceValidityMode; interpretation: TemporalInterpretation; confidence: number; evidenceRefs: string[]; reasoningSummary: string; criticality: TemporalCriticality; }
export interface TemporalValidationIssue { code: string; severity: 'warning' | 'blocking'; message: string; }
export interface TemporalValidationResult { status: 'accepted_candidate' | 'ambiguous' | 'conflicting' | 'rejected'; normalizedCandidate?: TemporalCandidate; issues: TemporalValidationIssue[]; }
export interface TemporalValidationContext { evidence: SourceValidityEvidence[]; confidenceThreshold?: number; relativeDurationAnchor?: string; reviewFrequencyDays?: number; }
