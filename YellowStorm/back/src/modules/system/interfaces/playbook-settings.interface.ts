export type SuggestionMode = 'auto' | 'manual';

export interface PlaybookIntentNormalizationLimits {
  maxWorkflowPlanChanges: number;
  maxInputPorts: number;
  maxOutputPorts: number;
  maxIteratorBodySteps: number;
  maxIteratorBodyEdges: number;
}

export interface AdminPlaybookSettings {
  inferenceModelId: string | null;
  advisorEvaluationModelId: string | null;
  replayEvaluationModelId: string | null;
  nodeSuggestionsMode: SuggestionMode;
  approvalSuggestionMode: SuggestionMode;
  intentNormalizationLimits: PlaybookIntentNormalizationLimits;
  replayEligibilityConfidenceThreshold: number;
}

export const DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS: PlaybookIntentNormalizationLimits = {
  maxWorkflowPlanChanges: 500,
  maxInputPorts: 4,
  maxOutputPorts: 4,
  maxIteratorBodySteps: 12,
  maxIteratorBodyEdges: 50,
};

export const DEFAULT_ADMIN_PLAYBOOK_SETTINGS: AdminPlaybookSettings = {
  inferenceModelId: null,
  advisorEvaluationModelId: null,
  replayEvaluationModelId: null,
  nodeSuggestionsMode: 'manual',
  approvalSuggestionMode: 'auto',
  intentNormalizationLimits: DEFAULT_PLAYBOOK_INTENT_NORMALIZATION_LIMITS,
  replayEligibilityConfidenceThreshold: 70,
};
