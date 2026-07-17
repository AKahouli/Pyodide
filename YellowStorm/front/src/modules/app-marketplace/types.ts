export interface DeployedApp {
  sessionId: string;
  title: string;
  deployedUrl: string;
  lastDeployedAt: string | null;
}

export interface ListDeployedAppsResponse {
  items: DeployedApp[];
}
