export type EvaluationMode =
  | 'informative'
  | 'corrective_transparent'
  | 'corrective_guarded';

export type CorrectionFailureBehavior =
  | 'publish_with_warning'
  | 'abstain'
  | 'require_human_review';

export interface ResponseCorrectionSettings {
  threshold: number;
  maxAttempts: number;
  maxDurationMs: number;
  allowAdditionalDocumentRetrieval: boolean;
  allowConnectorQueries: boolean;
  allowCalculationReruns: boolean;
  failureBehavior: CorrectionFailureBehavior;
  showOriginalAnswer: boolean;
}

export interface AdminEvaluationSettingsV2 {
  responseReliability: {
    enabled: boolean;
    mode: EvaluationMode;
    judgeModelId: string | null;
    maxConcurrentEvaluations: number;
    timeoutMs: number;
    maxFindings: number;
    correction: ResponseCorrectionSettings;
  };
}

export const DEFAULT_RESPONSE_CORRECTION_SETTINGS: ResponseCorrectionSettings = {
  threshold: 70,
  maxAttempts: 1,
  maxDurationMs: 60_000,
  allowAdditionalDocumentRetrieval: false,
  allowConnectorQueries: false,
  allowCalculationReruns: false,
  failureBehavior: 'publish_with_warning',
  showOriginalAnswer: true,
};
