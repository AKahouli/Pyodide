import type * as schema from '@modules/postgres/schema';
import type { WorkspaceArtifactCreateInput, WorkspaceArtifactRecord } from './workspace-artifact-store';

type ArtifactRow = typeof schema.workspaceArtifacts.$inferSelect;
type ArtifactInsertRow = typeof schema.workspaceArtifacts.$inferInsert;

export function artifactRowToRecord(row: ArtifactRow): WorkspaceArtifactRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    schemaVersion: row.schemaVersion,
    revision: row.revision,
    primarySource: row.primarySource,
    generationOptions: row.generationOptions,
    payload: row.payload ?? undefined,
    generation: {
      agentId: row.generationAgentId,
      requestedBy: row.generationRequestedBy,
      attempts: row.generationAttempts,
      startedAt: row.generationStartedAt ?? undefined,
      completedAt: row.generationCompletedAt ?? undefined,
      error: row.generationError ?? undefined,
      leaseToken: row.leaseToken ?? undefined,
      leaseExpiresAt: row.leaseExpiresAt ?? undefined,
      nextAttemptAt: row.nextAttemptAt ?? undefined,
      usage: row.generationUsage ?? undefined,
    },
    clonedFromArtifactId: row.clonedFromArtifactId ?? undefined,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function artifactCreateInputToRow(
  input: Omit<WorkspaceArtifactCreateInput, 'id'> & { id: string },
): ArtifactInsertRow {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    type: input.type,
    name: input.name,
    description: input.description,
    status: input.status,
    schemaVersion: input.schemaVersion,
    primarySource: input.primarySource,
    primarySourceDocumentId: input.primarySource.documentId,
    generationOptions: input.generationOptions,
    payload: input.payload,
    generationAgentId: input.generation.agentId,
    generationRequestedBy: input.generation.requestedBy,
    generationAttempts: input.generation.attempts,
    generationCompletedAt: input.generation.completedAt,
    nextAttemptAt: input.generation.nextAttemptAt,
    clonedFromArtifactId: input.clonedFromArtifactId,
    createdBy: input.createdBy,
    updatedBy: input.updatedBy,
  };
}
