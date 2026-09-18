export const WORKSPACE_ARTIFACT_CLEANUP_PORT = Symbol('WORKSPACE_ARTIFACT_CLEANUP_PORT');

/**
 * Workspace-side cleanup of artifacts, replacing the raw `connection.collection`
 * access in WorkspaceArtifactCleanupService. Implemented by the artifact module.
 */
export interface WorkspaceArtifactCleanupPort {
  countBySource(workspaceId: string, documentId: string): Promise<number>;
  deleteBySource(workspaceId: string, documentId: string): Promise<void>;
  deleteAllByWorkspace(workspaceId: string): Promise<void>;
}
