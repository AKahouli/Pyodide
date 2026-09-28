import type { DecisionFlowGenerationOptions } from '../interfaces/workspace-artifact.interface';
import type { DecisionFlowPayload } from '../interfaces/decision-flow.interface';

export interface WorkspaceArtifactUsage {
  inputTokens: number;
  outputTokens: number;
  model?: string;
}

export interface WorkspaceArtifactGeneration {
  agentId: string;
  requestedBy: string;
  attempts: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  nextAttemptAt?: Date;
  usage?: WorkspaceArtifactUsage;
}

export interface WorkspaceArtifactRecord {
  id: string;
  workspaceId: string;
  type: string;
  name: string;
  description?: string;
  status: string;
  schemaVersion: number;
  revision: number;
  primarySource: {
    documentId: string;
    documentName: string;
    contentHash?: string;
    selection: { mode: 'all' } | { mode: 'pages'; pages: number[] };
  };
  generationOptions: DecisionFlowGenerationOptions;
  payload?: DecisionFlowPayload;
  generation: WorkspaceArtifactGeneration;
  clonedFromArtifactId?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceArtifactCreateInput {
  id?: string;
  workspaceId: string;
  type: string;
  name: string;
  description?: string;
  status: string;
  schemaVersion: number;
  primarySource: WorkspaceArtifactRecord['primarySource'];
  generationOptions: DecisionFlowGenerationOptions;
  payload?: DecisionFlowPayload;
  generation: Pick<WorkspaceArtifactGeneration, 'agentId' | 'requestedBy' | 'attempts' | 'completedAt' | 'nextAttemptAt'>;
  clonedFromArtifactId?: string;
  createdBy: string;
  updatedBy: string;
}

export interface WorkspaceArtifactListFilter {
  type?: string;
  status?: string;
  sourceDocumentId?: string;
  search?: string;
  /** Max rows returned (default 200, clamped to [1, 1000]). */
  limit?: number;
}

export const DEFAULT_ARTIFACT_LIST_LIMIT = 200;
export const MAX_ARTIFACT_LIST_LIMIT = 1000;

/** Patch for the optimistic-revision update; always bumps revision and updatedAt. */
export interface WorkspaceArtifactEditPatch {
  name?: string;
  description?: string;
  payload?: DecisionFlowPayload;
}

export interface ArtifactLeaseClaim {
  artifact: WorkspaceArtifactRecord;
  leaseToken: string;
}

