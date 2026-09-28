import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { KnowledgeAssessmentDimensions, KnowledgeHealthStatus } from '../domain/knowledge-steward';
import type { KnowledgeAssessmentRecord } from '../knowledge-intelligence.types';
import { ids, scopeFilter } from './knowledge-sql';

const t = schema.governanceKnowledgeAssessments;
type Row = typeof t.$inferSelect;

function toRecord(row: Row): KnowledgeAssessmentRecord {
  return {
    id: row.id,
    programId: row.programId,
    scopeIds: row.scopeIds,
    documentId: row.documentId,
    assessmentVersion: row.assessmentVersion,
    inputHash: row.inputHash,
    assessedAt: row.assessedAt,
    dimensions: row.dimensions as unknown as KnowledgeAssessmentDimensions,
    overallHealthScore: row.overallHealthScore,
    status: row.status as KnowledgeHealthStatus,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** PostgreSQL governance.knowledge_assessments repository (roadmap P6). */
@Injectable()
export class KnowledgeAssessmentRepositoryService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async upsert(input: { programId: string; scopeIds: string[]; documentId: string; assessmentVersion: string; inputHash: string; assessedAt: Date; dimensions: KnowledgeAssessmentDimensions; overallHealthScore: number; status: KnowledgeHealthStatus; summary: string }): Promise<KnowledgeAssessmentRecord> {
    const mutable = {
      scopeIds: ids(input.scopeIds),
      assessedAt: input.assessedAt,
      dimensions: stripNul(input.dimensions) as unknown as Record<string, unknown>,
      overallHealthScore: input.overallHealthScore,
      status: input.status,
      summary: stripNul(input.summary),
    };
    const [row] = await this.q
      .insert(t)
      .values({
        id: newObjectId(),
        programId: normalizeObjectId(input.programId),
        documentId: normalizeObjectId(input.documentId),
        assessmentVersion: input.assessmentVersion,
        inputHash: input.inputHash,
        ...mutable,
      })
      .onConflictDoUpdate({
        target: [t.programId, t.documentId, t.assessmentVersion, t.inputHash],
        set: { ...mutable, updatedAt: new Date() },
      })
      .returning();
    return toRecord(row);
  }

  /** The newest assessment of each document, most recently assessed first. */
  async latestByProgram(programId: string, scopeIds?: string[]): Promise<KnowledgeAssessmentRecord[]> {
    if (!isObjectId(programId)) return [];
    const newest = this.q
      .selectDistinctOn([t.documentId])
      .from(t)
      .where(and(eq(t.programId, normalizeObjectId(programId)), scopeFilter(t.scopeIds, scopeIds)))
      .orderBy(t.documentId, desc(t.assessedAt))
      .as('newest');
    const rows = await this.q.select().from(newest).orderBy(desc(newest.assessedAt));
    return rows.map((row) => toRecord(row as Row));
  }

  async purgeDocument(documentId: string): Promise<void> {
    if (!isObjectId(documentId)) return;
    await this.q.delete(t).where(eq(t.documentId, normalizeObjectId(documentId)));
  }
}
