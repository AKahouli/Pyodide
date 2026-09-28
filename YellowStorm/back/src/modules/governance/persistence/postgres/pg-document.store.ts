import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import {
  type GovernanceDocumentStore, 
  type GovernanceDocumentUpdate, 
  type GovernanceDocumentUpdateGuard, 
  type GovernanceDocumentUpsertInput, 
} from '../document-store';
import type { GovernanceDocumentRecord } from '../governance-records';

const DOCS = schema.governanceDocuments;
type DocRow = typeof DOCS.$inferSelect;

export function documentRowToRecord(row: DocRow): GovernanceDocumentRecord {
  return {
    id: row.id,
    programId: row.programId,
    documentId: row.documentId,
    workspaceId: row.workspaceId,
    status: row.status as GovernanceDocumentRecord['status'],
    validity: row.validity ?? {},
    tags: row.tags,
    metadata: row.metadata ?? {},
    ownerUserId: row.ownerUserId ?? undefined,
    ownerScopeId: row.ownerScopeId ?? undefined,
    governanceRevision: row.governanceRevision,
    temporalDecisionRevision: row.temporalDecisionRevision,
    submittedForReviewBy: row.submittedForReviewBy ?? undefined,
    submittedForReviewAt: row.submittedForReviewAt ?? undefined,
    reviewedBy: row.reviewedBy ?? undefined,
    reviewedAt: row.reviewedAt ?? undefined,
    approvedBy: row.approvedBy ?? undefined,
    approvedAt: row.approvedAt ?? undefined,
    publishedBy: row.publishedBy ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    reviewComment: row.reviewComment ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    archivedBy: row.archivedBy ?? undefined,
    archiveReason: row.archiveReason ?? undefined,
    lastIntegrationEventId: row.lastIntegrationEventId ?? undefined,
    lastIntegrationEventAt: row.lastIntegrationEventAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Single normalisation for the promoted business-status column: '' / null / undefined all map to NULL. */
export function normalizeBusinessStatus(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : String(value);
}

type DocSetPatch = Partial<Omit<DocRow, 'id' | 'createdAt' | 'validity'>> & { validity?: Record<string, unknown> };

function buildPatch(update: GovernanceDocumentUpdate): DocSetPatch {
  const patch: DocSetPatch = {};
  const set = update.set;
  if (set.status !== undefined) patch.status = set.status;
  if (set.reviewComment !== undefined) patch.reviewComment = set.reviewComment === null ? null : set.reviewComment;
  if (set.tags !== undefined) patch.tags = set.tags;
  if (set.metadata !== undefined) patch.metadata = set.metadata;
  if (set.ownerUserId !== undefined) patch.ownerUserId = set.ownerUserId;
  if (set.ownerScopeId !== undefined) patch.ownerScopeId = set.ownerScopeId;
  if (set.workspaceId !== undefined) patch.workspaceId = set.workspaceId;
  if (set.archivedAt !== undefined) patch.archivedAt = set.archivedAt;
  if (set.archivedBy !== undefined) patch.archivedBy = set.archivedBy;
  if (set.archiveReason !== undefined) patch.archiveReason = set.archiveReason === null ? null : set.archiveReason;
  if (set.submittedForReviewBy !== undefined) patch.submittedForReviewBy = set.submittedForReviewBy;
  if (set.submittedForReviewAt !== undefined) patch.submittedForReviewAt = set.submittedForReviewAt;
  if (set.reviewedBy !== undefined) patch.reviewedBy = set.reviewedBy;
  if (set.reviewedAt !== undefined) patch.reviewedAt = set.reviewedAt;
  if (set.approvedBy !== undefined) patch.approvedBy = set.approvedBy;
  if (set.approvedAt !== undefined) patch.approvedAt = set.approvedAt;
  if (set.publishedBy !== undefined) patch.publishedBy = set.publishedBy;
  if (set.publishedAt !== undefined) patch.publishedAt = set.publishedAt;
  if (set.lastIntegrationEventId !== undefined) patch.lastIntegrationEventId = set.lastIntegrationEventId;
  if (set.lastIntegrationEventAt !== undefined) patch.lastIntegrationEventAt = set.lastIntegrationEventAt;
  if (set.validity !== undefined) patch.validity = set.validity;
  for (const key of update.unset ?? []) {
    (patch as Record<string, unknown>)[key] = null;
  }
  return patch;
}

@Injectable()
export class PgGovernanceDocumentStore implements GovernanceDocumentStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async findByProgramAndDocumentId(programId: string, documentId: string): Promise<GovernanceDocumentRecord | null> {
    const rows = await this.q
      .select()
      .from(DOCS)
      .where(and(eq(DOCS.programId, programId), eq(DOCS.documentId, documentId)))
      .limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async upsertFromWorkspace(input: GovernanceDocumentUpsertInput): Promise<GovernanceDocumentRecord> {
    const id = newObjectId();
    const rows = await this.q
      .insert(DOCS)
      .values({
        id,
        programId: input.programId,
        documentId: input.documentId,
        workspaceId: input.workspaceId,
        status: 'captured',
        validity: input.validity,
        validityNextReviewAt: this.nextReviewAtOf(input.validity),
        validityBusinessStatus: this.businessStatusOf(input.validity),
        tags: [],
        metadata: {},
        ownerUserId: input.ownerUserId ?? null,
        ownerScopeId: input.ownerScopeId ?? null,
        governanceRevision: 0,
        temporalDecisionRevision: 0,
        lastIntegrationEventId: input.integrationEvent?.id ?? null,
        lastIntegrationEventAt: input.integrationEvent?.occurredAt ?? null,
      })
      .onConflictDoUpdate({
        target: [DOCS.programId, DOCS.documentId],
        set: {
          workspaceId: sql`excluded.workspace_id`,
          ...(input.integrationEvent
            ? { lastIntegrationEventId: sql`excluded.last_integration_event_id`, lastIntegrationEventAt: sql`excluded.last_integration_event_at` }
            : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return documentRowToRecord(rows[0]);
  }

  private nextReviewAtOf(validity: Record<string, unknown>): Date | null {
    const value = validity?.nextReviewAt;
    if (!value) return null;
    return value instanceof Date ? value : new Date(String(value));
  }

  private businessStatusOf(validity: Record<string, unknown>): string | null {
    return normalizeBusinessStatus(validity?.businessStatus);
  }

  async listForProgramWorkspaces(programId: string, workspaceIds: string[], includeArchived: boolean): Promise<GovernanceDocumentRecord[]> {
    if (workspaceIds.length === 0) return [];
    const rows = await this.q
      .select()
      .from(DOCS)
      .where(
        and(
          eq(DOCS.programId, programId),
          inArray(DOCS.workspaceId, workspaceIds),
          ...(includeArchived ? [] : [ne(DOCS.status, 'archived')]),
        ),
      )
      .orderBy(desc(DOCS.updatedAt));
    return rows.map(documentRowToRecord);
  }

  async findById(id: string): Promise<GovernanceDocumentRecord | null> {
    const rows = await this.q.select().from(DOCS).where(eq(DOCS.id, id)).limit(1);
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async updateGuarded(id: string, guard: GovernanceDocumentUpdateGuard, update: GovernanceDocumentUpdate): Promise<GovernanceDocumentRecord | null> {
    const patch = buildPatch(update);
    const conditions = [eq(DOCS.id, id)];
    if (guard.governanceRevision !== undefined) conditions.push(eq(DOCS.governanceRevision, guard.governanceRevision));
    if (guard.temporalDecisionRevision !== undefined) conditions.push(eq(DOCS.temporalDecisionRevision, guard.temporalDecisionRevision));
    if (guard.statusEquals !== undefined) conditions.push(eq(DOCS.status, guard.statusEquals));
    if (guard.statusNotEquals !== undefined) conditions.push(ne(DOCS.status, guard.statusNotEquals));
    const rows = await this.q
      .update(DOCS)
      .set({
        ...patch,
        // Keep the promoted validity columns in lockstep with the jsonb payload.
        ...(patch.validity !== undefined
          ? {
              validityNextReviewAt: this.nextReviewAtOf(patch.validity),
              validityBusinessStatus: this.businessStatusOf(patch.validity),
            }
          : {}),
        ...(update.bumpGovernanceRevision ? { governanceRevision: sql`${DOCS.governanceRevision} + 1` } : {}),
        ...(update.bumpTemporalDecisionRevision ? { temporalDecisionRevision: sql`${DOCS.temporalDecisionRevision} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async archiveFromWorkspaceDeletion(programId: string, documentId: string, actorId: string, event: { id: string; occurredAt: Date }): Promise<GovernanceDocumentRecord | null> {
    const rows = await this.q
      .update(DOCS)
      .set({
        status: 'archived',
        archivedAt: event.occurredAt,
        archivedBy: actorId,
        archiveReason: 'Workspace document deleted',
        lastIntegrationEventId: event.id,
        lastIntegrationEventAt: event.occurredAt,
        governanceRevision: sql`${DOCS.governanceRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(DOCS.programId, programId),
          eq(DOCS.documentId, documentId),
          ne(DOCS.status, 'archived'),
          or(isNull(DOCS.lastIntegrationEventId), ne(DOCS.lastIntegrationEventId, event.id)),
        ),
      )
      .returning();
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async deleteByIdGuarded(id: string, expectedGovernanceRevision: number): Promise<boolean> {
    const rows = await this.q
      .delete(DOCS)
      .where(and(eq(DOCS.id, id), eq(DOCS.governanceRevision, expectedGovernanceRevision), eq(DOCS.status, 'archived')))
      .returning({ id: DOCS.id });
    return rows.length === 1;
  }

  async countByProgram(programId: string): Promise<number> {
    const rows = await this.q.select({ count: sql<number>`count(*)::int` }).from(DOCS).where(eq(DOCS.programId, programId));
    return rows[0]?.count ?? 0;
  }

  async listDueForReview(now: Date, limit: number): Promise<GovernanceDocumentRecord[]> {
    const rows = await this.q
      .select()
      .from(DOCS)
      .where(
        and(
          notInArray(DOCS.status, ['rejected', 'archived']),
          lte(DOCS.validityNextReviewAt, now),
          or(isNull(DOCS.validityBusinessStatus), notInArray(DOCS.validityBusinessStatus, ['needs_review', 'expired', 'suspended', 'conflicting'])),
        ),
      )
      .orderBy(asc(DOCS.validityNextReviewAt))
      .limit(limit);
    return rows.map(documentRowToRecord);
  }

  async markNeedsReviewIfUnchanged(id: string, previousBusinessStatus: string | null | undefined, previousNextReviewAt: Date | undefined | null): Promise<boolean> {
    // Optimistic guard: business status must still be the observed value and
    // the promoted review timestamp must be IS NOT DISTINCT FROM the observed one.
    const validityStatus = sql`jsonb_set(coalesce(${DOCS.validity}, '{}'::jsonb), '{businessStatus}', to_jsonb('needs_review'::text), true)`;
    // IS NOT DISTINCT FROM so a NULL observed value (normalised from '' / null / missing)
    // still matches; a plain `=` never matches NULL and would leave the row due forever.
    const observedStatus = normalizeBusinessStatus(previousBusinessStatus);
    const observedDue = previousNextReviewAt ?? null;
    const conditions = [
      eq(DOCS.id, id),
      sql`${DOCS.validityBusinessStatus} IS NOT DISTINCT FROM ${observedStatus}`,
      sql`${DOCS.validityNextReviewAt} IS NOT DISTINCT FROM ${observedDue === null ? null : observedDue.toISOString()}::timestamptz`,
    ];
    const rows = await this.q
      .update(DOCS)
      .set({
        validity: validityStatus,
        validityBusinessStatus: 'needs_review',
        governanceRevision: sql`${DOCS.governanceRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning({ id: DOCS.id });
    return rows.length === 1;
  }

  async patchValidityForDocument(programId: string, documentId: string, patch: { nextReviewAt: Date; reviewFrequencyDays: number }): Promise<GovernanceDocumentRecord | null> {
    const validity = sql`jsonb_set(jsonb_set(coalesce(${DOCS.validity}, '{}'::jsonb), '{nextReviewAt}', to_jsonb(${patch.nextReviewAt.toISOString()}::text), true), '{reviewFrequencyDays}', to_jsonb(${patch.reviewFrequencyDays}) , true)`;
    const rows = await this.q
      .update(DOCS)
      .set({
        validity,
        validityNextReviewAt: patch.nextReviewAt,
        governanceRevision: sql`${DOCS.governanceRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(DOCS.programId, programId), eq(DOCS.documentId, documentId), notInArray(DOCS.status, ['rejected', 'archived'])))
      .returning();
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async setMetadataField(programId: string, documentId: string, key: string, value: unknown): Promise<GovernanceDocumentRecord | null> {
    // Fully parameterised: key and value are bound, never spliced into the SQL text.
    const metadata = sql`jsonb_set(coalesce(${DOCS.metadata}, '{}'::jsonb), ARRAY[${key}::text], ${JSON.stringify(value ?? null)}::jsonb, true)`;
    const rows = await this.q
      .update(DOCS)
      .set({ metadata, governanceRevision: sql`${DOCS.governanceRevision} + 1`, updatedAt: new Date() })
      .where(and(eq(DOCS.programId, programId), eq(DOCS.documentId, documentId), notInArray(DOCS.status, ['rejected', 'archived'])))
      .returning();
    return rows[0] ? documentRowToRecord(rows[0]) : null;
  }

  async listByIdCursor(programId: string, workspaceId: string, afterId: string | undefined, limit: number): Promise<GovernanceDocumentRecord[]> {
    const rows = await this.q
      .select()
      .from(DOCS)
      .where(
        and(
          eq(DOCS.programId, programId),
          eq(DOCS.workspaceId, workspaceId),
          ...(afterId ? [gt(DOCS.id, afterId)] : []),
        ),
      )
      .orderBy(asc(DOCS.id))
      .limit(limit);
    return rows.map(documentRowToRecord);
  }


  async listNonArchived(limit: number): Promise<GovernanceDocumentRecord[]> {
    const rows = await this.q
      .select()
      .from(DOCS)
      .where(notInArray(DOCS.status, ['rejected', 'archived']))
      .orderBy(asc(DOCS.updatedAt))
      .limit(limit);
    return rows.map(documentRowToRecord);
  }

  async clearOwnerScopes(programId: string, scopeIds: string[]): Promise<void> {
    if (scopeIds.length === 0) return;
    await this.q
      .update(DOCS)
      .set({ ownerScopeId: null, governanceRevision: sql`${DOCS.governanceRevision} + 1`, updatedAt: new Date() })
      .where(and(eq(DOCS.programId, programId), inArray(DOCS.ownerScopeId, scopeIds)));
  }
}
