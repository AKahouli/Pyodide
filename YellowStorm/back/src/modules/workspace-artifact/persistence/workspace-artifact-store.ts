import type { DecisionFlowGenerationOptions } from '../interfaces/workspace-artifact.interface';
import type { DecisionFlowPayload } from '../interfaces/decision-flow.interface';

export const WORKSPACE_ARTIFACT_STORE = Symbol('WORKSPACE_ARTIFACT_STORE');

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

export interface WorkspaceArtifactStore {
  findByIdAndWorkspace(workspaceId: string, id: string): Promise<WorkspaceArtifactRecord | null>;
  list(workspaceId: string, filter: WorkspaceArtifactListFilter): Promise<WorkspaceArtifactRecord[]>;
  create(input: WorkspaceArtifactCreateInput): Promise<WorkspaceArtifactRecord>;
  /** Optimistic concurrency: null when the revision no longer matches. */
  updateWithRevision(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    patch: WorkspaceArtifactEditPatch,
    updatedBy: string,
  ): Promise<WorkspaceArtifactRecord | null>;
  /** Reset a failed artifact for a fresh generation run. */
  resetForGeneration(
    id: string,
    generation: { agentId: string; requestedBy: string },
    updatedBy: string,
  ): Promise<WorkspaceArtifactRecord | null>;
  deleteById(id: string): Promise<void>;
  existsName(workspaceId: string, name: string, exceptId?: string): Promise<boolean>;
  countBySource(workspaceId: string, documentId: string): Promise<number>;
  /** Batched count of artifacts whose primary source is any of the documents; 0 for []. */
  countBySourceDocumentIds(documentIds: string[]): Promise<number>;
  deleteBySource(workspaceId: string, documentId: string): Promise<void>;
  deleteAllByWorkspace(workspaceId: string): Promise<void>;

  // Worker lease paths — race-free by construction (FOR UPDATE SKIP LOCKED / lease-token guards).
  failExhaustedLeases(maxAttempts: number): Promise<void>;
  /** Atomically claim the oldest claimable artifact, or null when the queue is empty. */
  claim(maxAttempts: number, leaseMinutes: number): Promise<ArtifactLeaseClaim | null>;
  /** Complete generation; returns false when the lease was lost mid-run. */
  complete(id: string, leaseToken: string, payload: DecisionFlowPayload, usage?: WorkspaceArtifactUsage): Promise<boolean>;
  /** Requeue (transient failure) or fail; returns false when the lease was lost mid-run. */
  fail(id: string, leaseToken: string, opts: { canRetry: boolean; message: string; nextAttemptAt: Date }): Promise<boolean>;
}
