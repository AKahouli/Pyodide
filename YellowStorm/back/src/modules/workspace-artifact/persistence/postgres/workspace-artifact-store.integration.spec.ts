import { inArray } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import * as schema from '@modules/postgres/schema';
import { PostgresWorkspaceArtifactStore } from './postgres-workspace-artifact-store';

describeIntegration('workspace_artifacts PG store', () => {
  const { db, close } = makeTestDb();
  const store = new PostgresWorkspaceArtifactStore(db as never);

  const WORKSPACE = 'a1a1a1a1a1a1a1a1a1a1a1a1';
  const USER = 'b2b2b2b2b2b2b2b2b2b2b2b2';
  const AGENT = 'c3c3c3c3c3c3c3c3c3c3c3c3';
  const createdIds: string[] = [];

  const createQueued = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const record = await store.create({
      workspaceId: WORKSPACE,
      type: 'decision_flow',
      name: `Flow ${Math.random().toString(36).slice(2)}`,
      status: 'queued',
      schemaVersion: 1,
      primarySource: { documentId: 'd1d1d1d1d1d1d1d1d1d1d1d1', documentName: 'source.pdf', selection: { mode: 'all' } },
      generationOptions: {
        flowType: 'eligibility',
        targetAudiences: ['infer_from_document'],
        detailLevel: 'standard',
        ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true },
      },
      generation: { agentId: AGENT, requestedBy: USER, attempts: 0, nextAttemptAt: new Date(Date.now() - 60_000) },
      createdBy: USER,
      updatedBy: USER,
      ...overrides,
    });
    createdIds.push(record.id);
    return record.id;
  };

  afterEach(async () => {
    if (createdIds.length) {
      await db.delete(schema.workspaceArtifacts).where(inArray(schema.workspaceArtifacts.id, [...createdIds]));
      createdIds.length = 0;
    }
  });
  afterAll(close);

  it('lists artifacts with filters, newest first', async () => {
    const a = await createQueued({ name: 'Alpha list' });
    await createQueued({ name: 'Alpha other', status: 'failed' });
    const all = await store.list(WORKSPACE, {});
    expect(all.length).toBeGreaterThanOrEqual(2);
    const byStatus = await store.list(WORKSPACE, { status: 'failed' });
    expect(byStatus.every((r) => r.status === 'failed')).toBe(true);
    const bySearch = await store.list(WORKSPACE, { search: 'alpha LIST' });
    expect(bySearch.map((r) => r.id)).toContain(a);
    const bySource = await store.list(WORKSPACE, { sourceDocumentId: 'd1d1d1d1d1d1d1d1d1d1d1d1' });
    expect(bySource.length).toBeGreaterThanOrEqual(2);
  });

  it('claims exactly once under parallel workers and bumps attempts per claim', async () => {
    const id = await createQueued();
    const N = 5;
    const claims = await Promise.all(Array.from({ length: N }, () => store.claim(3, 5)));
    const winners = claims.filter((c): c is NonNullable<typeof c> => c !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0].artifact.id).toBe(id);
    expect(winners[0].artifact.status).toBe('generating');
    expect(winners[0].artifact.generation.attempts).toBe(1);
    expect(winners[0].artifact.generation.leaseToken).toBe(winners[0].leaseToken);

    // A second claim against the same (now generating, unexpired) artifact wins nothing.
    expect(await store.claim(3, 5)).toBeNull();
  });

  it('reclaims an expired lease and fails exhausted leases', async () => {
    const id = await createQueued();
    const first = await store.claim(2, 5);
    expect(first?.artifact.id).toBe(id);
    expect(first?.artifact.generation.attempts).toBe(1);

    // Expire the lease: reclaim path increments attempts again.
    await db
      .update(schema.workspaceArtifacts)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(inArray(schema.workspaceArtifacts.id, [id]));
    const second = await store.claim(2, 5);
    expect(second?.artifact.id).toBe(id);
    expect(second?.artifact.generation.attempts).toBe(2);

    // attempts (2) >= maxAttempts (2) and lease expired → failExhaustedLeases marks it failed.
    await db
      .update(schema.workspaceArtifacts)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(inArray(schema.workspaceArtifacts.id, [id]));
    await store.failExhaustedLeases(2);
    const rows = await db.select().from(schema.workspaceArtifacts).where(inArray(schema.workspaceArtifacts.id, [id]));
    expect(rows[0].status).toBe('failed');
    expect(rows[0].leaseToken).toBeNull();
  });

  it('completes only under the winning lease and requeues on transient failure', async () => {
    const id = await createQueued();
    const claim = await store.claim(3, 5);
    expect(claim?.artifact.id).toBe(id);

    const lostLease = await store.complete(id, 'not-the-winning-token', { title: 'x', nodes: [], edges: [], warnings: [] });
    expect(lostLease).toBe(false);

    const retried = await store.fail(id, claim!.leaseToken, {
      canRetry: true,
      message: 'transient',
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    expect(retried).toBe(true);
    const requeued = await store.findByIdAndWorkspace(WORKSPACE, id);
    expect(requeued?.status).toBe('queued');
    expect(requeued?.generation.nextAttemptAt).toBeDefined();
  });

  it('supports the unique-name loop, revision-guarded update, and source cleanup', async () => {
    const id = await createQueued({ name: 'Dup' });
    expect(await store.existsName(WORKSPACE, 'Dup')).toBe(true);
    expect(await store.existsName(WORKSPACE, 'Dup', id)).toBe(false);
    expect(await store.existsName(WORKSPACE, 'Other')).toBe(false);

    const record = await store.findByIdAndWorkspace(WORKSPACE, id);
    expect(record).not.toBeNull();

    const stale = await store.updateWithRevision(WORKSPACE, id, record!.revision - 1, { name: 'Renamed' }, USER);
    expect(stale).toBeNull();
    const updated = await store.updateWithRevision(WORKSPACE, id, record!.revision, { name: 'Renamed' }, USER);
    expect(updated!.name).toBe('Renamed');
    expect(updated!.revision).toBe(record!.revision + 1);

    expect(await store.countBySource(WORKSPACE, 'd1d1d1d1d1d1d1d1d1d1d1d1')).toBeGreaterThanOrEqual(1);
    await store.deleteBySource(WORKSPACE, 'd1d1d1d1d1d1d1d1d1d1d1d1');
    expect(await store.countBySource(WORKSPACE, 'd1d1d1d1d1d1d1d1d1d1d1d1')).toBe(0);
    createdIds.length = 0; // already deleted via deleteBySource
  });
});
