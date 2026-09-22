export type DeployedAppSource = 'owned' | 'shared';

export type AppBuilderTab = 'all' | 'deployed' | 'shared' | 'draft';

export type AppCatalogItem =
  | { kind: 'deployed'; app: DeployedApp }
  | { kind: 'draft'; app: DraftApp };

export type DraftDeployStatus = 'idle' | 'deploying' | 'error';

export interface AppRevisionCatalogFields {
  lastDeployedRevisionId: string | null;
  latestFinalizedRevisionId: string | null;
  latestFinalizedAt: string | null;
  finalizedVersionCount: number;
}

export interface DeployedApp extends AppRevisionCatalogFields {
  sessionId: string;
  title: string;
  deployedUrl: string;
  lastDeployedAt: string | null;
  source: DeployedAppSource;
  shareId: string | null;
  /** Shared recipients may open the conversation when the share included it. */
  canOpenConversation?: boolean;
  /** App integrates Approach B AI features (yellowmind-ai / AI proxy). */
  hasAiFeatures?: boolean;
}

export interface DraftApp extends AppRevisionCatalogFields {
  sessionId: string;
  title: string;
  lastUpdatedAt: string;
  deployStatus: DraftDeployStatus;
  /** App integrates Approach B AI features (yellowmind-ai / AI proxy). */
  hasAiFeatures?: boolean;
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
  useAi: boolean;
}

export interface AppEndUserSummary {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'disabled';
  grants: AppEndUserGrants;
  createdAt: string;
}
