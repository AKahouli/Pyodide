import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { escapeLike } from '@common/postgres/like';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import type {
  ArtifactLeaseClaim,
  WorkspaceArtifactCreateInput,
  WorkspaceArtifactEditPatch,
  WorkspaceArtifactListFilter,
  WorkspaceArtifactStore,
  WorkspaceArtifactUsage,
} from '../workspace-artifact-store';
import { artifactCreateInputToRow, artifactRowToRecord } from '../workspace-artifact-record.mapper';
import type { WorkspaceArtifactRecord } from '../workspace-artifact-store';

const ARTIFACTS = schema.workspaceArtifacts;
type ArtifactRow = typeof ARTIFACTS.$inferSelect;

@Injectable()
export class PostgresWorkspaceArtifactStore implements WorkspaceArtifactStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findByIdAndWorkspace(workspaceId: string, id: string): Promise<WorkspaceArtifactRecord | null> {
    const rows = await this.q
      .select()
      .from(ARTIFACTS)
      .where(and(eq(ARTIFACTS.id, id), eq(ARTIFACTS.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ? artifactRowToRecord(rows[0]) : null;
  }

  async list(workspaceId: string, filter: WorkspaceArtifactListFilter): Promise<WorkspaceArtifactRecord[]> {
    const conditions = [eq(ARTIFACTS.workspaceId, workspaceId)];
    if (filter.type) conditions.push(eq(ARTIFACTS.type, filter.type));
    if (filter.status) conditions.push(eq(ARTIFACTS.status, filter.status));
    if (filter.sourceDocumentId) conditions.push(eq(ARTIFACTS.primarySourceDocumentId, filter.sourceDocumentId));
    if (filter.search) conditions.push(ilike(ARTIFACTS.name, `%${escapeLike(filter.search)}%`));
    const rows = await this.q
      .select()
      .from(ARTIFACTS)
      .where(and(...conditions))
      .orderBy(desc(ARTIFACTS.updatedAt));
    return rows.map(artifactRowToRecord);
  }

  async create(input: WorkspaceArtifactCreateInput): Promise<WorkspaceArtifactRecord> {
    const [row] = await this.q
      .insert(ARTIFACTS)
      .values(artifactCreateInputToRow({ ...input, id: input.id ?? newObjectId() }))
      .returning();
    return artifactRowToRecord(row);
  }

  async updateWithRevision(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    patch: WorkspaceArtifactEditPatch,
    updatedBy: string,
  ): Promise<WorkspaceArtifactRecord | null> {
    const rows = await this.q
      .update(ARTIFACTS)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
        revision: sql`${ARTIFACTS.revision} + 1`,
        updatedBy,
        updatedAt: new Date(),
      })
      .where(
        and(eq(ARTIFACTS.id, id), eq(ARTIFACTS.workspaceId, workspaceId), eq(ARTIFACTS.revision, expectedRevision)),
      )
      .returning();
    return rows.length > 0 ? artifactRowToRecord(rows[0]) : null;
  }

  async resetForGeneration(
    id: string,
    generation: { agentId: string; requestedBy: string },
  ): Promise<WorkspaceArtifactRecord | null> {
    const rows = await this.q
      .update(ARTIFACTS)
      .set({
        status: 'queued',
        payload: null,
        generationAgentId: generation.agentId,
        generationRequestedBy: generation.requestedBy,
        generationAttempts: 0,
        generationStartedAt: null,
        generationCompletedAt: null,
        generationError: null,
        generationUsage: null,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ARTIFACTS.id, id))
      .returning();
    return rows.length > 0 ? artifactRowToRecord(rows[0]) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.q.delete(ARTIFACTS).where(eq(ARTIFACTS.id, id));
  }

