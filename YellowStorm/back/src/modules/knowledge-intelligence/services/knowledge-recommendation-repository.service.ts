import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lte, notInArray, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { KnowledgePriority, KnowledgeRecommendationType } from '../domain/knowledge-steward';
import type { KnowledgeRecommendationRecord, KnowledgeRecommendationStatus } from '../knowledge-intelligence.types';
import { defined, ids, scopeFilter } from './knowledge-sql';

export interface KnowledgeRecommendationInput { programId: string; scopeIds: string[]; documentId: string; alertIds: string[]; type: KnowledgeRecommendationType; priority: KnowledgePriority; reason: string; impactSummary: string; proposedAction?: Record<string, unknown>; deduplicationKey: string; }

const APPLICATION_LEASE_MS = 120_000;

const t = schema.governanceKnowledgeRecommendations;
type Row = typeof t.$inferSelect;

function toRecord(row: Row): KnowledgeRecommendationRecord {
  return defined({
    id: row.id,
    programId: row.programId,
    scopeIds: row.scopeIds,
    documentId: row.documentId,
    alertIds: row.alertIds,
    type: row.type as KnowledgeRecommendationType,
    priority: row.priority as KnowledgePriority,
    reason: row.reason,
    impactSummary: row.impactSummary,
    proposedAction: row.proposedAction,
    status: row.status as KnowledgeRecommendationStatus,
    deduplicationKey: row.deduplicationKey,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
    appliedBy: row.appliedBy,
    appliedAt: row.appliedAt,
    applicationToken: row.applicationToken,
    applicationLeaseExpiresAt: row.applicationLeaseExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) as KnowledgeRecommendationRecord;
}

/** PostgreSQL governance.knowledge_recommendations repository (roadmap P6). */
@Injectable()
export class KnowledgeRecommendationRepositoryService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Upserts the document's recommendations, then supersedes the proposed ones that were not raised again. */
  async synchronize(documentId: string, recommendations: KnowledgeRecommendationInput[]): Promise<void> {
    const docId = normalizeObjectId(documentId);
    const byKey = new Map(recommendations.map((item) => [item.deduplicationKey, item]));
    const keys = [...byKey.keys()];
    await withTransaction(this.db, async () => {
      for (const item of byKey.values()) await this.synchronizeOne(item);
      await this.q
        .update(t)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(and(
          eq(t.documentId, docId),
          eq(t.status, 'proposed'),
          keys.length ? notInArray(t.deduplicationKey, keys) : undefined,
        ));
    });
  }

  async list(programId: string, filter: { scopeIds?: string[]; status?: KnowledgeRecommendationStatus; priority?: KnowledgePriority }): Promise<KnowledgeRecommendationRecord[]> {
    if (!isObjectId(programId)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.programId, normalizeObjectId(programId)),
        scopeFilter(t.scopeIds, filter.scopeIds),
        filter.status ? eq(t.status, filter.status) : undefined,
        filter.priority ? eq(t.priority, filter.priority) : undefined,
      ))
      // Same lexical ordering the Mongo sort produced (status, then priority as text).
      .orderBy(asc(t.status), asc(t.priority), desc(t.createdAt))
      .limit(500);
    return rows.map(toRecord);
  }

  async decide(programId: string, id: string, actorId: string, action: 'accept' | 'reject', accessibleScopeIds: string[], reason?: string): Promise<KnowledgeRecommendationRecord | null> {
    if (!isObjectId(programId) || !isObjectId(id) || !isObjectId(actorId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({
        status: action === 'accept' ? 'accepted' : 'rejected',
        decidedBy: normalizeObjectId(actorId),
        decidedAt: now,
        ...(reason !== undefined ? { decisionReason: stripNul(reason) } : {}),
        updatedAt: now,
      })
      .where(and(
        eq(t.id, normalizeObjectId(id)),
        eq(t.programId, normalizeObjectId(programId)),
        eq(t.status, 'proposed'),
        scopeFilter(t.scopeIds, accessibleScopeIds),
      ))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Takes the apply lease of an accepted recommendation, unless another caller holds a live one. */
  async beginApply(programId: string, id: string, accessibleScopeIds: string[]): Promise<KnowledgeRecommendationRecord | null> {
    if (!isObjectId(programId) || !isObjectId(id)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({ applicationToken: randomUUID(), applicationLeaseExpiresAt: new Date(now.getTime() + APPLICATION_LEASE_MS), updatedAt: now })
      .where(and(
        eq(t.id, normalizeObjectId(id)),
        eq(t.programId, normalizeObjectId(programId)),
        eq(t.status, 'accepted'),
        scopeFilter(t.scopeIds, accessibleScopeIds),
        or(isNull(t.applicationToken), lte(t.applicationLeaseExpiresAt, now)),
      ))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Runs inside the caller's ambient transaction, when there is one. */
  async markApplied(id: string, actorId: string, applicationToken: string): Promise<KnowledgeRecommendationRecord | null> {
    if (!isObjectId(id) || !isObjectId(actorId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({ status: 'applied', appliedBy: normalizeObjectId(actorId), appliedAt: now, applicationToken: null, applicationLeaseExpiresAt: null, updatedAt: now })
      .where(and(eq(t.id, normalizeObjectId(id)), eq(t.status, 'accepted'), eq(t.applicationToken, applicationToken)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async releaseApplication(id: string, applicationToken: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(t)
      .set({ applicationToken: null, applicationLeaseExpiresAt: null, updatedAt: new Date() })
      .where(and(eq(t.id, normalizeObjectId(id)), eq(t.status, 'accepted'), eq(t.applicationToken, applicationToken)));
  }

  /**
   * One atomic upsert: a new key inserts, an existing one is refreshed only while it is still
   * proposed. A concurrent insert of the same key just takes the refresh branch.
   */
  private async synchronizeOne(item: KnowledgeRecommendationInput): Promise<void> {
    const mutable = {
      scopeIds: ids(item.scopeIds),
      documentId: normalizeObjectId(item.documentId),
      alertIds: ids(item.alertIds),
      type: item.type,
      priority: item.priority,
      reason: stripNul(item.reason),
      impactSummary: stripNul(item.impactSummary),
      proposedAction: item.proposedAction ? stripNul(item.proposedAction) : null,
    };
    await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        programId: normalizeObjectId(item.programId),
        deduplicationKey: item.deduplicationKey,
        status: 'proposed',
        ...mutable,
      })
      .onConflictDoUpdate({
        target: [t.programId, t.deduplicationKey],
        set: { ...mutable, updatedAt: new Date() },
        setWhere: eq(t.status, 'proposed'),
      });
  }
}
