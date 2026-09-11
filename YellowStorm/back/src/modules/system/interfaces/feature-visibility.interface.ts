export interface FeatureVisibility {
  conversation: boolean;
  workspace: boolean;
  playbook: boolean;
  governance: boolean;
  appMarketplace: boolean;
  worky: boolean;
  agents: boolean;
  semanticModel: boolean;
  platformCopilot: boolean;
  playbookDevtools: boolean;
  playbookDeltaAutosave: boolean;
  playbookMcpAssistant: boolean;
  playbookMcpConnectorReconciliation: boolean;
  governedConversations: boolean;
  governanceScopeAudience: boolean;
  governedScopeCarousel: boolean;
  dataRoomDecisionFlows: boolean;
  dataRoomGovernance: boolean;
  dataRoomSourceVersioning: boolean;
  dataRoomWorkspaceEvents: boolean;
  dataRoomAutoSourceCreation: boolean;
  dataRoomOutboxDispatch: boolean;
  dataRoomValidityIntelligence: boolean;
  dataRoomKnowledgeAssessment: boolean;
}

export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibility = {
  conversation: true,
  workspace: true,
  playbook: true,
  governance: true,
  appMarketplace: true,
  worky: true,
  agents: true,
  semanticModel: true,
  platformCopilot: false,
  playbookDevtools: false,
  playbookDeltaAutosave: true,
  playbookMcpAssistant: true,
  playbookMcpConnectorReconciliation: true,
  governedConversations: true,
  governanceScopeAudience: true,
  governedScopeCarousel: true,
  dataRoomDecisionFlows: true,
  dataRoomGovernance: true,
  dataRoomSourceVersioning: true,
  dataRoomWorkspaceEvents: true,
  dataRoomAutoSourceCreation: true,
  dataRoomOutboxDispatch: true,
  dataRoomValidityIntelligence: true,
  dataRoomKnowledgeAssessment: true,
};
