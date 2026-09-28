import { eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { BackfillError } from '../../../scripts/migrate/harness';
import { compareRowChecksums } from '../../../scripts/migrate/reconcile';
import { insertKnowledgeRow, KNOWLEDGE_UNITS, type KnowledgeUnit, type Row } from '../../../scripts/migrate/2026-10-knowledge-intelligence.units';
import { describeIntegration, makeTestDb } from '../postgres/testing/pg-integration';

/**
 * The knowledge-intelligence collections are empty in dev, so the backfill would never run
 * against real rows there. This drives the same mapping and insert with fabricated Mongo-shaped
 * documents and checks every row reads back identical.
 */
describeIntegration('knowledge-intelligence backfill mapping (integration)', () => {
  const { db, pool, close } = makeTestDb();
  const oid = (): string => newObjectId();
  const unitOf = (name: string): KnowledgeUnit => KNOWLEDGE_UNITS.find((u) => u.name === name)!;
  const at = (iso: string): Date => new Date(iso);

  // Ids are fixed up front: the fabricated documents below are built at describe time.
  const userId = oid();
  const programId = oid();
  const workspaceId = oid();
  const documentId = oid();
  const connectorId = oid();
  const scope = oid();
  const jobId = oid();

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: userId, email: `ki-bf-${userId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    await db.insert(schema.governancePrograms).values({ id: programId, name: 'ki backfill program', ownerUserId: userId });
    await db.insert(schema.workspaces).values({ id: workspaceId, name: 'ki bf ws', alias: `ki-bf-${workspaceId}`, storagePrefix: `ki-bf-${workspaceId}`, createdBy: userId, allocatedStorage: 1 });
    await db.insert(schema.workspaceDocuments).values({ id: documentId, originalName: 'bf.pdf', mimeType: 'application/pdf', size: 1, workspaceId, createdBy: userId });
    await db.insert(schema.integrationsConnectors).values({ id: connectorId, slug: `ki-bf-${connectorId}`, name: 'ki bf', description: '', mcpServerUrl: 'http://localhost:0/mcp', createdBy: userId });
  });

  afterAll(async () => {
    await db.delete(schema.governancePrograms).where(eq(schema.governancePrograms.id, programId));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await db.delete(schema.integrationsConnectors).where(eq(schema.integrationsConnectors.id, connectorId));
    await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, userId));
    await close();
  });

  /** Documents as the Mongo driver returns them: ObjectId values, Date values, absent optionals. */
  const mongoDocs: Record<string, Record<string, unknown>> = {
    jobs: {
      _id: new Types.ObjectId(jobId), programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId),
      connectorId: new Types.ObjectId(connectorId), requestedByUserId: new Types.ObjectId(),
      jobType: 'temporal_extraction', status: 'failed', inputHash: 'in-1', engineVersion: 'e1', attempts: 2, error: 'bad\u0000news',
      startedAt: at('2026-03-01T10:00:00Z'), completedAt: at('2026-03-01T10:01:00Z'), nextAttemptAt: at('2026-03-01T10:05:00Z'),
      createdAt: at('2026-03-01T09:59:00Z'), updatedAt: at('2026-03-01T10:01:00Z'),
    },
    temporal: {
      _id: new Types.ObjectId(), programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId), jobId: new Types.ObjectId(jobId),
      candidateId: 'cand-1', candidate: { candidateId: 'cand-1', date: '2026-12-31', nested: { a: [1, 2] } }, validation: { valid: true },
      evidence: [{ text: 'clause 4' }], decisionStatus: 'confirmed', decidedBy: new Types.ObjectId(), decidedAt: at('2026-03-02T00:00:00Z'),
      decisionComment: 'looks right', correctedCandidate: { candidateId: 'cand-1', date: '2027-01-01' }, inputHash: 'in-1', engineVersion: 'e1',
      createdAt: at('2026-03-01T10:02:00Z'), updatedAt: at('2026-03-02T00:00:00Z'),
    },
    alerts: {
      _id: new Types.ObjectId(), programId: new Types.ObjectId(programId), scopeIds: [new Types.ObjectId(scope)], documentId: new Types.ObjectId(documentId),
      category: 'freshness', severity: 'high', status: 'acknowledged', title: 'Stale', description: 'Not reviewed', deduplicationKey: 'dk-1',
      evidenceRefs: ['e1', 'e2'], openedAt: at('2026-03-01T00:00:00Z'), acknowledgedBy: new Types.ObjectId(), acknowledgedAt: at('2026-03-01T01:00:00Z'),
      createdAt: at('2026-03-01T00:00:00Z'), updatedAt: at('2026-03-01T01:00:00Z'),
    },
    assessments: {
      _id: new Types.ObjectId(), programId: new Types.ObjectId(programId), scopeIds: [], documentId: new Types.ObjectId(documentId),
      assessmentVersion: 'v1', inputHash: 'in-1', assessedAt: at('2026-03-03T00:00:00Z'),
      dimensions: { businessValidity: { score: 80, status: 'pass', factors: [{ code: 'x', contribution: 1, message: 'm' }] } },
      overallHealthScore: 80, status: 'healthy', summary: 'fine', createdAt: at('2026-03-03T00:00:00Z'), updatedAt: at('2026-03-03T00:00:00Z'),
    },
    recommendations: {
      _id: new Types.ObjectId(), programId: new Types.ObjectId(programId), scopeIds: [new Types.ObjectId(scope)], documentId: new Types.ObjectId(documentId),
      alertIds: [new Types.ObjectId()], type: 'schedule_review', priority: 'medium', reason: 'r', impactSummary: 'i', proposedAction: { reviewFrequencyDays: 30 },
      status: 'accepted', deduplicationKey: 'dk-2', decidedBy: new Types.ObjectId(), decidedAt: at('2026-03-04T00:00:00Z'),
      createdAt: at('2026-03-04T00:00:00Z'), updatedAt: at('2026-03-04T00:00:00Z'),
    },
    metadata: {
      _id: new Types.ObjectId(), programId: new Types.ObjectId(programId), scopeIds: [], documentId: new Types.ObjectId(documentId),
      key: 'owner', proposedValue: { name: 'ACME', tags: ['a'] }, candidateType: 'business', confidence: 0.75, riskLevel: 'low', evidenceRefs: ['e1'],
      status: 'accepted', candidateKey: 'ck-1', acceptedValue: 'ACME Corp', decidedBy: new Types.ObjectId(), decidedAt: at('2026-03-05T00:00:00Z'),
      createdAt: at('2026-03-05T00:00:00Z'), updatedAt: at('2026-03-05T00:00:00Z'),
    },
  };

  it.each(KNOWLEDGE_UNITS.map((u) => [u.name]))('%s: every column maps, inserts and reads back identical', async (name) => {
    const unit = unitOf(name);
    // The user references are random ids: give them a real row so the foreign keys hold.
    const doc = { ...mongoDocs[name] };
    for (const field of ['requestedByUserId', 'acknowledgedBy', 'decidedBy']) if (field in doc) doc[field] = new Types.ObjectId(userId);
    const row = unit.build(doc);
    await insertKnowledgeRow(pool, unit, row);

    const back = await pool.query(`SELECT ${unit.columns.join(', ')} FROM ${unit.table} WHERE id = $1`, [row.id]);
    expect(back.rows).toHaveLength(1);
    const result = compareRowChecksums(new Map([[String(row.id), row]]), new Map([[String(row.id), back.rows[0] as Row]]));
    expect(result).toMatchObject({ match: true, compared: 1, mismatchTotal: 0 });
  });

  it('is idempotent: a second insert of the same id is a no-op', async () => {
    const unit = unitOf('alerts');
    const row = unit.build({ ...mongoDocs.alerts, _id: new Types.ObjectId(), deduplicationKey: 'dk-idem', acknowledgedBy: new Types.ObjectId(userId) });
    await insertKnowledgeRow(pool, unit, row);
    await insertKnowledgeRow(pool, unit, { ...row, title: 'changed' });
    const back = await pool.query(`SELECT title FROM ${unit.table} WHERE id = $1`, [row.id]);
    expect(back.rows).toEqual([{ title: 'Stale' }]);
  });

  it('strips U+0000 and keeps a bare JSON scalar and JSON null distinguishable', async () => {
    const jobs = unitOf('jobs');
    expect(jobs.build({ ...mongoDocs.jobs, requestedByUserId: undefined }).error).toBe('badnews');

    const metadata = unitOf('metadata');
    const scalar = metadata.build({ ...mongoDocs.metadata, _id: new Types.ObjectId(), candidateKey: 'ck-scalar', proposedValue: 'plain text', acceptedValue: undefined, decidedBy: new Types.ObjectId(userId) });
    const empty = metadata.build({ ...mongoDocs.metadata, _id: new Types.ObjectId(), candidateKey: 'ck-null', proposedValue: undefined, acceptedValue: undefined, decidedBy: new Types.ObjectId(userId) });
    await insertKnowledgeRow(pool, metadata, scalar);
    await insertKnowledgeRow(pool, metadata, empty);
    const rows = await pool.query(
      `SELECT candidate_key, proposed_value, accepted_value, jsonb_typeof(proposed_value) AS proposed_type FROM ${metadata.table} WHERE id = ANY($1::char(24)[])`,
      [[scalar.id, empty.id]],
    );
    const byKey = new Map(rows.rows.map((r) => [r.candidate_key, r]));
    expect(byKey.get('ck-scalar')).toMatchObject({ proposed_value: 'plain text', proposed_type: 'string', accepted_value: null });
    // A missing proposed value is the JSON value null (the column is NOT NULL); an absent accepted value is SQL NULL.
    expect(byKey.get('ck-null')).toMatchObject({ proposed_value: null, proposed_type: 'null', accepted_value: null });
  });

  it('reports a malformed id as a failure and lets the foreign keys reject an orphan', async () => {
    expect(() => unitOf('alerts').build({ ...mongoDocs.alerts, _id: 'not-an-id' })).toThrow(BackfillError);
    expect(() => unitOf('alerts').build({ ...mongoDocs.alerts, programId: undefined })).toThrow(/programId/);

    const orphan = unitOf('alerts').build({ ...mongoDocs.alerts, _id: new Types.ObjectId(), deduplicationKey: 'dk-orphan', programId: new Types.ObjectId(), acknowledgedBy: new Types.ObjectId(userId) });
    await expect(insertKnowledgeRow(pool, unitOf('alerts'), orphan)).rejects.toThrow(/foreign key/i);
  });
});
