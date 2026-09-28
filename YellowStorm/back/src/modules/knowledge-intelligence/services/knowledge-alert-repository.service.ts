import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { KnowledgePriority } from '../domain/knowledge-steward';
import type { KnowledgeAlertCategory, KnowledgeAlertRecord, KnowledgeAlertStatus } from '../knowledge-intelligence.types';
import { defined, ids, scopeFilter } from './knowledge-sql';

export interface KnowledgeAlertInput { programId: string; scopeIds: string[]; documentId: string; category: KnowledgeAlertCategory; severity: KnowledgePriority; title: string; description: string; deduplicationKey: string; evidenceRefs: string[]; }

const t = schema.governanceKnowledgeAlerts;
type Row = typeof t.$inferSelect;

function toRecord(row: Row): KnowledgeAlertRecord {
  return defined({
    id: row.id,
    programId: row.programId,
    scopeIds: row.scopeIds,
    documentId: row.documentId,
    category: row.category as KnowledgeAlertCategory,
    severity: row.severity as KnowledgePriority,
    status: row.status as KnowledgeAlertStatus,
    title: row.title,
    description: row.description,
    deduplicationKey: row.deduplicationKey,
    evidenceRefs: row.evidenceRefs,
    openedAt: row.openedAt,
    resolvedAt: row.resolvedAt,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) as KnowledgeAlertRecord;
}

/** PostgreSQL governance.knowledge_alerts repository (roadmap P6). */
@Injectable()
export class KnowledgeAlertRepositoryService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /**
   * Upserts the document's active alerts by (program, deduplication key), resolves the ones no
   * longer raised and returns the active set. A re-raised alert keeps its status and opened-at.
   */
  async synchronize(documentId: string, alerts: KnowledgeAlertInput[], now: Date): Promise<KnowledgeAlertRecord[]> {
    const docId = normalizeObjectId(documentId);
    const byKey = new Map(alerts.map((alert) => [alert.deduplicationKey, alert]));
    const activeKeys = [...byKey.keys()];
    return withTransaction(this.db, async () => {
      for (const alert of byKey.values()) {
        const mutable = {
          scopeIds: ids(alert.scopeIds),
          documentId: normalizeObjectId(alert.documentId),
          category: alert.category,
          severity: alert.severity,
          title: stripNul(alert.title),
          description: stripNul(alert.description),
          evidenceRefs: stripNul(alert.evidenceRefs),
        };
        await this.q
          .insert(t)
          .values({
            id: newObjectId(),
            programId: normalizeObjectId(alert.programId),
            deduplicationKey: alert.deduplicationKey,
            status: 'open',
            openedAt: now,
            ...mutable,
          })
          .onConflictDoUpdate({ target: [t.programId, t.deduplicationKey], set: { ...mutable, updatedAt: new Date() } });
      }
      await this.q
        .update(t)
        .set({ status: 'resolved', resolvedAt: now, updatedAt: new Date() })
        .where(and(
          eq(t.documentId, docId),
          inArray(t.status, ['open', 'acknowledged']),
          activeKeys.length ? notInArray(t.deduplicationKey, activeKeys) : undefined,
        ));
      if (!activeKeys.length) return [];
      const rows = await this.q
        .select()
        .from(t)
        .where(and(eq(t.documentId, docId), inArray(t.deduplicationKey, activeKeys)))
        .orderBy(asc(t.createdAt), asc(t.id));
      return rows.map(toRecord);
    });
  }

  async list(programId: string, filter: { scopeIds?: string[]; status?: KnowledgeAlertStatus; category?: KnowledgeAlertCategory; severity?: KnowledgePriority }): Promise<KnowledgeAlertRecord[]> {
    if (!isObjectId(programId)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.programId, normalizeObjectId(programId)),
        scopeFilter(t.scopeIds, filter.scopeIds),
        filter.status ? eq(t.status, filter.status) : undefined,
        filter.category ? eq(t.category, filter.category) : undefined,
        filter.severity ? eq(t.severity, filter.severity) : undefined,
      ))
      // Same lexical ordering the Mongo sort produced (status, then severity as text).
      .orderBy(asc(t.status), asc(t.severity), desc(t.openedAt))
      .limit(500);
    return rows.map(toRecord);
  }

  async acknowledge(programId: string, alertId: string, actorId: string, accessibleScopeIds: string[]): Promise<KnowledgeAlertRecord | null> {
    if (!isObjectId(programId) || !isObjectId(alertId) || !isObjectId(actorId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({ status: 'acknowledged', acknowledgedBy: normalizeObjectId(actorId), acknowledgedAt: now, updatedAt: now })
      .where(and(
        eq(t.id, normalizeObjectId(alertId)),
        eq(t.programId, normalizeObjectId(programId)),
        eq(t.status, 'open'),
        scopeFilter(t.scopeIds, accessibleScopeIds),
      ))
      .returning();
    return row ? toRecord(row) : null;
  }
}
