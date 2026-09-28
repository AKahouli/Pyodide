import { Injectable } from '@nestjs/common';
import { PostgresWorkspaceArtifactStore } from '../persistence/postgres/postgres-workspace-artifact-store';

@Injectable()
export class WorkspaceArtifactCleanupAdapter {
  constructor(private readonly artifacts: PostgresWorkspaceArtifactStore) {}

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
