import { Inject } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type SourceRevisionRecord,
  type SourceRevisionFileRecord,
  type RuntimeSourceRevisionStore,
  type CreateSourceRevisionData,
} from './runtime-source-revision.store';

type Row = typeof schema.appRuntimeSourceRevisions.$inferSelect;

function toRecord(row: Row): SourceRevisionRecord {
  return {
    id: row.id,
    revisionId: row.revisionId,
    workspaceId: row.workspaceId,
    parentRevisionId: row.parentRevisionId ?? null,
    manifestHash: row.manifestHash,
    manifestObjectKey: row.manifestObjectKey,
    files: (row.files) ?? [],
    createdByToolCallId: row.createdByToolCallId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgRuntimeSourceRevisionStore implements RuntimeSourceRevisionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findByWorkspaceAndRevision(workspaceId: string, revisionId: string): Promise<SourceRevisionRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.appRuntimeSourceRevisions)
      .where(
        and(
          eq(schema.appRuntimeSourceRevisions.workspaceId, workspaceId),
          eq(schema.appRuntimeSourceRevisions.revisionId, revisionId),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async existsByWorkspaceAndRevision(workspaceId: string, revisionId: string): Promise<boolean> {
    const [row] = await this.q
      .select({ id: schema.appRuntimeSourceRevisions.id })
      .from(schema.appRuntimeSourceRevisions)
      .where(
        and(
          eq(schema.appRuntimeSourceRevisions.workspaceId, workspaceId),
          eq(schema.appRuntimeSourceRevisions.revisionId, revisionId),
        ),
      )
      .limit(1);
    return !!row;
  }

  async createIfNotExists(data: CreateSourceRevisionData): Promise<SourceRevisionRecord> {
    const existing = await this.findByWorkspaceAndRevision(data.workspaceId, data.revisionId);
    if (existing) return existing;

    const [row] = await this.q
      .insert(schema.appRuntimeSourceRevisions)
      .values({
        id: newObjectId(),
        revisionId: data.revisionId,
        workspaceId: data.workspaceId,
        parentRevisionId: data.parentRevisionId,
        manifestHash: data.manifestHash,
        manifestObjectKey: data.manifestObjectKey,
        files: data.files,
        createdByToolCallId: data.createdByToolCallId,
      })
      .onConflictDoNothing({
        target: [schema.appRuntimeSourceRevisions.workspaceId, schema.appRuntimeSourceRevisions.revisionId],
      })
      .returning();

    if (row) return toRecord(row);
    // Race: conflict — read the row that won.
    return (await this.findByWorkspaceAndRevision(data.workspaceId, data.revisionId))!;
  }

  async listRevisionIds(workspaceId: string): Promise<string[]> {
    const rows = await this.q
      .select({ revisionId: schema.appRuntimeSourceRevisions.revisionId })
      .from(schema.appRuntimeSourceRevisions)
      .where(eq(schema.appRuntimeSourceRevisions.workspaceId, workspaceId));
    return rows.map((r) => r.revisionId);
  }
}
