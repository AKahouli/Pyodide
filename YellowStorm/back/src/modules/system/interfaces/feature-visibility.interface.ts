export interface FeatureVisibility {
  conversation: boolean;
  workspace: boolean;
  playbook: boolean;
  governance: boolean;
  appMarketplace: boolean;
  worky: boolean;
  agents: boolean;
  platformCopilot: boolean;
}

export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibility = {
  conversation: true,
  workspace: true,
  playbook: true,
  governance: true,
  appMarketplace: true,
  worky: true,
  agents: true,
  platformCopilot: false,
};
