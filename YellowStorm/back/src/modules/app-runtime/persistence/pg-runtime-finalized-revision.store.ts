import { Inject } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  type FinalizedRevisionRecord,
  type RuntimeFinalizedRevisionStore,
  type UpsertFinalizedRevisionData,
} from './runtime-finalized-revision.store';

type Row = typeof schema.appRuntimeFinalizedRevisions.$inferSelect;

function toRecord(row: Row): FinalizedRevisionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    revisionId: row.revisionId,
    title: row.title,
    finalizedAt: row.finalizedAt,
    eventId: row.eventId,
    fileCount: row.fileCount ?? null,
    cephManifestPath: row.cephManifestPath ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PgRuntimeFinalizedRevisionStore implements RuntimeFinalizedRevisionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async upsert(data: UpsertFinalizedRevisionData): Promise<void> {
    await this.q
      .insert(schema.appRuntimeFinalizedRevisions)
      .values({
        id: newObjectId(),
        workspaceId: data.workspaceId,
        revisionId: data.revisionId,
        title: data.title,
        finalizedAt: data.finalizedAt,
        eventId: data.eventId,
        fileCount: data.fileCount ?? null,
        cephManifestPath: data.cephManifestPath ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.appRuntimeFinalizedRevisions.workspaceId, schema.appRuntimeFinalizedRevisions.revisionId],
        set: {
          title: data.title,
          finalizedAt: data.finalizedAt,
          eventId: data.eventId,
          fileCount: data.fileCount ?? null,
          cephManifestPath: data.cephManifestPath ?? null,
          updatedAt: new Date(),
        },
      });
  }

  async listByWorkspace(workspaceId: string): Promise<FinalizedRevisionRecord[]> {
    const rows = await this.q
      .select()
      .from(schema.appRuntimeFinalizedRevisions)
      .where(eq(schema.appRuntimeFinalizedRevisions.workspaceId, workspaceId))
      .orderBy(desc(schema.appRuntimeFinalizedRevisions.finalizedAt));
    return rows.map(toRecord);
  }

  async resolveLatestFinalized(workspaceId: string): Promise<string | null> {
    const [row] = await this.q
      .select({ revisionId: schema.appRuntimeFinalizedRevisions.revisionId })
      .from(schema.appRuntimeFinalizedRevisions)
      .where(eq(schema.appRuntimeFinalizedRevisions.workspaceId, workspaceId))
      .orderBy(desc(schema.appRuntimeFinalizedRevisions.finalizedAt))
      .limit(1);
    return row?.revisionId ?? null;
  }

  async existsByWorkspaceAndRevision(workspaceId: string, revisionId: string): Promise<boolean> {
    const [row] = await this.q
      .select({ id: schema.appRuntimeFinalizedRevisions.id })
      .from(schema.appRuntimeFinalizedRevisions)
      .where(
        and(
          eq(schema.appRuntimeFinalizedRevisions.workspaceId, workspaceId),
          eq(schema.appRuntimeFinalizedRevisions.revisionId, revisionId),
        ),
      )
      .limit(1);
    return !!row;
  }

  async summarizeByWorkspaces(
    workspaceIds: string[],
  ): Promise<Map<string, { latestRevisionId: string; latestFinalizedAt: string; versionCount: number }>> {
    const uniqueIds = [...new Set(workspaceIds.filter((id) => id.trim()))];
    if (!uniqueIds.length) return new Map();

    const t = schema.appRuntimeFinalizedRevisions;
    // Use a window function to get the latest row per workspace + a count.
    // Embed inArray so the param is a proper PG array (not ANY(($1,$2,…)) row syntax).
    const rows = await this.q.execute<{
      workspace_id: string;
      latest_revision_id: string;
      latest_finalized_at: Date;
      version_count: number;
    }>(sql`
      SELECT
        workspace_id,
        revision_id AS latest_revision_id,
        finalized_at AS latest_finalized_at,
        cnt AS version_count
      FROM (
        SELECT
          workspace_id,
          revision_id,
          finalized_at,
          COUNT(*) OVER (PARTITION BY workspace_id) AS cnt,
          ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY finalized_at DESC) AS rn
        FROM ${t}
        WHERE ${inArray(t.workspaceId, uniqueIds)}
      ) sub
      WHERE rn = 1
    `);

    const result = new Map<string, { latestRevisionId: string; latestFinalizedAt: string; versionCount: number }>();
    for (const row of rows.rows) {
      result.set(row.workspace_id, {
        latestRevisionId: row.latest_revision_id,
        latestFinalizedAt: new Date(row.latest_finalized_at).toISOString(),
        versionCount: Number(row.version_count),
      });
    }
    return result;
  }
}
