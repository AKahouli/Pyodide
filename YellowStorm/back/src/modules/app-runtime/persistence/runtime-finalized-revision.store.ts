/**
 * Store port for app_runtime.finalized_revisions (P8 Mongo cutover).
 */
export const RUNTIME_FINALIZED_REVISION_STORE = Symbol('RUNTIME_FINALIZED_REVISION_STORE');

export interface FinalizedRevisionRecord {
  id: string;
  workspaceId: string;
  revisionId: string;
  title: string;
  finalizedAt: Date;
  eventId: string;
  fileCount: number | null;
  cephManifestPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertFinalizedRevisionData {
  workspaceId: string;
  revisionId: string;
  title: string;
  finalizedAt: Date;
  eventId: string;
  fileCount?: number | null;
  cephManifestPath?: string | null;
}

export interface RuntimeFinalizedRevisionStore {
  upsert(data: UpsertFinalizedRevisionData): Promise<void>;
  listByWorkspace(workspaceId: string): Promise<FinalizedRevisionRecord[]>;
  resolveLatestFinalized(workspaceId: string): Promise<string | null>;
  existsByWorkspaceAndRevision(workspaceId: string, revisionId: string): Promise<boolean>;
  /** Aggregated summary per workspace. */
  summarizeByWorkspaces(workspaceIds: string[]): Promise<Map<string, { latestRevisionId: string; latestFinalizedAt: string; versionCount: number }>>;
}
