/**
 * Store port for app_runtime.source_revisions (P8 Mongo cutover).
 */
export const RUNTIME_SOURCE_REVISION_STORE = Symbol('RUNTIME_SOURCE_REVISION_STORE');

export interface SourceRevisionFileRecord {
  path: string;
  sha256: string;
  objectKey: string;
  size: number;
}

export interface SourceRevisionRecord {
  id: string;
  revisionId: string;
  workspaceId: string;
  parentRevisionId: string | null;
  manifestHash: string;
  manifestObjectKey: string;
  files: SourceRevisionFileRecord[];
  createdByToolCallId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSourceRevisionData {
  revisionId: string;
  workspaceId: string;
  parentRevisionId: string | null;
  manifestHash: string;
  manifestObjectKey: string;
  files: SourceRevisionFileRecord[];
  createdByToolCallId: string | null;
}

export interface RuntimeSourceRevisionStore {
  findByWorkspaceAndRevision(workspaceId: string, revisionId: string): Promise<SourceRevisionRecord | null>;
  existsByWorkspaceAndRevision(workspaceId: string, revisionId: string): Promise<boolean>;
  /** INSERT … ON CONFLICT DO NOTHING. */
  createIfNotExists(data: CreateSourceRevisionData): Promise<SourceRevisionRecord>;
  /** All revision ids for a workspace (for branchRevision). */
  listRevisionIds(workspaceId: string): Promise<string[]>;
}
