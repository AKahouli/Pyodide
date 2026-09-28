import { and, eq, inArray } from 'drizzle-orm';
import { isUniqueViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import {
  DynamicReasoningAttemptRepository,
  toDynamicReasoningAttemptJson,
  type DynamicReasoningAttemptIdentity,
} from './dynamic-reasoning-attempt.repository';

describeIntegration('dynamic reasoning attempt repository (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const attempts = new DynamicReasoningAttemptRepository(db as never);

  const ownerId = oid();
  let flowId: string;

  const newExecution = async (): Promise<string> => {
    const id = oid();
    await db.insert(schema.playbookExecutions).values({ id, flowId, ownerId });
    return id;
  };
  const identity = (executionId: string, over: Partial<DynamicReasoningAttemptIdentity> = {}): DynamicReasoningAttemptIdentity => ({
    executionId, parentTaskId: 'parent-1', parentIteration: 0, attempt: 0, ...over,
  });
  const rowsOf = (executionId: string) =>
    db.select().from(schema.playbookDynamicReasoningAttempts).where(eq(schema.playbookDynamicReasoningAttempts.executionId, executionId));

  beforeAll(async () => {
    await db.insert(schema.identityUsers).values({ id: ownerId, email: `pbdra-${ownerId.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    flowId = oid();
    await db.insert(schema.playbookFlows).values({ id: flowId, ownerId, name: `flow ${flowId}` });
  });

  afterAll(async () => {
    // The flow cascades to its executions and their attempts.
    await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.ownerId, ownerId));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId]));
    await close();
  });

  it('creates the attempt with its insert-only fields, then updates only what `set` carries', async () => {
    const executionId = await newExecution();
    const startedAt = new Date('2026-03-01T10:00:00Z');
    expect(await attempts.upsert(identity(executionId.toUpperCase()), {
      status: 'planning',
      planningStartedAt: startedAt,
      inputContextSummary: { contextFingerprint: 'fp\u0000-1', size: 3 },
      contextFingerprint: 'fp-1',
      decision: undefined,
    }, { flowId })).toBe(true);

    const created = await attempts.find(identity(executionId));
    expect(created).toMatchObject({
      executionId, flowId, parentTaskId: 'parent-1', parentIteration: 0, attempt: 0, status: 'planning',
      planningStartedAt: startedAt, inputContextSummary: { contextFingerprint: 'fp-1', size: 3 }, contextFingerprint: 'fp-1',
      decision: null, subgraphId: null, revisions: [], acceptedRevision: null,
    });

    const otherFlowId = oid();
    expect(await attempts.upsert(identity(executionId), {
      status: 'running', subgraphId: `sg-${executionId}`, acceptedRevision: '2', acceptedPlan: { nodes: [] }, acceptedAt: new Date(),
    }, { flowId: otherFlowId })).toBe(true);
    const updated = await attempts.find(identity(executionId));
    expect(updated).toMatchObject({
      flowId, status: 'running', subgraphId: `sg-${executionId}`, acceptedRevision: 2, acceptedPlan: { nodes: [] },
      planningStartedAt: startedAt, contextFingerprint: 'fp-1',
    });
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created!.updatedAt.getTime());
    expect(await rowsOf(executionId)).toHaveLength(1);
  });

  it('casts values like the Mongoose schema did: numbers to text, non-numeric revisions to null', async () => {
    const executionId = await newExecution();
    await attempts.upsert(identity(executionId), { contextFingerprint: 42, acceptedRevision: 'n/a', error: { message: 'x' } }, { flowId });
    expect(await attempts.find(identity(executionId))).toMatchObject({ contextFingerprint: '42', acceptedRevision: null, error: { message: 'x' }, status: 'planning' });
  });

  it('keeps one row per identity under concurrent events, one per parent iteration', async () => {
    const executionId = await newExecution();
    const results = await Promise.all([
      attempts.upsert(identity(executionId), { status: 'planning' }, { flowId }),
      attempts.upsert(identity(executionId), { decision: { mode: 'plan' } }, { flowId }),
      attempts.upsert(identity(executionId), {}, { flowId }),
      attempts.upsert(identity(executionId), { status: 'running' }, { flowId }),
      attempts.upsert(identity(executionId, { parentIteration: 1 }), {}, { flowId }),
    ]);
    expect(results).toEqual([true, true, true, true, true]);
    const rows = await rowsOf(executionId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.parentIteration === 0)?.decision).toEqual({ mode: 'plan' });
  });

  it('appends a revision once per (revision, kind), even when the event is replayed concurrently', async () => {
    const executionId = await newExecution();
    await attempts.upsert(identity(executionId), {}, { flowId });
    const proposal = { revision: 0, kind: 'proposal', plan: { steps: ['a\u0000'] }, validationIssues: [] };
    const pushes = await Promise.all([1, 2, 3, 4].map(() => attempts.pushRevision(identity(executionId), { ...proposal })));
    expect(pushes.filter(Boolean)).toHaveLength(1);
    expect(await attempts.pushRevision(identity(executionId), { ...proposal, kind: 'repair' })).toBe(true);
    expect(await attempts.pushRevision(identity(executionId), { ...proposal, revision: 1 })).toBe(true);
    expect(await attempts.pushRevision(identity(executionId), { ...proposal, revision: 1 })).toBe(false);

    const { revisions } = (await attempts.find(identity(executionId)))!;
    expect(revisions.map((entry) => [entry.revision, entry.kind])).toEqual([[0, 'proposal'], [0, 'repair'], [1, 'proposal']]);
    expect(revisions[0]).toMatchObject({ plan: { steps: ['a'] }, validationIssues: [] });
    expect(revisions[0].createdAt).toBeInstanceOf(Date);

    // No attempt row: nothing to append to (the Mongo update had no upsert either).
    expect(await attempts.pushRevision(identity(executionId, { parentTaskId: 'other' }), proposal)).toBe(false);
  });

  it('refuses an attempt of a run that is gone, and a malformed id, without throwing', async () => {
    const goneId = oid();
    expect(await attempts.upsert(identity(goneId), { status: 'planning' }, { flowId })).toBe(false);
    expect(await rowsOf(goneId)).toHaveLength(0);
    expect(await attempts.upsert(identity('not-an-id'), {}, { flowId })).toBe(false);
    expect(await attempts.pushRevision(identity('not-an-id'), { revision: 0, kind: 'proposal' })).toBe(false);
    expect(await attempts.find(identity('not-an-id'))).toBeNull();
    expect(await attempts.listForExecution('not-an-id')).toEqual([]);
  });

  it('holds a subgraph id on one attempt only', async () => {
    const executionId = await newExecution();
    const subgraphId = `sg-unique-${executionId}`;
    await attempts.upsert(identity(executionId), { subgraphId }, { flowId });
    const clash = await attempts.upsert(identity(executionId, { parentTaskId: 'parent-2' }), { subgraphId }, { flowId }).catch((err: unknown) => err);
    expect(isUniqueViolation(clash, 'uq_playbook_dynamic_reasoning_attempts_subgraph')).toBe(true);
  });

  it('lists the attempts of one or several runs oldest first, and loses them with the run', async () => {
    const first = await newExecution();
    const second = await newExecution();
    await attempts.upsert(identity(first, { parentTaskId: 'b' }), {}, { flowId });
    await attempts.upsert(identity(first, { parentTaskId: 'a' }), {}, { flowId });
    await attempts.upsert(identity(second), {}, { flowId });
    await db.update(schema.playbookDynamicReasoningAttempts)
      .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
      .where(and(eq(schema.playbookDynamicReasoningAttempts.executionId, first), eq(schema.playbookDynamicReasoningAttempts.parentTaskId, 'a')));

    expect((await attempts.listForExecution(first)).map((row) => row.parentTaskId)).toEqual(['a', 'b']);
    const both = await attempts.listForExecutions([first, second.toUpperCase(), 'bad']);
    expect(both.map((row) => row.executionId).sort()).toEqual([first, first, second].sort());
    expect(await attempts.listForExecutions([])).toEqual([]);

    const json = toDynamicReasoningAttemptJson((await attempts.find(identity(second)))!);
    expect(json).toMatchObject({ executionId: second, flowId, status: 'planning', revisions: [] });
    expect(json).not.toHaveProperty('subgraphId');
    expect(json).not.toHaveProperty('decision');

    await db.delete(schema.playbookExecutions).where(eq(schema.playbookExecutions.id, first));
    expect(await attempts.listForExecution(first)).toEqual([]);
  });
});
