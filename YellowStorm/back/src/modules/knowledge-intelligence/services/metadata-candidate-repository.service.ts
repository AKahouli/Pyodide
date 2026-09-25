import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, withTransaction, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { MetadataCandidateRecord, MetadataCandidateStatus } from '../knowledge-intelligence.types';
import { defined, ids, scopeFilter } from './knowledge-sql';

export interface MetadataCandidateInput { programId: string; scopeIds: string[]; documentId: string; key: string; proposedValue: unknown; candidateType: 'document' | 'business' | 'search'; confidence: number; riskLevel: 'low' | 'medium' | 'high'; evidenceRefs: string[]; candidateKey: string; }

const t = schema.governanceMetadataCandidates;
type Row = typeof t.$inferSelect;

function toRecord(row: Row): MetadataCandidateRecord {
  return {
    // A required field keeps its value even when that value is JSON null; only optional fields go absent.
    proposedValue: row.proposedValue,
    ...defined({
      id: row.id,
      programId: row.programId,
      scopeIds: row.scopeIds,
      documentId: row.documentId,
      key: row.key,
      candidateType: row.candidateType as MetadataCandidateRecord['candidateType'],
      confidence: row.confidence,
      riskLevel: row.riskLevel as MetadataCandidateRecord['riskLevel'],
      evidenceRefs: row.evidenceRefs,
      status: row.status as MetadataCandidateStatus,
      candidateKey: row.candidateKey,
      acceptedValue: row.acceptedValue,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      decisionReason: row.decisionReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }),
  } as MetadataCandidateRecord;
}

/** PostgreSQL governance.metadata_candidates repository (roadmap P6). */
@Injectable()
export class MetadataCandidateRepositoryService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Refreshes the document's candidates by (program, document, candidate key), then supersedes the proposed ones no longer raised. */
  async synchronize(documentId: string, candidates: MetadataCandidateInput[]): Promise<void> {
    const docId = normalizeObjectId(documentId);
    const byKey = new Map(candidates.map((item) => [item.candidateKey, item]));
    const keys = [...byKey.keys()];
    await withTransaction(this.db, async () => {
      for (const item of byKey.values()) {
        const mutable = {
          scopeIds: ids(item.scopeIds),
          key: stripNul(item.key),
          // The column is NOT NULL: an absent value is the JSON value null, which Mongo stored as a plain null.
          proposedValue: item.proposedValue == null ? sql`'null'::jsonb` : stripNul(item.proposedValue),
          candidateType: item.candidateType,
          confidence: item.confidence,
          riskLevel: item.riskLevel,
          evidenceRefs: stripNul(item.evidenceRefs),
        };
        await this.q
          .insert(t)
          .values({
            id: newObjectId(),
            programId: normalizeObjectId(item.programId),
            documentId: normalizeObjectId(item.documentId),
            candidateKey: item.candidateKey,
            status: 'proposed',
            ...mutable,
          })
          .onConflictDoUpdate({ target: [t.programId, t.documentId, t.candidateKey], set: { ...mutable, updatedAt: new Date() } });
      }
      await this.q
        .update(t)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(and(
          eq(t.documentId, docId),
          eq(t.status, 'proposed'),
          keys.length ? notInArray(t.candidateKey, keys) : undefined,
        ));
    });
  }

  async list(programId: string, scopeIds?: string[], status?: MetadataCandidateStatus): Promise<MetadataCandidateRecord[]> {
    if (!isObjectId(programId)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(and(
        eq(t.programId, normalizeObjectId(programId)),
        scopeFilter(t.scopeIds, scopeIds),
        status ? eq(t.status, status) : undefined,
      ))
      .orderBy(asc(t.status), desc(t.createdAt))
      .limit(500);
    return rows.map(toRecord);
  }

  /** Runs inside the caller's ambient transaction, when there is one. */
  async decide(programId: string, id: string, actorId: string, action: 'accept' | 'reject', accessibleScopeIds: string[], acceptedValue?: unknown, reason?: string): Promise<MetadataCandidateRecord | null> {
    if (!isObjectId(programId) || !isObjectId(id) || !isObjectId(actorId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({
        status: action === 'accept' ? 'accepted' : 'rejected',
        // Only an accepted candidate carries a value; a rejection leaves the column untouched.
        ...(action === 'accept' && acceptedValue !== undefined ? { acceptedValue: stripNul(acceptedValue) } : {}),
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
}
