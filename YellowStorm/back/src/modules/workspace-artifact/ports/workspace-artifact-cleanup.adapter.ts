import { Inject, Injectable } from '@nestjs/common';
import {
  WORKSPACE_ARTIFACT_STORE,
  type WorkspaceArtifactStore,
} from '../persistence/workspace-artifact-store';
import { WORKSPACE_ARTIFACT_CLEANUP_PORT, type WorkspaceArtifactCleanupPort } from './workspace-artifact-cleanup.port';

@Injectable()
export class WorkspaceArtifactCleanupAdapter implements WorkspaceArtifactCleanupPort {
  constructor(@Inject(WORKSPACE_ARTIFACT_STORE) private readonly artifacts: WorkspaceArtifactStore) {}

  countBySource(workspaceId: string, documentId: string): Promise<number> {
    return this.artifacts.countBySource(workspaceId, documentId);
  }

  countBySourceDocumentIds(documentIds: string[]): Promise<number> {
    return this.artifacts.countBySourceDocumentIds(documentIds);
  }

  deleteBySource(workspaceId: string, documentId: string): Promise<void> {
    return this.artifacts.deleteBySource(workspaceId, documentId);
  }

  deleteAllByWorkspace(workspaceId: string): Promise<void> {
    return this.artifacts.deleteAllByWorkspace(workspaceId);
  }
}

export { WORKSPACE_ARTIFACT_CLEANUP_PORT };
