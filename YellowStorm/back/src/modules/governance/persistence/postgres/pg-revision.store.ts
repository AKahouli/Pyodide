import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { type GovernanceRevisionCreateInput,  type GovernanceRevisionPatch,  type RevisionStore } from '../revision-store';
import type { GovernanceRevisionRecord } from '../governance-records';

const REVISIONS = schema.governanceDeploymentRevisions;
type RevisionRow = typeof REVISIONS.$inferSelect;

export function revisionRowToRecord(row: RevisionRow): GovernanceRevisionRecord {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    revisionNumber: row.revisionNumber,
    status: row.status as GovernanceRevisionRecord['status'],
    agentId: row.agentId ?? undefined,
    allowedAgentIds: row.allowedAgentIds,
    workspaceIds: row.workspaceIds,
    agentSnapshot: row.agentSnapshot ?? {},
    workspaceBindingSnapshot: row.workspaceBindingSnapshot ?? {},
    channelSnapshot: row.channelSnapshot ?? {},
    scopeSnapshot: row.scopeSnapshot ?? {},
    audienceSnapshot: row.audienceSnapshot ?? {},
    previousAudienceSnapshot: row.previousAudienceSnapshot ?? {},
    configurationFingerprint: row.configurationFingerprint ?? undefined,
    createdBy: row.createdBy,
    approvedBy: row.approvedBy ?? undefined,
    publishedBy: row.publishedBy ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgRevisionStore implements RevisionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async insert(input: GovernanceRevisionCreateInput): Promise<GovernanceRevisionRecord> {
    const [row] = await this.q
      .insert(REVISIONS)
      .values({
        id: newObjectId(),
        deploymentId: input.deploymentId,
        revisionNumber: input.revisionNumber,
        status: input.status ?? 'draft',
        agentId: input.agentId ?? null,
        allowedAgentIds: input.allowedAgentIds ?? [],
        workspaceIds: input.workspaceIds ?? [],
        agentSnapshot: input.agentSnapshot ?? {},
        workspaceBindingSnapshot: input.workspaceBindingSnapshot ?? {},
        channelSnapshot: input.channelSnapshot ?? {},
        scopeSnapshot: input.scopeSnapshot ?? {},
        audienceSnapshot: input.audienceSnapshot ?? {},
        previousAudienceSnapshot: input.previousAudienceSnapshot ?? {},
        configurationFingerprint: input.configurationFingerprint ?? null,
        createdBy: input.createdBy,
      })
      .returning();
    return revisionRowToRecord(row);
  }

  async countByDeployment(deploymentId: string): Promise<number> {
    const rows = await this.q.select({ count: sql<number>`count(*)::int` }).from(REVISIONS).where(eq(REVISIONS.deploymentId, deploymentId));
    return rows[0]?.count ?? 0;
  }

  async findById(revisionId: string): Promise<GovernanceRevisionRecord | null> {
    const rows = await this.q.select().from(REVISIONS).where(eq(REVISIONS.id, revisionId)).limit(1);
    return rows[0] ? revisionRowToRecord(rows[0]) : null;
  }

  async findByDeploymentAndId(deploymentId: string, revisionId: string): Promise<GovernanceRevisionRecord | null> {
    const rows = await this.q
      .select()
      .from(REVISIONS)
      .where(and(eq(REVISIONS.id, revisionId), eq(REVISIONS.deploymentId, deploymentId)))
      .limit(1);
    return rows[0] ? revisionRowToRecord(rows[0]) : null;
  }

  async listByDeployment(deploymentId: string): Promise<GovernanceRevisionRecord[]> {
    const rows = await this.q.select().from(REVISIONS).where(eq(REVISIONS.deploymentId, deploymentId)).orderBy(desc(REVISIONS.revisionNumber));
    return rows.map(revisionRowToRecord);
  }

  async listByIds(revisionIds: string[]): Promise<GovernanceRevisionRecord[]> {
    if (revisionIds.length === 0) return [];
    const rows = await this.q.select().from(REVISIONS).where(inArray(REVISIONS.id, revisionIds));
    return rows.map(revisionRowToRecord);
  }

  async update(revisionId: string, patch: GovernanceRevisionPatch): Promise<GovernanceRevisionRecord | null> {
    const rows = await this.q
      .update(REVISIONS)
      .set({
        ...(patch.agentId !== undefined ? { agentId: patch.agentId } : {}),
        ...(patch.allowedAgentIds !== undefined ? { allowedAgentIds: patch.allowedAgentIds } : {}),
        ...(patch.workspaceIds !== undefined ? { workspaceIds: patch.workspaceIds } : {}),
        ...(patch.agentSnapshot !== undefined ? { agentSnapshot: patch.agentSnapshot } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.publishedBy !== undefined ? { publishedBy: patch.publishedBy } : {}),
        ...(patch.publishedAt !== undefined ? { publishedAt: patch.publishedAt } : {}),        updatedAt: new Date(),
      })
      .where(eq(REVISIONS.id, revisionId))
      .returning();
    return rows[0] ? revisionRowToRecord(rows[0]) : null;
  }

  async findPreviousPublished(deploymentId: string, excludeRevisionId: string): Promise<GovernanceRevisionRecord | null> {
    const rows = await this.q
      .select()
      .from(REVISIONS)
      .where(and(eq(REVISIONS.deploymentId, deploymentId), eq(REVISIONS.status, 'published'), ne(REVISIONS.id, excludeRevisionId)))
      .orderBy(desc(REVISIONS.publishedAt))
      .limit(1);
    return rows[0] ? revisionRowToRecord(rows[0]) : null;
  }

  async deleteByIdAndStatus(revisionId: string, status: GovernanceRevisionRecord['status']): Promise<boolean> {
    const rows = await this.q.delete(REVISIONS).where(and(eq(REVISIONS.id, revisionId), eq(REVISIONS.status, status))).returning({ id: REVISIONS.id });
    return rows.length === 1;
  }

  async deleteByDeploymentIds(deploymentIds: string[]): Promise<void> {
    if (deploymentIds.length === 0) return;
    await this.q.delete(REVISIONS).where(inArray(REVISIONS.deploymentId, deploymentIds));
  }
}
