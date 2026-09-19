import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { DEPLOYMENT_STORE, type DeploymentStore, type GovernanceDeploymentCreateInput, type GovernanceDeploymentPatch } from '../deployment-store';
import type { GovernanceDeploymentRecord } from '../governance-records';

const DEPLOYMENTS = schema.governanceDeployments;
type DeploymentRow = typeof DEPLOYMENTS.$inferSelect;

export function deploymentRowToRecord(row: DeploymentRow): GovernanceDeploymentRecord {
  return {
    id: row.id,
    programId: row.programId,
    scopeId: row.scopeId,
    name: row.name,
    status: row.status as GovernanceDeploymentRecord['status'],
    currentDraftRevisionId: row.currentDraftRevisionId ?? undefined,
    currentPublishedRevisionId: row.currentPublishedRevisionId ?? undefined,
    revisionSequence: row.revisionSequence,
    channels: row.channels ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgDeploymentStore implements DeploymentStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async insert(input: GovernanceDeploymentCreateInput): Promise<GovernanceDeploymentRecord> {
    const [row] = await this.q
      .insert(DEPLOYMENTS)
      .values({
        id: newObjectId(),
        programId: input.programId,
        scopeId: input.scopeId,
        name: input.name,
        status: 'draft',
        revisionSequence: 0,
        channels: input.channels ?? {},
      })
      .returning();
    return deploymentRowToRecord(row);
  }

  async findById(deploymentId: string): Promise<GovernanceDeploymentRecord | null> {
    const rows = await this.q.select().from(DEPLOYMENTS).where(eq(DEPLOYMENTS.id, deploymentId)).limit(1);
    return rows[0] ? deploymentRowToRecord(rows[0]) : null;
  }

  async findByProgramAndScope(programId: string, scopeId: string): Promise<GovernanceDeploymentRecord | null> {
    const rows = await this.q
      .select()
      .from(DEPLOYMENTS)
      .where(and(eq(DEPLOYMENTS.programId, programId), eq(DEPLOYMENTS.scopeId, scopeId)))
      .limit(1);
    return rows[0] ? deploymentRowToRecord(rows[0]) : null;
  }

  async listByProgramScopes(programId: string, scopeIds: string[] | '*'): Promise<GovernanceDeploymentRecord[]> {
    const rows = await this.q
      .select()
      .from(DEPLOYMENTS)
      .where(
        scopeIds === '*'
          ? eq(DEPLOYMENTS.programId, programId)
          : and(eq(DEPLOYMENTS.programId, programId), inArray(DEPLOYMENTS.scopeId, scopeIds)),
      )
      .orderBy(desc(DEPLOYMENTS.updatedAt));
    return rows.map(deploymentRowToRecord);
  }

  async listPublishedByScopes(scopeIds: string[]): Promise<GovernanceDeploymentRecord[]> {
    if (scopeIds.length === 0) return [];
    const rows = await this.q
      .select()
      .from(DEPLOYMENTS)
      .where(and(inArray(DEPLOYMENTS.scopeId, scopeIds), eq(DEPLOYMENTS.status, 'published'), isNotNull(DEPLOYMENTS.currentPublishedRevisionId)));
    return rows.map(deploymentRowToRecord);
  }

  async listByProgram(programId: string): Promise<GovernanceDeploymentRecord[]> {
    const rows = await this.q.select().from(DEPLOYMENTS).where(eq(DEPLOYMENTS.programId, programId));
    return rows.map(deploymentRowToRecord);
  }

  async update(deploymentId: string, patch: GovernanceDeploymentPatch): Promise<GovernanceDeploymentRecord | null> {
    const rows = await this.q
      .update(DEPLOYMENTS)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.channels !== undefined ? { channels: patch.channels } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.currentPublishedRevisionId !== undefined ? { currentPublishedRevisionId: patch.currentPublishedRevisionId } : {}),
        ...(patch.currentDraftRevisionId !== undefined ? { currentDraftRevisionId: patch.currentDraftRevisionId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(DEPLOYMENTS.id, deploymentId))
      .returning();
    return rows[0] ? deploymentRowToRecord(rows[0]) : null;
  }

  async suspendPublished(programId: string, scopeId: string): Promise<boolean> {
    const rows = await this.q
      .update(DEPLOYMENTS)
      .set({ status: 'suspended', updatedAt: new Date() })
      .where(and(eq(DEPLOYMENTS.programId, programId), eq(DEPLOYMENTS.scopeId, scopeId), eq(DEPLOYMENTS.status, 'published')))
      .returning({ id: DEPLOYMENTS.id });
    return rows.length > 0;
  }

  async publishGuarded(deploymentId: string, draftRevisionId: string, revisionId: string): Promise<GovernanceDeploymentRecord | null> {
    const rows = await this.q
      .update(DEPLOYMENTS)
      .set({ currentPublishedRevisionId: revisionId, status: 'published', updatedAt: new Date() })
      .where(
        and(
          eq(DEPLOYMENTS.id, deploymentId),
          eq(DEPLOYMENTS.currentDraftRevisionId, draftRevisionId),
          ne(DEPLOYMENTS.currentPublishedRevisionId, revisionId),
        ),
      )
      .returning();
    return rows[0] ? deploymentRowToRecord(rows[0]) : null;
  }

  async maxRevisionSequence(deploymentId: string, min: number): Promise<void> {
    await this.q
      .update(DEPLOYMENTS)
      .set({ revisionSequence: sql`greatest(${DEPLOYMENTS.revisionSequence}, ${min})`, updatedAt: new Date() })
      .where(eq(DEPLOYMENTS.id, deploymentId));
  }

  async incrementRevisionSequenceGuarded(deploymentId: string, expectedDraftRevisionId: string | null | undefined): Promise<GovernanceDeploymentRecord | null> {
    const rows = await this.q
      .update(DEPLOYMENTS)
      .set({ revisionSequence: sql`${DEPLOYMENTS.revisionSequence} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(DEPLOYMENTS.id, deploymentId),
          // undefined = pointer unknown at read time — no guard (Mongoose stripped undefined filters).
          ...(expectedDraftRevisionId === undefined ? [] : [expectedDraftRevisionId === null ? sql`${DEPLOYMENTS.currentDraftRevisionId} IS NULL` : eq(DEPLOYMENTS.currentDraftRevisionId, expectedDraftRevisionId)]),
        ),
      )
      .returning();
    return rows[0] ? deploymentRowToRecord(rows[0]) : null;
  }

  async setDraftRevisionIfSequence(deploymentId: string, revisionSequence: number, revisionId: string): Promise<boolean> {
    const rows = await this.q
      .update(DEPLOYMENTS)
      .set({ currentDraftRevisionId: revisionId, updatedAt: new Date() })
      .where(and(eq(DEPLOYMENTS.id, deploymentId), eq(DEPLOYMENTS.revisionSequence, revisionSequence)))
      .returning({ id: DEPLOYMENTS.id });
    return rows.length === 1;
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.q.delete(DEPLOYMENTS).where(and(eq(DEPLOYMENTS.programId, programId), eq(DEPLOYMENTS.scopeId, scopeId)));
  }

  async deleteByIds(deploymentIds: string[]): Promise<void> {
    if (deploymentIds.length === 0) return;
    await this.q.delete(DEPLOYMENTS).where(inArray(DEPLOYMENTS.id, deploymentIds));
  }
}
