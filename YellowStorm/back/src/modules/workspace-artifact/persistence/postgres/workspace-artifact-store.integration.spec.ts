import { eq, inArray } from 'drizzle-orm';
import { newObjectId } from '@common/postgres/object-id';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import * as schema from '@modules/postgres/schema';
import { PostgresWorkspaceArtifactStore } from './postgres-workspace-artifact-store';

/**
 * claim()/failExhaustedLeases() act on the oldest claimable row across ALL
 * workspaces, so on a shared test DB they could hijack real queued jobs (and
 * other rows could win the claim). Only run them against a dedicated scratch
 * DB, signalled by PG_INTEGRATION_EXCLUSIVE=true.
 */
const exclusive = process.env.PG_INTEGRATION_EXCLUSIVE === 'true';
const itExclusive: jest.It = exclusive ? it : it.skip;
if (!exclusive) {
  // eslint-disable-next-line no-console
  console.info(
    '[workspace-artifact-store.integration] claim/lease tests skipped: they touch rows across all workspaces. ' +
      'Set PG_INTEGRATION_EXCLUSIVE=true on a dedicated scratch DB to run them.',
  );
}

describeIntegration('workspace_artifacts PG store', () => {
  const { db, close } = makeTestDb();
  const store = new PostgresWorkspaceArtifactStore(db as never);

  // Fresh ids per run: artifacts need a real parent (fk_artifacts_workspace).
  const WORKSPACE = newObjectId();
  const USER = newObjectId();
  const AGENT = newObjectId();
  const SOURCE_DOC = newObjectId();
  const createdIds: string[] = [];

  beforeAll(async () => {
    const suffix = WORKSPACE.slice(-12);
    await db.insert(schema.workspaces).values({
      id: WORKSPACE,
      name: `artifact-it-${suffix}`,
      alias: `artifact-it-${suffix}`,
      storagePrefix: `artifact-it-${suffix}`,
      createdBy: USER,
      allocatedStorage: 0,
    });
  });

  const createQueued = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const record = await store.create({
      workspaceId: WORKSPACE,
      type: 'decision_flow',
      name: `Flow ${Math.random().toString(36).slice(2)}`,
      status: 'queued',
      schemaVersion: 1,
      primarySource: { documentId: SOURCE_DOC, documentName: 'source.pdf', selection: { mode: 'all' } },
      generationOptions: {
        flowType: 'eligibility',
        targetAudiences: ['infer_from_document'],
        detailLevel: 'standard',
        ambiguityPolicy: { doNotInvent: true, createToConfirmNodes: true, citeSourcePassages: true, identifyContradictions: true },
      },
      // Not due for an hour: a worker sharing this DB must not claim fixtures.
      generation: { agentId: AGENT, requestedBy: USER, attempts: 0, nextAttemptAt: new Date(Date.now() + 3_600_000) },
      createdBy: USER,
      updatedBy: USER,
      ...overrides,
    });
    createdIds.push(record.id);
    return record.id;
  };

  const claimable = (): Record<string, unknown> => ({
    generation: { agentId: AGENT, requestedBy: USER, attempts: 0, nextAttemptAt: new Date(Date.now() - 60_000) },
  });

  afterEach(async () => {
    if (createdIds.length) {
      await db.delete(schema.workspaceArtifacts).where(inArray(schema.workspaceArtifacts.id, [...createdIds]));
      createdIds.length = 0;
    }
  });

  afterAll(async () => {
    try {
      await db.delete(schema.workspaceArtifacts).where(eq(schema.workspaceArtifacts.workspaceId, WORKSPACE));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WORKSPACE));
    } finally {
      await close();
    }
  });

  it('lists artifacts with filters, newest first, honouring limit', async () => {
    const a = await createQueued({ name: 'Alpha list' });
    await createQueued({ name: 'Alpha other', status: 'failed' });
    const all = await store.list(WORKSPACE, {});
    expect(all).toHaveLength(2);
    expect(await store.list(WORKSPACE, { limit: 1 })).toHaveLength(1);
    const byStatus = await store.list(WORKSPACE, { status: 'failed' });
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0].status).toBe('failed');
    const bySearch = await store.list(WORKSPACE, { search: 'alpha LIST' });
    expect(bySearch.map((r) => r.id)).toEqual([a]);
    const bySource = await store.list(WORKSPACE, { sourceDocumentId: SOURCE_DOC });
    expect(bySource).toHaveLength(2);
  });

  it('counts by source, batched and single', async () => {
    await createQueued();
    await createQueued();
    expect(await store.countBySource(WORKSPACE, SOURCE_DOC)).toBe(2);
    expect(await store.countBySourceDocumentIds([SOURCE_DOC, newObjectId()])).toBe(2);
    expect(await store.countBySourceDocumentIds([])).toBe(0);
  });

  it('resetForGeneration records updatedBy', async () => {
    const id = await createQueued({ status: 'failed' });
    const other = newObjectId();
    const reset = await store.resetForGeneration(id, { agentId: AGENT, requestedBy: other }, other);
    expect(reset?.status).toBe('queued');
    expect(reset?.updatedBy).toBe(other);
    // reset sets nextAttemptAt=now: park it immediately so a worker on this DB cannot claim it.
    await db
      .update(schema.workspaceArtifacts)
      .set({ status: 'failed' })
      .where(eq(schema.workspaceArtifacts.id, id));
  });

  itExclusive('claims exactly once under parallel workers and bumps attempts per claim', async () => {
    const id = await createQueued(claimable());
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

  itExclusive('reclaims an expired lease and fails exhausted leases', async () => {
    const id = await createQueued(claimable());
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
    const before = new Date(Date.now() - 1000);
    await store.failExhaustedLeases(2);
    const rows = await db.select().from(schema.workspaceArtifacts).where(inArray(schema.workspaceArtifacts.id, [id]));
    expect(rows[0].status).toBe('failed');
    expect(rows[0].leaseToken).toBeNull();
    expect(rows[0].updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  itExclusive('completes only under the winning lease and requeues on transient failure', async () => {
    const id = await createQueued(claimable());
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
    // Created as failed: a queued row would be claimable by any worker on this DB.
    const id = await createQueued({ name: 'Dup', status: 'failed' });
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

    expect(await store.countBySource(WORKSPACE, SOURCE_DOC)).toBe(1);
    await store.deleteBySource(WORKSPACE, SOURCE_DOC);
    expect(await store.countBySource(WORKSPACE, SOURCE_DOC)).toBe(0);
    createdIds.length = 0; // already deleted via deleteBySource
  });
});
