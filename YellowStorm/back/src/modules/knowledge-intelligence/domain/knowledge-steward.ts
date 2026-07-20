export type AssessmentStatus = 'pass' | 'warning' | 'fail' | 'unknown';
export type KnowledgeHealthStatus = 'healthy' | 'warning' | 'critical';
export type KnowledgePriority = 'critical' | 'high' | 'medium' | 'low';
export type KnowledgeRecommendationType =
  | 'assign_owner'
  | 'schedule_review'
  | 'confirm_validity'
  | 'resolve_conflict'
  | 'enrich_metadata'
  | 'add_synonyms'
  | 'merge_duplicate'
  | 'reindex'
  | 'change_scope'
  | 'exclude_from_runtime';

export interface AssessmentFactor {
  code: string;
  contribution: number;
  message: string;
  evidenceRefs?: string[];
}

export interface AssessmentDimension {
  score: number;
  status: AssessmentStatus;
  factors: AssessmentFactor[];
}

export interface KnowledgeAssessmentDimensions {
  businessValidity: AssessmentDimension;
  freshness: AssessmentDimension;
  availability: AssessmentDimension;
  integrity: AssessmentDimension;
  searchQuality: AssessmentDimension;
  governanceQuality: AssessmentDimension;
}

export interface KnowledgeAssessmentContext {
  source: {
    id: string;
    title: string;
    sourceType: string;
    status: string;
    visibility: string;
    scopeIds: string[];
    ownerUserId?: string;
    reviewFrequencyDays?: number;
    metadata: Record<string, unknown>;
  };
  version: {
    id: string;
    lifecycleStatus: string;
    technicalStatus: string;
    contentHash?: string;
    documentId?: string;
    canonicalUrl?: string;
    capturedAt: Date;
    extractedMetadata: Record<string, unknown>;
    validity: {
      mode: string;
      businessStatus: string;
      effectiveUntil?: Date;
      lastReviewedAt?: Date;
      nextReviewAt?: Date;
      reviewFrequencyDays?: number;
      evidence?: unknown[];
    };
  };
  now: Date;
}

export interface KnowledgeEvaluator {
  readonly key: keyof KnowledgeAssessmentDimensions;
  evaluate(context: KnowledgeAssessmentContext): Promise<AssessmentDimension>;
}
