import { eq, sql } from 'drizzle-orm';
import { newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { KnowledgeAlertRepositoryService, type KnowledgeAlertInput } from './knowledge-alert-repository.service';
import { KnowledgeAssessmentRepositoryService } from './knowledge-assessment-repository.service';
import { KnowledgeExtractionOrchestratorService } from './knowledge-extraction-orchestrator.service';
import { KnowledgeRecommendationRepositoryService, type KnowledgeRecommendationInput } from './knowledge-recommendation-repository.service';
import { MetadataCandidateRepositoryService, type MetadataCandidateInput } from './metadata-candidate-repository.service';
import { TemporalCandidateRepositoryService } from './temporal-candidate-repository.service';

describeIntegration('knowledge-intelligence repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const alerts = new KnowledgeAlertRepositoryService(db as never);
  const assessments = new KnowledgeAssessmentRepositoryService(db as never);
  const jobs = new KnowledgeExtractionOrchestratorService(db as never);
  const recommendations = new KnowledgeRecommendationRepositoryService(db as never);
  const metadata = new MetadataCandidateRepositoryService(db as never);
  const temporal = new TemporalCandidateRepositoryService(db as never);

  let userId: string;
  let otherUserId: string;
  let programId: string;
  let workspaceId: string;
  let documentId: string;
  let otherDocumentId: string;
  let connectorId: string;
  const scopeA = oid();
  const scopeB = oid();
  const past = (): Date => new Date(Date.now() - 60_000);

  beforeAll(async () => {
    userId = oid();
    otherUserId = oid();
    programId = oid();
    workspaceId = oid();
    documentId = oid();
    otherDocumentId = oid();
    connectorId = oid();
    for (const id of [userId, otherUserId]) {
      await db.insert(schema.identityUsers).values({ id, email: `ki-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
    await db.insert(schema.governancePrograms).values({ id: programId, name: 'ki spec program', ownerUserId: userId });
    await db.insert(schema.workspaces).values({
      id: workspaceId, name: 'ki spec ws', alias: `ki-spec-${workspaceId}`, storagePrefix: `ki-spec-${workspaceId}`, createdBy: userId, allocatedStorage: 1,
    });
    for (const id of [documentId, otherDocumentId]) {
      await db.insert(schema.workspaceDocuments).values({ id, originalName: `${id}.pdf`, mimeType: 'application/pdf', size: 1, workspaceId, createdBy: userId });
    }
    await db.insert(schema.integrationsConnectors).values({
      id: connectorId, slug: `ki-spec-${connectorId}`, name: 'ki spec', description: '', mcpServerUrl: 'http://localhost:0/mcp', createdBy: userId,
    });
  });

  afterAll(async () => {
    // The program, workspace and connector own every knowledge row through cascading foreign keys.
    await db.delete(schema.governancePrograms).where(eq(schema.governancePrograms.id, programId));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    await db.delete(schema.integrationsConnectors).where(eq(schema.integrationsConnectors.id, connectorId));
    for (const id of [userId, otherUserId]) await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, id));
    await close();
  });

  const alertInput = (key: string, over: Partial<KnowledgeAlertInput> = {}): KnowledgeAlertInput => ({
    programId, scopeIds: [scopeA], documentId, category: 'freshness', severity: 'high', title: `title ${key}`, description: 'd', deduplicationKey: key, evidenceRefs: ['e1'], ...over,
  });

  describe('alerts', () => {
    it('upserts by dedup key, keeps status and opened-at on re-raise, and resolves what is no longer raised', async () => {
      const key = `a-${oid()}`;
      const gone = `gone-${oid()}`;
      const t0 = new Date('2026-01-01T00:00:00Z');
      await alerts.synchronize(documentId, [alertInput(key), alertInput(gone)], t0);
      const [first] = await alerts.list(programId, { scopeIds: ['*'] }).then((rows) => rows.filter((r) => r.deduplicationKey === key));
      await alerts.acknowledge(programId, first.id, userId, ['*']);

      const t1 = new Date('2026-01-02T00:00:00Z');
      const active = await alerts.synchronize(documentId, [alertInput(key, { title: 'renamed', evidenceRefs: ['e2'] })], t1);

      expect(active).toHaveLength(1);
      expect(active[0]).toMatchObject({ id: first.id, title: 'renamed', evidenceRefs: ['e2'], status: 'acknowledged' });
      expect(active[0].openedAt.getTime()).toBe(t0.getTime());
      const all = await alerts.list(programId, { scopeIds: ['*'] });
      expect(all.find((r) => r.deduplicationKey === gone)).toMatchObject({ status: 'resolved', resolvedAt: t1 });
      expect(active[0]).not.toHaveProperty('resolvedAt');
    });

    it('returns nothing for an empty synchronize and resolves every open alert of the document', async () => {
      const key = `e-${oid()}`;
      await alerts.synchronize(otherDocumentId, [alertInput(key, { documentId: otherDocumentId })], new Date());
      expect(await alerts.synchronize(otherDocumentId, [], new Date())).toEqual([]);
      const row = (await alerts.list(programId, { scopeIds: ['*'] })).find((r) => r.deduplicationKey === key);
      expect(row?.status).toBe('resolved');
    });

    it('filters by scope overlap or no scope, and the wildcard sees everything', async () => {
      const scoped = `s-${oid()}`;
      const unscoped = `u-${oid()}`;
      const foreign = `f-${oid()}`;
      await alerts.synchronize(documentId, [
        alertInput(scoped, { scopeIds: [scopeA] }),
        alertInput(unscoped, { scopeIds: [] }),
        alertInput(foreign, { scopeIds: [scopeB] }),
      ], new Date());

      const keysFor = async (scopeIds: string[]) => (await alerts.list(programId, { scopeIds })).map((r) => r.deduplicationKey);
      const forA = await keysFor([scopeA]);
      expect(forA).toEqual(expect.arrayContaining([scoped, unscoped]));
      expect(forA).not.toContain(foreign);
      expect(await keysFor([])).toEqual(expect.arrayContaining([unscoped]));
      expect(await keysFor([])).not.toContain(scoped);
      expect(await keysFor(['*'])).toEqual(expect.arrayContaining([scoped, unscoped, foreign]));
    });

    it('acknowledges only an open alert inside the caller’s scope', async () => {
      const key = `k-${oid()}`;
      await alerts.synchronize(documentId, [alertInput(key, { scopeIds: [scopeB] })], new Date());
      const row = (await alerts.list(programId, { scopeIds: ['*'] })).find((r) => r.deduplicationKey === key)!;

      expect(await alerts.acknowledge(programId, row.id, userId, [scopeA])).toBeNull();
      const done = await alerts.acknowledge(programId, row.id, userId, [scopeB]);
      expect(done).toMatchObject({ status: 'acknowledged', acknowledgedBy: userId });
      expect(await alerts.acknowledge(programId, row.id, userId, ['*'])).toBeNull();
      expect(await alerts.acknowledge(programId, 'not-an-id', userId, ['*'])).toBeNull();
    });
  });

  describe('assessments', () => {
    const dims = { businessValidity: { score: 80, status: 'pass', factors: [] } } as never;
    const input = (over: Record<string, unknown> = {}) => ({
      programId, scopeIds: [scopeA], documentId, assessmentVersion: 'v1', inputHash: 'h1', assessedAt: new Date('2026-02-01T00:00:00Z'),
      dimensions: dims, overallHealthScore: 80, status: 'healthy' as const, summary: 'ok', ...over,
    });

    it('upserts on its identity and lists the newest assessment of each document', async () => {
      const first = await assessments.upsert(input({ documentId: otherDocumentId }));
      const again = await assessments.upsert(input({ documentId: otherDocumentId, overallHealthScore: 55, status: 'warning', summary: 'meh' }));
      expect(again.id).toBe(first.id);
      expect(again).toMatchObject({ overallHealthScore: 55, status: 'warning', summary: 'meh' });

      await assessments.upsert(input({ documentId: otherDocumentId, inputHash: 'h2', assessedAt: new Date('2026-03-01T00:00:00Z'), overallHealthScore: 90 }));
      await assessments.upsert(input({ documentId, assessedAt: new Date('2026-02-15T00:00:00Z') }));

      const latest = await assessments.latestByProgram(programId, ['*']);
      const byDoc = new Map(latest.map((r) => [r.documentId, r]));
      expect(byDoc.get(otherDocumentId)).toMatchObject({ inputHash: 'h2', overallHealthScore: 90 });
      expect(latest.filter((r) => r.documentId === otherDocumentId)).toHaveLength(1);
      const times = latest.map((r) => r.assessedAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('applies the scope filter to the latest view and purges a document', async () => {
      expect((await assessments.latestByProgram(programId, [scopeB])).some((r) => r.documentId === documentId)).toBe(false);
      expect((await assessments.latestByProgram(programId, [scopeA])).some((r) => r.documentId === documentId)).toBe(true);

      await assessments.purgeDocument(documentId);
      expect((await assessments.latestByProgram(programId, ['*'])).some((r) => r.documentId === documentId)).toBe(false);
    });

    it('stores an unhealthy score out of range as a constraint error', async () => {
      await expect(assessments.upsert(input({ inputHash: 'bad', overallHealthScore: 101 }))).rejects.toThrow();
    });
  });

  describe('recommendations', () => {
    const recInput = (key: string, over: Partial<KnowledgeRecommendationInput> = {}): KnowledgeRecommendationInput => ({
      programId, scopeIds: [scopeA], documentId, alertIds: [], type: 'schedule_review', priority: 'medium', reason: 'r', impactSummary: 'i', deduplicationKey: key, ...over,
    });
    const find = async (key: string) => (await recommendations.list(programId, { scopeIds: ['*'] })).find((r) => r.deduplicationKey === key)!;

    it('refreshes generated payloads only while still proposed, and supersedes proposals no longer raised', async () => {
      const kept = `kept-${oid()}`;
      const dropped = `dropped-${oid()}`;
      await recommendations.synchronize(documentId, [recInput(kept), recInput(dropped)]);
      const keptRow = await find(kept);
      await recommendations.decide(programId, keptRow.id, userId, 'accept', ['*']);

      await recommendations.synchronize(documentId, [recInput(kept, { reason: 'changed' })]);
      expect((await find(kept)).reason).toBe('r');
      expect((await find(dropped)).status).toBe('superseded');

      const fresh = `fresh-${oid()}`;
      await recommendations.synchronize(documentId, [recInput(fresh)]);
      await recommendations.synchronize(documentId, [recInput(fresh, { reason: 'updated', proposedAction: { reviewFrequencyDays: 7 } })]);
      expect(await find(fresh)).toMatchObject({ status: 'proposed', reason: 'updated', proposedAction: { reviewFrequencyDays: 7 } });
    });

    it('decides only a proposed recommendation inside the caller’s scope, and treats the wildcard as program-wide', async () => {
      const key = `d-${oid()}`;
      await recommendations.synchronize(documentId, [recInput(key, { scopeIds: [scopeB] })]);
      const row = await find(key);

      expect(await recommendations.decide(programId, row.id, userId, 'accept', [scopeA])).toBeNull();
      expect(await recommendations.decide(programId, row.id, userId, 'reject', ['*'], 'no thanks')).toMatchObject({
        status: 'rejected', decidedBy: userId, decisionReason: 'no thanks',
      });
      expect(await recommendations.decide(programId, row.id, userId, 'accept', ['*'])).toBeNull();
    });

    it('claims an accepted recommendation under a bounded lease and needs its token to finish', async () => {
      const key = `l-${oid()}`;
      await recommendations.synchronize(documentId, [recInput(key)]);
      const row = await find(key);
      expect(await recommendations.beginApply(programId, row.id, ['*'])).toBeNull();

      await recommendations.decide(programId, row.id, userId, 'accept', ['*']);
      const before = Date.now();
      const claimed = await recommendations.beginApply(programId, row.id, ['*']);
      expect(claimed?.applicationToken).toBeTruthy();
      const leaseMs = claimed!.applicationLeaseExpiresAt!.getTime() - before;
      expect(leaseMs).toBeGreaterThan(100_000);
      expect(leaseMs).toBeLessThanOrEqual(121_000);

      expect(await recommendations.beginApply(programId, row.id, ['*'])).toBeNull();
      expect(await recommendations.markApplied(row.id, userId, 'wrong-token')).toBeNull();

      await recommendations.releaseApplication(row.id, claimed!.applicationToken!);
      const retaken = await recommendations.beginApply(programId, row.id, ['*']);
      expect(retaken?.applicationToken).not.toBe(claimed!.applicationToken);

      const applied = await recommendations.markApplied(row.id, userId, retaken!.applicationToken!);
      expect(applied).toMatchObject({ status: 'applied', appliedBy: userId });
      expect(applied).not.toHaveProperty('applicationToken');
    });

    it('lets another caller take over an expired lease', async () => {
      const key = `x-${oid()}`;
      await recommendations.synchronize(documentId, [recInput(key)]);
      const row = await find(key);
      await recommendations.decide(programId, row.id, userId, 'accept', ['*']);
      const first = await recommendations.beginApply(programId, row.id, ['*']);
      await db.update(schema.governanceKnowledgeRecommendations)
        .set({ applicationLeaseExpiresAt: past() })
        .where(eq(schema.governanceKnowledgeRecommendations.id, row.id));

      const second = await recommendations.beginApply(programId, row.id, ['*']);
      expect(second?.applicationToken).toBeTruthy();
      expect(second?.applicationToken).not.toBe(first?.applicationToken);
    });
  });

  describe('metadata candidates', () => {
    const mcInput = (key: string, over: Partial<MetadataCandidateInput> = {}): MetadataCandidateInput => ({
      programId, scopeIds: [scopeA], documentId, key: 'owner', proposedValue: 'ACME', candidateType: 'document', confidence: 0.7, riskLevel: 'low', evidenceRefs: [], candidateKey: key, ...over,
    });
    const find = async (key: string) => (await metadata.list(programId, ['*'])).find((r) => r.candidateKey === key)!;

    it('round-trips any JSON value, refreshes on re-raise and supersedes the proposals no longer raised', async () => {
      const a = `a-${oid()}`;
      const b = `b-${oid()}`;
      await metadata.synchronize(documentId, [mcInput(a, { proposedValue: { nested: [1, 'x'] } }), mcInput(b, { proposedValue: 42 })]);
      expect((await find(a)).proposedValue).toEqual({ nested: [1, 'x'] });
      expect((await find(b)).proposedValue).toBe(42);

      await metadata.synchronize(documentId, [mcInput(a, { proposedValue: 'text', confidence: 0.9 })]);
      expect(await find(a)).toMatchObject({ proposedValue: 'text', confidence: 0.9, status: 'proposed' });
      expect((await find(b)).status).toBe('superseded');
    });

    it('accepts with a value and rejects without one, once, inside the caller’s scope', async () => {
      const accept = `acc-${oid()}`;
      const reject = `rej-${oid()}`;
      await metadata.synchronize(documentId, [mcInput(accept, { scopeIds: [scopeB] }), mcInput(reject)]);
      const toAccept = await find(accept);
      const toReject = await find(reject);

      expect(await metadata.decide(programId, toAccept.id, userId, 'accept', [scopeA], 'v')).toBeNull();
      expect(await metadata.decide(programId, toAccept.id, userId, 'accept', [scopeB], { final: true }, 'ok')).toMatchObject({
        status: 'accepted', acceptedValue: { final: true }, decisionReason: 'ok',
      });
      const rejected = await metadata.decide(programId, toReject.id, userId, 'reject', ['*'], 'ignored value', 'no');
      expect(rejected).toMatchObject({ status: 'rejected' });
      expect(rejected).not.toHaveProperty('acceptedValue');
      expect(await metadata.decide(programId, toReject.id, userId, 'accept', ['*'])).toBeNull();
    });

    it('stores a missing proposed value as JSON null instead of violating the NOT NULL column', async () => {
      const key = `null-${oid()}`;
      await metadata.synchronize(documentId, [mcInput(key, { proposedValue: undefined })]);
      expect((await find(key)).proposedValue).toBeNull();
      const [row] = await db.select({ t: sql<string>`jsonb_typeof(${schema.governanceMetadataCandidates.proposedValue})` }).from(schema.governanceMetadataCandidates).where(eq(schema.governanceMetadataCandidates.candidateKey, key));
      expect(row.t).toBe('null');
    });

    it('rejects a confidence outside [0, 1]', async () => {
      await expect(metadata.synchronize(documentId, [mcInput(`bad-${oid()}`, { confidence: 1.5 })])).rejects.toThrow();
    });
  });

  describe('extraction jobs', () => {
    const enqueue = (over: Record<string, unknown> = {}) => jobs.enqueue({
      programId, documentId, connectorId, requestedByUserId: userId, jobType: 'technical_metadata', inputHash: `h-${oid()}`, engineVersion: 'e1', ...over,
    } as never);

    it('is idempotent per identity, including when enqueued concurrently', async () => {
      const inputHash = `same-${oid()}`;
      const results = await Promise.all(Array.from({ length: 6 }, () => enqueue({ inputHash })));
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      expect(results[0]).toMatchObject({ status: 'pending', attempts: 0, jobType: 'technical_metadata' });

      const other = await enqueue({ inputHash: `different-${oid()}` });
      expect(other.id).not.toBe(results[0].id);
    });

    it('claims the oldest runnable job first and hands each job to exactly one of several concurrent workers', async () => {
      await db.delete(schema.governanceKnowledgeExtractionJobs).where(eq(schema.governanceKnowledgeExtractionJobs.jobType, 'metadata_enrichment'));
      const created = [];
      for (let i = 0; i < 3; i++) {
        created.push(await enqueue({ jobType: 'metadata_enrichment', inputHash: `claim-${i}-${oid()}` }));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const first = await jobs.claimNext(['metadata_enrichment']);
      expect(first?.id).toBe(created[0].id);
      expect(first).toMatchObject({ status: 'running', attempts: 1 });
      expect(first?.leaseToken).toBeTruthy();

      const rest = await Promise.all(Array.from({ length: 5 }, () => jobs.claimNext(['metadata_enrichment'])));
      const claimedIds = rest.filter(Boolean).map((r) => r!.id);
      expect(claimedIds.sort()).toEqual([created[1].id, created[2].id].sort());
      expect(rest.filter((r) => r === null)).toHaveLength(3);
      expect(await jobs.claimNext([])).toBeNull();
    });

    it('re-claims a running job whose lease expired, and fails one that used up its attempts', async () => {
      await db.delete(schema.governanceKnowledgeExtractionJobs).where(eq(schema.governanceKnowledgeExtractionJobs.jobType, 'metadata_enrichment'));
      const retry = await enqueue({ jobType: 'metadata_enrichment' });
      const exhausted = await enqueue({ jobType: 'metadata_enrichment' });
      const t = schema.governanceKnowledgeExtractionJobs;
      await db.update(t).set({ status: 'running', attempts: 1, leaseExpiresAt: past(), leaseToken: 'stale' }).where(eq(t.id, retry.id));
      await db.update(t).set({ status: 'running', attempts: 5, leaseExpiresAt: past(), leaseToken: 'stale' }).where(eq(t.id, exhausted.id));

      const claimed = await jobs.claimNext(['metadata_enrichment']);
      expect(claimed).toMatchObject({ id: retry.id, attempts: 2, status: 'running' });
      expect(claimed?.leaseToken).not.toBe('stale');
      expect(await jobs.claimNext(['metadata_enrichment'])).toBeNull();
      const failed = await db.select().from(t).where(eq(t.id, exhausted.id));
      expect(failed[0]).toMatchObject({ status: 'failed', leaseToken: null });
      expect(failed[0].error).toContain('exhausted its retry limit');
    });

    it('only retries a failed job once its back-off has passed', async () => {
      await db.delete(schema.governanceKnowledgeExtractionJobs).where(eq(schema.governanceKnowledgeExtractionJobs.jobType, 'metadata_enrichment'));
      const job = await enqueue({ jobType: 'metadata_enrichment' });
      const claimed = (await jobs.claimNext(['metadata_enrichment']))!;
      const failed = await jobs.markFailed(claimed.id, claimed.leaseToken!, 'boom', 1);
      expect(failed).toMatchObject({ status: 'failed', error: 'boom' });
      expect(failed!.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(50_000);
      expect(await jobs.claimNext(['metadata_enrichment'])).toBeNull();

      await db.update(schema.governanceKnowledgeExtractionJobs).set({ nextAttemptAt: past() }).where(eq(schema.governanceKnowledgeExtractionJobs.id, job.id));
      expect((await jobs.claimNext(['metadata_enrichment']))?.id).toBe(job.id);
    });

    it('records attempts, requires the lease token to finish and caps the back-off at 15 minutes', async () => {
      const job = await enqueue({ jobType: 'temporal_extraction' });
      const running = await jobs.markRunning(job.id);
      expect(running).toMatchObject({ status: 'running', attempts: 1 });
      expect(await jobs.markRunning(job.id)).toBeNull();

      expect(await jobs.heartbeat(job.id, 'wrong')).toBe(false);
      expect(await jobs.heartbeat(job.id, running!.leaseToken!)).toBe(true);
      expect(await jobs.markCompleted(job.id, 'wrong')).toBeNull();
      const done = await jobs.markCompleted(job.id, running!.leaseToken!);
      expect(done).toMatchObject({ status: 'completed' });
      expect(done?.completedAt).toBeInstanceOf(Date);
      expect(done).not.toHaveProperty('leaseToken');

      const capped = await enqueue({ jobType: 'temporal_extraction' });
      const claim = (await jobs.markRunning(capped.id))!;
      const failed = await jobs.markFailed(capped.id, claim.leaseToken!, 'x'.repeat(5000), 20);
      expect(failed?.error).toHaveLength(2000);
      const delay = failed!.nextAttemptAt!.getTime() - Date.now();
      expect(delay).toBeGreaterThan(14 * 60_000);
      expect(delay).toBeLessThanOrEqual(15 * 60_000);
    });

    it('strips U+0000 from a failure message', async () => {
      const job = await enqueue({ jobType: 'temporal_extraction' });
      const claim = (await jobs.markRunning(job.id))!;
      expect((await jobs.markFailed(job.id, claim.leaseToken!, 'bad\u0000text'))?.error).toBe('badtext');
    });

    it('resets the latest failed job of a document for a connector under the current principal', async () => {
      const older = await enqueue({ jobType: 'technical_metadata', inputHash: `old-${oid()}` });
      await new Promise((resolve) => setTimeout(resolve, 15));
      const newer = await enqueue({ jobType: 'technical_metadata', inputHash: `new-${oid()}` });
      for (const job of [older, newer]) {
        const claim = (await jobs.markRunning(job.id))!;
        await jobs.markFailed(job.id, claim.leaseToken!, 'boom');
      }

      const reset = await jobs.retryLatestFailedForDocument(documentId, connectorId, otherUserId);
      expect(reset).toMatchObject({ id: newer.id, status: 'pending', attempts: 0, requestedByUserId: otherUserId });
      for (const key of ['error', 'startedAt', 'completedAt', 'leaseExpiresAt', 'leaseToken', 'nextAttemptAt']) expect(reset).not.toHaveProperty(key);
      expect((await jobs.latestForDocument(documentId))?.id).toBe(newer.id);
      expect(await jobs.retryLatestFailedForDocument(documentId, oid(), userId)).toBeNull();
    });
  });

  describe('temporal candidate records', () => {
    const cand = (id: string) => ({
      candidate: { candidateId: id, kind: 'expiry' } as never,
      validation: { valid: true } as never,
      evidence: [{ text: 'ev' }] as never,
    });
    const upsert = async (job: string, ids: string[], inputHash = 'ih') => temporal.upsertMany({
      programId, documentId, jobId: job, inputHash, engineVersion: 'e1', candidates: ids.map(cand),
    });

    it('inserts new candidates once and leaves decided ones alone', async () => {
      const job = await jobs.enqueue({ programId, documentId, connectorId, requestedByUserId: userId, jobType: 'temporal_extraction', inputHash: `t-${oid()}`, engineVersion: 'e1' });
      const c1 = `c1-${oid()}`;
      await upsert(job.id, [c1, c1]);
      await upsert(job.id, [c1]);
      const rows = (await temporal.list(documentId)).filter((r) => r.candidateId === c1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ decisionStatus: 'pending', jobId: job.id, evidence: [{ text: 'ev' }] });
      expect(await temporal.list('nope')).toEqual([]);
    });

    it('leases a record for a decision, and only the holder of the token can finish or release it', async () => {
      const job = await jobs.enqueue({ programId, documentId, connectorId, requestedByUserId: userId, jobType: 'temporal_extraction', inputHash: `t-${oid()}`, engineVersion: 'e1' });
      const cid = `c2-${oid()}`;
      await upsert(job.id, [cid]);
      const record = (await temporal.list(documentId)).find((r) => r.candidateId === cid)!;

      const begun = await temporal.beginDecision(documentId, record.id);
      expect(begun).toMatchObject({ decisionStatus: 'processing' });
      expect(await temporal.beginDecision(documentId, record.id)).toBeNull();
      expect(await temporal.ownsDecision(record.id, begun!.decisionToken!)).toBe(true);
      expect(await temporal.ownsDecision(record.id, 'wrong')).toBe(false);
      expect(await temporal.markDecision(record.id, 'wrong', userId, 'confirmed')).toBeNull();

      await temporal.releaseDecision(record.id, begun!.decisionToken!);
      const again = await temporal.beginDecision(documentId, record.id);
      const decided = await temporal.markDecision(record.id, again!.decisionToken!, userId, 'corrected', 'fixed', { candidateId: cid, kind: 'renewal' } as never);
      expect(decided).toMatchObject({ decisionStatus: 'corrected', decidedBy: userId, decisionComment: 'fixed', correctedCandidate: { kind: 'renewal' } });
      expect(decided).not.toHaveProperty('decisionToken');
      expect(await temporal.beginDecision(documentId, record.id)).toBeNull();
    });

    it('lets a decision lease that expired be taken over', async () => {
      const job = await jobs.enqueue({ programId, documentId, connectorId, requestedByUserId: userId, jobType: 'temporal_extraction', inputHash: `t-${oid()}`, engineVersion: 'e1' });
      const cid = `c3-${oid()}`;
      await upsert(job.id, [cid]);
      const record = (await temporal.list(documentId)).find((r) => r.candidateId === cid)!;
      await temporal.beginDecision(documentId, record.id);
      await db.update(schema.governanceTemporalCandidateRecords)
        .set({ decisionLeaseExpiresAt: past() })
        .where(eq(schema.governanceTemporalCandidateRecords.id, record.id));

      expect((await temporal.beginDecision(documentId, record.id))?.decisionStatus).toBe('processing');
    });
  });

  describe('foreign keys', () => {
    it('removes a document’s knowledge rows when the document is deleted', async () => {
      const doc = oid();
      await db.insert(schema.workspaceDocuments).values({ id: doc, originalName: 'gone.pdf', mimeType: 'application/pdf', size: 1, workspaceId, createdBy: userId });
      await alerts.synchronize(doc, [alertInput(`fk-${oid()}`, { documentId: doc })], new Date());
      await jobs.enqueue({ programId, documentId: doc, connectorId, requestedByUserId: userId, jobType: 'technical_metadata', inputHash: `fk-${oid()}`, engineVersion: 'e1' });
      expect((await alerts.list(programId, { scopeIds: ['*'] })).some((a) => a.documentId === doc)).toBe(true);

      await db.delete(schema.workspaceDocuments).where(eq(schema.workspaceDocuments.id, doc));

      expect((await alerts.list(programId, { scopeIds: ['*'] })).some((a) => a.documentId === doc)).toBe(false);
      expect(await jobs.latestForDocument(doc)).toBeNull();
    });

    it('nulls a user reference when the user is deleted and rejects a job for a missing document', async () => {
      const ghost = oid();
      await db.insert(schema.identityUsers).values({ id: ghost, email: `ki-ghost-${ghost.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
      const job = await jobs.enqueue({ programId, documentId, connectorId, requestedByUserId: ghost, jobType: 'technical_metadata', inputHash: `ghost-${oid()}`, engineVersion: 'e1' });
      await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, ghost));
      const row = await db.select().from(schema.governanceKnowledgeExtractionJobs).where(eq(schema.governanceKnowledgeExtractionJobs.id, job.id));
      expect(row[0].requestedByUserId).toBeNull();

      await expect(jobs.enqueue({ programId, documentId: oid(), connectorId, requestedByUserId: userId, jobType: 'technical_metadata', inputHash: `x-${oid()}`, engineVersion: 'e1' })).rejects.toThrow();
    });
  });
});
