export interface CopilotAssistantSettingsValue {
  agentId: string | null;
}

export interface CopilotAssistantSettings extends CopilotAssistantSettingsValue {
  updatedAt?: Date;
}

export interface CopilotAssistantAgentOption {
  id: string;
  name: string;
  description?: string;
  agentTypeName?: string;
  model?: string;
}

export const DEFAULT_COPILOT_ASSISTANT_SETTINGS: CopilotAssistantSettingsValue = {
  agentId: null,
};
