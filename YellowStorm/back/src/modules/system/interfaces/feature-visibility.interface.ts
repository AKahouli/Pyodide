export interface FeatureVisibility {
  conversation: boolean;
  workspace: boolean;
  playbook: boolean;
  governance: boolean;
  appBuilder: boolean;
  worky: boolean;
  agents: boolean;
  semanticModel: boolean;
  platformCopilot: boolean;
}

export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibility = {
  conversation: true,
  workspace: true,
  playbook: true,
  governance: true,
  appBuilder: true,
  worky: true,
  agents: true,
  semanticModel: true,
  platformCopilot: false,
};
