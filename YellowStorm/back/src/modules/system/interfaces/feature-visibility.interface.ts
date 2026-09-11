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
  governedConversations: boolean;
  governedScopeCarousel: boolean;
  dataRoomDecisionFlows: boolean;
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
  governedConversations: true,
  governedScopeCarousel: true,
  dataRoomDecisionFlows: true,
};
