import type { AdminPlaybookSettings, SuggestionMode } from '../../system/interfaces/playbook-settings.interface';

export type PlaybookSuggestionMode = SuggestionMode | 'inherit';

export interface PlaybookDesignSettings {
  inferenceModelId: string | null;
  nodeSuggestionsMode: PlaybookSuggestionMode;
  approvalSuggestionMode: PlaybookSuggestionMode;
}

export interface EffectivePlaybookDesignSettings extends AdminPlaybookSettings {
  resolvedInferenceModelId: string | null;
}

export const DEFAULT_PLAYBOOK_DESIGN_SETTINGS: PlaybookDesignSettings = {
  inferenceModelId: null,
  nodeSuggestionsMode: 'inherit',
  approvalSuggestionMode: 'inherit',
};
