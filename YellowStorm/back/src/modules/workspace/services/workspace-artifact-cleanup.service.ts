import { Injectable } from '@nestjs/common';
import { WorkspaceArtifactCleanupAdapter } from '../../workspace-artifact/ports/workspace-artifact-cleanup.adapter';

@Injectable()
export class WorkspaceArtifactCleanupService {
  constructor(private readonly cleanup: WorkspaceArtifactCleanupAdapter) {}

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
