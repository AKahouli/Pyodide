export type DeployedAppSource = 'owned' | 'shared';

export interface DeployedApp {
  sessionId: string;
  title: string;
  deployedUrl: string;
  lastDeployedAt: string | null;
  source: DeployedAppSource;
  shareId: string | null;
}

export interface ListDeployedAppsResponse {
  items: DeployedApp[];
}