  async existsName(workspaceId: string, name: string, exceptId?: string): Promise<boolean> {
    const conditions = [eq(ARTIFACTS.workspaceId, workspaceId), eq(ARTIFACTS.name, name)];
    if (exceptId) conditions.push(sql`${ARTIFACTS.id} <> ${exceptId}`);
    const rows = await this.q
      .select({ id: ARTIFACTS.id })
      .from(ARTIFACTS)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  async countBySource(workspaceId: string, documentId: string): Promise<number> {
    const rows = await this.q
      .select({ id: ARTIFACTS.id })
      .from(ARTIFACTS)
      .where(and(eq(ARTIFACTS.workspaceId, workspaceId), eq(ARTIFACTS.primarySourceDocumentId, documentId)));
    return rows.length;
  }

  async deleteBySource(workspaceId: string, documentId: string): Promise<void> {
    await this.q
      .delete(ARTIFACTS)
      .where(and(eq(ARTIFACTS.workspaceId, workspaceId), eq(ARTIFACTS.primarySourceDocumentId, documentId)));
  }

  async deleteAllByWorkspace(workspaceId: string): Promise<void> {
    await this.q.delete(ARTIFACTS).where(eq(ARTIFACTS.workspaceId, workspaceId));
  }

  async failExhaustedLeases(maxAttempts: number): Promise<void> {
    await this.q
      .update(ARTIFACTS)
      .set({
        status: 'failed',
        generationCompletedAt: new Date(),
        generationError: 'Generation stopped after the maximum number of attempts',
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(ARTIFACTS.status, 'generating'),
          sql`${ARTIFACTS.leaseExpiresAt} <= now()`,
          sql`${ARTIFACTS.generationAttempts} >= ${maxAttempts}`,
        ),
      );
  }

  async claim(maxAttempts: number, leaseMinutes: number): Promise<ArtifactLeaseClaim | null> {
    const leaseToken = randomUUID();
    // Atomic claim: FOR UPDATE SKIP LOCKED picks one candidate row; the outer
    // UPDATE is a no-op (and returns nothing) when another worker won the race.
    const result = await this.q.execute(sql`
      UPDATE workspace.workspace_artifacts
         SET status = 'generating',
             lease_token = ${leaseToken},
             lease_expires_at = now() + (${leaseMinutes} * interval '1 minute'),
             generation_attempts = workspace.workspace_artifacts.generation_attempts + 1,
             generation_started_at = now(),
             updated_at = now()
       WHERE id = (
         SELECT id FROM workspace.workspace_artifacts
          WHERE generation_attempts < ${maxAttempts}
            AND ((status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
              OR (status = 'generating' AND lease_expires_at <= now()))
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id
    `);
    if (result.rows.length === 0) return null;
    const row = await this.findByIdAndWorkspaceInner(String(result.rows[0].id));
    if (!row) return null; // row vanished between claim and refetch (cleanup race)
    return { artifact: artifactRowToRecord(row), leaseToken };
  }

  async complete(
    id: string,
    leaseToken: string,
    payload: WorkspaceArtifactRecord['payload'],
    usage?: WorkspaceArtifactUsage,
  ): Promise<boolean> {
    const rows = await this.q
      .update(ARTIFACTS)
      .set({
        status: 'ready',
        payload,
        generationCompletedAt: new Date(),
        generationUsage: usage,
        generationError: null,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(ARTIFACTS.id, id), eq(ARTIFACTS.status, 'generating'), eq(ARTIFACTS.leaseToken, leaseToken)))
      .returning({ id: ARTIFACTS.id });
    return rows.length > 0;
  }

  async fail(
    id: string,
    leaseToken: string,
    opts: { canRetry: boolean; message: string; nextAttemptAt: Date },
  ): Promise<boolean> {
    const rows = await this.q
      .update(ARTIFACTS)
      .set(
        opts.canRetry
          ? {
              status: 'queued',
              nextAttemptAt: opts.nextAttemptAt,
              generationError: opts.message,
              leaseToken: null,
              leaseExpiresAt: null,
              generationCompletedAt: null,
              updatedAt: new Date(),
            }
          : {
              status: 'failed',
              generationCompletedAt: new Date(),
              generationError: opts.message,
              leaseToken: null,
              leaseExpiresAt: null,
              updatedAt: new Date(),
            },
      )
      .where(and(eq(ARTIFACTS.id, id), eq(ARTIFACTS.leaseToken, leaseToken)))
      .returning({ id: ARTIFACTS.id });
    return rows.length > 0;
  }

  private async findByIdAndWorkspaceInner(id: string): Promise<ArtifactRow | null> {
    const rows = await this.q.select().from(ARTIFACTS).where(inArray(ARTIFACTS.id, [id])).limit(1);
    return rows.length > 0 ? rows[0] : null;
  }
}
