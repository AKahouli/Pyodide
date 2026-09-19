import { Inject, Injectable } from '@nestjs/common';
import {
  WORKSPACE_ARTIFACT_CLEANUP_PORT,
  type WorkspaceArtifactCleanupPort,
} from '../../workspace-artifact/ports/workspace-artifact-cleanup.port';

@Injectable()
export class WorkspaceArtifactCleanupService {
  constructor(@Inject(WORKSPACE_ARTIFACT_CLEANUP_PORT) private readonly cleanup: WorkspaceArtifactCleanupPort) {}

  countBySource(workspaceId: string, documentId: string): Promise<number> {
    return this.cleanup.countBySource(workspaceId, documentId);
  }

  /** Batched count of artifacts sourced from any of `documentIds` (0 for []). */
  countBySourceDocumentIds(documentIds: string[]): Promise<number> {
    if (documentIds.length === 0) return Promise.resolve(0);
    return this.cleanup.countBySourceDocumentIds(documentIds);
  }

  deleteBySource(workspaceId: string, documentId: string): Promise<void> {
    return this.cleanup.deleteBySource(workspaceId, documentId);
  }

  async deleteAllByWorkspace(workspaceId: string): Promise<void> {
    await this.cleanup.deleteAllByWorkspace(workspaceId);
  }
}
