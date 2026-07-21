export interface WorkspaceTransformationSettingsValue {
  decisionFlowAgentId: string | null;
}

export interface WorkspaceTransformationSettings extends WorkspaceTransformationSettingsValue {
  updatedAt?: Date;
}

export interface WorkspaceTransformationAgentOption {
  id: string;
  name: string;
  description?: string;
  agentTypeName?: string;
  model?: string;
}
