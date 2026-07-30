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
  document: {
    id: string;
    workspaceId: string;
    originalName: string;
    mimeType: string;
    type: string;
    sourceUrl?: string;
    contentHash?: string;
    status: string;
    indexingStatus: string;
    updatedAt: Date;
    metadata: Record<string, unknown>;
  };
  governance: {
    status: string;
    validity: {
      mode: string;
      businessStatus: string;
      effectiveUntil?: Date;
      lastReviewedAt?: Date;
      nextReviewAt?: Date;
      reviewFrequencyDays?: number;
      evidence?: unknown[];
    };
    tags: string[];
    metadata: Record<string, unknown>;
    ownerUserId?: string;
    ownerScopeId?: string;
  };
  binding: {
    visibility: string;
    scopeIds: string[];
    ingestionMode: string;
  };
  now: Date;
}

export interface KnowledgeEvaluator {
  readonly key: keyof KnowledgeAssessmentDimensions;
  evaluate(context: KnowledgeAssessmentContext): Promise<AssessmentDimension>;
}
