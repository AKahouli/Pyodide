export type DeployedAppSource = 'owned' | 'shared';

export interface DeployedApp {
  sessionId: string;
  title: string;
  deployedUrl: string;
  lastDeployedAt: string | null;
  source: DeployedAppSource;
  shareId: string | null;
  /** Shared recipients may open the conversation when the share included it. */
  canOpenConversation?: boolean;
}

export interface ListDeployedAppsResponse {
  items: DeployedApp[];
}
