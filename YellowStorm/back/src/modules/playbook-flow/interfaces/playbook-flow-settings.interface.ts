import type { AdminPlaybookSettings } from '../../system/interfaces/playbook-settings.interface';

export type FlowSettingsSuggestionMode = 'auto' | 'manual' | 'inherit';

export interface FlowDesignSettings {
  inferenceModelId: string | null;
  nodeSuggestionsMode: FlowSettingsSuggestionMode;
  approvalSuggestionMode: FlowSettingsSuggestionMode;
  recursionLimit: number;
  maxParallelism: number;
}

export interface EffectiveFlowDesignSettings extends AdminPlaybookSettings {
  resolvedInferenceModelId: string | null;
  recursionLimit: number;
  maxParallelism: number;
}

export const DEFAULT_FLOW_DESIGN_SETTINGS: FlowDesignSettings = {
  inferenceModelId: null,
  nodeSuggestionsMode: 'inherit',
  approvalSuggestionMode: 'inherit',
  recursionLimit: 25,
  maxParallelism: 5,
};

export interface UpdateFlowDesignSettingsDto {
  inferenceModelId?: string;
  nodeSuggestionsMode?: FlowSettingsSuggestionMode;
  approvalSuggestionMode?: FlowSettingsSuggestionMode;
  recursionLimit?: number;
  maxParallelism?: number;
}
