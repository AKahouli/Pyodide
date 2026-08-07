export interface ListSessionsParams {
  limit?: number;
  cursor?: string | null;
  q?: string;
}

export type DeployStatus = 'idle' | 'deploying' | 'deployed' | 'error';

export interface DeployState {
  deployStatus: DeployStatus;
  deployedUrl: string | null;
  lastDeployedAt: string | null;
}

export interface CreateSessionResponse {
  sessionId: string;
  workspaceIds: string[];
}
