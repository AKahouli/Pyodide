export type DeployedAppSource = 'owned' | 'shared';

export type AppBuilderTab = 'deployed' | 'shared' | 'draft';

export type DraftDeployStatus = 'idle' | 'deploying' | 'error';

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

export interface DraftApp {
  sessionId: string;
  title: string;
  lastUpdatedAt: string;
  deployStatus: DraftDeployStatus;
}

export interface AppBuilderCatalog {
  deployed: DeployedApp[];
  shared: DeployedApp[];
  drafts: DraftApp[];
}

export interface ListAppBuilderAppsResponse {
  deployed: DeployedApp[];
  shared: DeployedApp[];
  drafts: DraftApp[];
}

export interface AppEndUserGrants {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
}

export interface AppEndUserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'disabled';
  grants: AppEndUserGrants;
  createdAt: string;
}
