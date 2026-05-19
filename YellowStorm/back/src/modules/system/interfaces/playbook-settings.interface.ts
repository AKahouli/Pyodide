export type SuggestionMode = 'auto' | 'manual';

export interface AdminPlaybookSettings {
  inferenceModelId: string | null;
  advisorEvaluationModelId: string | null;
  nodeSuggestionsMode: SuggestionMode;
  approvalSuggestionMode: SuggestionMode;
}

export const DEFAULT_ADMIN_PLAYBOOK_SETTINGS: AdminPlaybookSettings = {
  inferenceModelId: null,
  advisorEvaluationModelId: null,
  nodeSuggestionsMode: 'manual',
  approvalSuggestionMode: 'auto',
};
