import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lte, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { ValidityEvidence } from '@modules/governance/domain/document-validity';
import type { TemporalCandidate, TemporalValidationResult } from '@modules/governance/domain/temporal-candidate';
import type { TemporalCandidateDecisionStatus, TemporalCandidateRecordRecord } from '../knowledge-intelligence.types';
import { defined } from './knowledge-sql';

const DECISION_LEASE_MS = 120_000;

const t = schema.governanceTemporalCandidateRecords;
type Row = typeof t.$inferSelect;

function toRecord(row: Row): TemporalCandidateRecordRecord {
  return defined({
    id: row.id,
    programId: row.programId,
    documentId: row.documentId,
    jobId: row.jobId,
    candidateId: row.candidateId,
    candidate: row.candidate as unknown as TemporalCandidate,
    validation: row.validation as unknown as TemporalValidationResult,
    evidence: row.evidence as unknown as ValidityEvidence[],
    decisionStatus: row.decisionStatus as TemporalCandidateDecisionStatus,
    decisionLeaseExpiresAt: row.decisionLeaseExpiresAt,
    decisionToken: row.decisionToken,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionComment: row.decisionComment,
    correctedCandidate: row.correctedCandidate as unknown as TemporalCandidate | null,
    inputHash: row.inputHash,
    engineVersion: row.engineVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) as TemporalCandidateRecordRecord;
}

/** PostgreSQL governance.temporal_candidate_records repository (roadmap P6). */
@Injectable()
export class TemporalCandidateRepositoryService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Inserts the candidates that are new for this (program, document, candidate, input hash); existing ones stay as decided. */
  async upsertMany(input: { programId: string; documentId: string; jobId: string; inputHash: string; engineVersion: string; candidates: { candidate: TemporalCandidate; validation: TemporalValidationResult; evidence: ValidityEvidence[] }[] }): Promise<void> {
    if (!input.candidates.length) return;
    await this.q
      .insert(t)
      .values(input.candidates.map(({ candidate, validation, evidence }) => ({
        id: newObjectId(),
        programId: normalizeObjectId(input.programId),
        documentId: normalizeObjectId(input.documentId),
        jobId: normalizeObjectId(input.jobId),
        candidateId: candidate.candidateId,
        candidate: stripNul(candidate) as unknown as Record<string, unknown>,
        validation: stripNul(validation) as unknown as Record<string, unknown>,
        evidence: stripNul(evidence) as unknown as Record<string, unknown>[],
        decisionStatus: 'pending' as const,
        inputHash: input.inputHash,
        engineVersion: input.engineVersion,
      })))
      .onConflictDoNothing({ target: [t.programId, t.documentId, t.candidateId, t.inputHash] });
  }

  async list(documentId: string): Promise<TemporalCandidateRecordRecord[]> {
    if (!isObjectId(documentId)) return [];
    const rows = await this.q
      .select()
      .from(t)
      .where(eq(t.documentId, normalizeObjectId(documentId)))
      .orderBy(desc(t.createdAt), desc(t.id));
    return rows.map(toRecord);
  }

  /** Takes the decision lease of a pending record (or of one whose lease expired). */
  async beginDecision(documentId: string, recordId: string): Promise<TemporalCandidateRecordRecord | null> {
    if (!isObjectId(documentId) || !isObjectId(recordId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({ decisionStatus: 'processing', decisionLeaseExpiresAt: new Date(now.getTime() + DECISION_LEASE_MS), decisionToken: randomUUID(), updatedAt: now })
      .where(and(
        eq(t.id, normalizeObjectId(recordId)),
        eq(t.documentId, normalizeObjectId(documentId)),
        or(
          eq(t.decisionStatus, 'pending'),
          and(eq(t.decisionStatus, 'processing'), lte(t.decisionLeaseExpiresAt, now)),
        ),
      ))
      .returning();
    return row ? toRecord(row) : null;
  }

  /** Runs inside the caller's ambient transaction, when there is one. */
  async markDecision(recordId: string, decisionToken: string, actorId: string, status: 'confirmed' | 'corrected' | 'rejected', comment?: string, correctedCandidate?: TemporalCandidate): Promise<TemporalCandidateRecordRecord | null> {
    if (!isObjectId(recordId) || !isObjectId(actorId)) return null;
    const now = new Date();
    const [row] = await this.q
      .update(t)
      .set({
        decisionStatus: status,
        decidedBy: normalizeObjectId(actorId),
        decidedAt: now,
        ...(comment !== undefined ? { decisionComment: stripNul(comment) } : {}),
        ...(correctedCandidate !== undefined ? { correctedCandidate: stripNul(correctedCandidate) as unknown as Record<string, unknown> } : {}),
        decisionLeaseExpiresAt: null,
        decisionToken: null,
        updatedAt: now,
      })
      .where(and(eq(t.id, normalizeObjectId(recordId)), eq(t.decisionStatus, 'processing'), eq(t.decisionToken, decisionToken)))
      .returning();
    return row ? toRecord(row) : null;
  }

  async releaseDecision(recordId: string, decisionToken: string): Promise<void> {
    if (!isObjectId(recordId)) return;
    await this.q
      .update(t)
      .set({ decisionStatus: 'pending', decisionLeaseExpiresAt: null, decisionToken: null, updatedAt: new Date() })
      .where(and(eq(t.id, normalizeObjectId(recordId)), eq(t.decisionStatus, 'processing'), eq(t.decisionToken, decisionToken)));
  }

  /** True while the caller still holds the decision lease; read inside the caller's transaction. */
  async ownsDecision(recordId: string, decisionToken: string): Promise<boolean> {
    if (!isObjectId(recordId)) return false;
    const rows = await this.q
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.id, normalizeObjectId(recordId)), eq(t.decisionStatus, 'processing'), eq(t.decisionToken, decisionToken)))
      .limit(1);
    return rows.length > 0;
  }

  async purgeDocument(documentId: string): Promise<void> {
    if (!isObjectId(documentId)) return;
    await this.q.delete(t).where(eq(t.documentId, normalizeObjectId(documentId)));
  }
}
