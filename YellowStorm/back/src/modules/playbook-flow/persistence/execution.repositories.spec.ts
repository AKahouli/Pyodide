import { eq, inArray } from 'drizzle-orm';
import { isForeignKeyViolation, newObjectId } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import { ExecutionRepository, toExecutionJson, type NewExecution } from './execution.repository';
import { TaskResultRepository } from './task-result.repository';
import { RouterDecisionRepository } from './router-decision.repository';

describeIntegration('playbook execution repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const executions = new ExecutionRepository(db as never);
  const taskResults = new TaskResultRepository(db as never);
  const routerDecisions = new RouterDecisionRepository(db as never);

  const ownerId = oid();
  const otherId = oid();
  let flowId: string;
  let otherFlowId: string;

  const newFlow = async (owner = ownerId): Promise<string> => {
    const id = oid();
    await db.insert(schema.playbookFlows).values({ id, ownerId: owner, name: `flow ${id}` });
    return id;
  };
  const newExecution = (over: Partial<NewExecution> = {}) =>
    executions.insert({ flowId, ownerId, recursionLimit: 25, maxParallelism: 5, ...over });
  const setCreatedAt = (id: string, iso: string) =>
    db.update(schema.playbookExecutions).set({ createdAt: new Date(iso) }).where(eq(schema.playbookExecutions.id, id));
  const setStatus = (id: string, status: string, extra: Partial<typeof schema.playbookExecutions.$inferInsert> = {}) =>
    db.update(schema.playbookExecutions).set({ status, ...extra }).where(eq(schema.playbookExecutions.id, id));

  beforeAll(async () => {
    for (const id of [ownerId, otherId]) {
      await db.insert(schema.identityUsers).values({ id, email: `pbx-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
    flowId = await newFlow();
    otherFlowId = await newFlow(otherId);
  });

  afterAll(async () => {
    // Flows cascade to their executions, and executions to their task results and router decisions.
    await db.delete(schema.playbookFlows).where(inArray(schema.playbookFlows.ownerId, [ownerId, otherId]));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId, otherId]));
    await close();
  });

  describe('executions', () => {
    it('creates a run with the column defaults, returns its snapshots and leaves them out of default reads', async () => {
      const created = await newExecution({ snapshot: { nodes: [{ id: 'a' }] }, plannerSnapshot: { model: 'm' }, executionMode: null, advisorScoringMode: null });
      expect(created).toMatchObject({
        flowId, ownerId, status: 'queued', schemaVersion: 1, queuePosition: 0, hitlEvents: [], seededTaskOutputs: [],
        executionMode: 'live', advisorScoringMode: 'llm', stepExecutionModes: {}, replayPlanningByTask: {}, pendingApproval: null,
        snapshot: { nodes: [{ id: 'a' }] }, plannerSnapshot: { model: 'm' }, startedAt: null,
      });

      const plain = await executions.findById(created.id);
      expect(plain?.id).toBe(created.id);
      expect(plain?.snapshot).toBeUndefined();
      expect(plain?.plannerSnapshot).toBeUndefined();
      const full = await executions.findById(created.id.toUpperCase(), { withSnapshot: true, withPlannerSnapshot: true });
      expect(full?.snapshot).toEqual({ nodes: [{ id: 'a' }] });
      expect(full?.plannerSnapshot).toEqual({ model: 'm' });

      expect(await executions.findById('not-an-id')).toBeNull();
      expect(await executions.findById(oid())).toBeNull();
      expect((await executions.findOwned(created.id, ownerId))?.id).toBe(created.id);
      expect(await executions.findOwned(created.id, otherId)).toBeNull();
    });

    it('builds the Mongo toJSON shape: id, no unset keys, the planner under its Mongo name', async () => {
      const created = await newExecution({ plannerSnapshot: { model: 'm' }, snapshot: { nodes: [] } });
      const json = toExecutionJson(created);
      expect(json).toMatchObject({ id: created.id, status: 'queued', pendingApproval: null, playbookPlannerSnapshot: { model: 'm' }, snapshot: { nodes: [] } });
      expect(json).not.toHaveProperty('startedAt');
      expect(json).not.toHaveProperty('error');
      expect(json).not.toHaveProperty('plannerSnapshot');
      expect(toExecutionJson((await executions.findById(created.id))!)).not.toHaveProperty('snapshot');
    });

    it('strips NUL from text and documents and truncates integer settings', async () => {
      const created = await newExecution({ inputContext: { note: 'a\u0000b' }, recursionLimit: 12.7 });
      expect(created.inputContext).toEqual({ note: 'ab' });
      expect(created.recursionLimit).toBe(12);
      await executions.markFailed(created.id, 'bad\u0000output');
      expect((await executions.findById(created.id))?.error).toBe('badoutput');
    });

    it('refuses a run of a flow that does not exist', async () => {
      const err = await newExecution({ flowId: oid() }).catch((e: unknown) => e);
      expect(isForeignKeyViolation(err)).toBe(true);
    });

    it('lists and counts a flow\'s runs newest first, with status filter and paging', async () => {
      const flow = await newFlow();
      const a = await newExecution({ flowId: flow });
      const b = await newExecution({ flowId: flow });
      const c = await newExecution({ flowId: flow });
      await setCreatedAt(a.id, '2026-01-01T00:00:00Z');
      await setCreatedAt(b.id, '2026-01-02T00:00:00Z');
      await setCreatedAt(c.id, '2026-01-03T00:00:00Z');
      await setStatus(b.id, 'completed');

      expect((await executions.listByFlow(flow)).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
      expect((await executions.listByFlow(flow, { limit: 1, offset: 1 })).map((x) => x.id)).toEqual([b.id]);
      expect((await executions.listByFlow(flow, { statuses: ['completed'] })).map((x) => x.id)).toEqual([b.id]);
      expect(await executions.countByFlow(flow)).toBe(3);
      expect(await executions.countByFlow(flow, ['completed'])).toBe(1);
      expect(await executions.listByFlow('bad')).toEqual([]);
    });

    it('lists the recently touched runs of several flows', async () => {
      const f1 = await newFlow();
      const f2 = await newFlow();
      const a = await newExecution({ flowId: f1 });
      const b = await newExecution({ flowId: f2 });
      await setStatus(a.id, 'failed');
      await executions.update(b.id, { threadId: 't' });
      await db.update(schema.playbookExecutions).set({ updatedAt: new Date('2026-02-01T00:00:00Z') }).where(eq(schema.playbookExecutions.id, a.id));
      expect((await executions.listRecentByFlows([f1, f2, 'bad'], { limit: 10 })).map((x) => x.id)).toEqual([b.id, a.id]);
      expect((await executions.listRecentByFlows([f1, f2], { statuses: ['failed'], limit: 10 })).map((x) => x.id)).toEqual([a.id]);
      expect(await executions.listRecentByFlows([], { limit: 10 })).toEqual([]);
    });

    it('lists the active runs of the owner and of the flows shared with them', async () => {
      const mine = await newExecution();
      const done = await newExecution();
      await setStatus(done.id, 'completed');
      const sharedRun = await executions.insert({ flowId: otherFlowId, ownerId: otherId, recursionLimit: 25, maxParallelism: 5 });
      await setStatus(sharedRun.id, 'pending_approval');

      const ownOnly = (await executions.listActive(ownerId)).map((x) => x.id);
      expect(ownOnly).toContain(mine.id);
      expect(ownOnly).not.toContain(done.id);
      expect(ownOnly).not.toContain(sharedRun.id);
      expect((await executions.listActive(ownerId, [otherFlowId])).map((x) => x.id)).toContain(sharedRun.id);

      expect(await executions.hasActiveForFlow(otherFlowId)).toBe(true);
      const quiet = await newFlow();
      await newExecution({ flowId: quiet });
      expect(await executions.hasActiveForFlow(quiet)).toBe(false);
    });

    it('lists the owner\'s latest finished runs with their snapshots', async () => {
      const flow = await newFlow();
      const completed = await newExecution({ flowId: flow, snapshot: { nodes: [{ id: 'x' }] } });
      const failed = await newExecution({ flowId: flow, snapshot: { nodes: [] } });
      const running = await newExecution({ flowId: flow });
      await setStatus(completed.id, 'completed');
      await setStatus(failed.id, 'failed');
      await setStatus(running.id, 'running');
      await setCreatedAt(completed.id, '2026-01-01T00:00:00Z');
      await setCreatedAt(failed.id, '2026-01-02T00:00:00Z');

      const rows = await executions.listRecentCompletedWithSnapshot(flow, ownerId, 20);
      expect(rows.map((x) => x.id)).toEqual([failed.id, completed.id]);
      expect(rows[1].snapshot).toEqual({ nodes: [{ id: 'x' }] });
      expect(await executions.listRecentCompletedWithSnapshot(flow, ownerId, 1)).toHaveLength(1);
      expect(await executions.listRecentCompletedWithSnapshot(flow, otherId, 20)).toEqual([]);
    });

    it('finds the owners with queued runs and the stale running runs, and requeues them', async () => {
      const owner = oid();
      await db.insert(schema.identityUsers).values({ id: owner, email: `pbx-${owner.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
      try {
        const flow = await newFlow(owner);
        const queued = await executions.insert({ flowId: flow, ownerId: owner, recursionLimit: 25, maxParallelism: 5 });
        expect(await executions.distinctOwnersWithQueued()).toContain(owner);

        const stale = await executions.insert({ flowId: flow, ownerId: owner, recursionLimit: 25, maxParallelism: 5 });
        await setStatus(stale.id, 'running', { startedAt: new Date('2020-01-01T00:00:00Z'), error: 'x', queuePosition: 4 });
        await setStatus(queued.id, 'running', { startedAt: new Date() });
        const found = (await executions.findStaleRunning(new Date('2021-01-01T00:00:00Z'))).map((x) => x.id);
        expect(found).toContain(stale.id);
        expect(found).not.toContain(queued.id);

        expect(await executions.requeueRunning(stale.id, { clearError: true })).toBe(true);
        expect(await executions.findById(stale.id)).toMatchObject({ status: 'queued', startedAt: null, error: null, queuePosition: 0 });
        expect(await executions.requeueRunning(stale.id)).toBe(false);
      } finally {
        await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.ownerId, owner));
        await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, owner));
      }
    });
  });

  describe('queue', () => {
    let owner: string;
    let flow: string;
    const queue = async (count: number, day = 1): Promise<string[]> => {
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        const run = await executions.insert({ flowId: flow, ownerId: owner, recursionLimit: 25, maxParallelism: 5 });
        await setCreatedAt(run.id, `2026-01-${String(day).padStart(2, '0')}T00:00:0${i}Z`);
        out.push(run.id);
      }
      return out;
    };

    beforeEach(async () => {
      owner = oid();
      await db.insert(schema.identityUsers).values({ id: owner, email: `pbq-${owner.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
      flow = await newFlow(owner);
    });

    afterEach(async () => {
      await db.delete(schema.playbookFlows).where(eq(schema.playbookFlows.ownerId, owner));
      await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, owner));
    });

    it('counts queued and active runs', async () => {
      const [a, b] = await queue(2);
      expect(await executions.countQueued(owner)).toBe(2);
      expect(await executions.countQueued(owner, a)).toBe(1);
      await setStatus(b, 'pending_approval');
      expect(await executions.countActive(owner)).toBe(1);
      expect(await executions.countQueued('bad')).toBe(0);
    });

    it('claims the oldest queued run with its snapshot, up to the slot limit', async () => {
      const [first, second] = await queue(2);
      await db.update(schema.playbookExecutions).set({ snapshot: { nodes: ['s'] } }).where(eq(schema.playbookExecutions.id, first));
      const claimed = await executions.claimNextQueued(owner, 1);
      expect(claimed).toMatchObject({ id: first, status: 'running', queuePosition: 0, snapshot: { nodes: ['s'] } });
      expect(claimed?.startedAt).toBeInstanceOf(Date);
      expect(await executions.claimNextQueued(owner, 1)).toBeNull();
      expect((await executions.claimNextQueued(owner, 2))?.id).toBe(second);
      expect(await executions.claimNextQueued(owner, 5)).toBeNull();
    });

    it('never over-claims under concurrent claimers', async () => {
      await queue(6);
      const outcomes = await Promise.all(Array.from({ length: 8 }, () => executions.claimNextQueued(owner, 3)));
      const claimed = outcomes.filter((x) => x !== null).map((x) => x!.id);
      expect(claimed).toHaveLength(3);
      expect(new Set(claimed).size).toBe(3);
      expect(await executions.countActive(owner)).toBe(3);
      expect(await executions.countQueued(owner)).toBe(3);
    });

    it('renumbers the queue by age and reports only the changed positions', async () => {
      const [a, b, c] = await queue(3);
      await executions.update(b, { queuePosition: 2 });
      expect(await executions.renumberQueue(owner)).toEqual([
        { executionId: a, queuePosition: 1 },
        { executionId: c, queuePosition: 3 },
      ]);
      expect(await executions.renumberQueue(owner)).toEqual([]);
      await setStatus(a, 'running');
      expect(await executions.renumberQueue(owner)).toEqual([
        { executionId: b, queuePosition: 1 },
        { executionId: c, queuePosition: 2 },
      ]);
    });
  });

  describe('transitions and HITL', () => {
    const pause = { nodeId: 'review', iteration: 0, prompt: 'Approve?', requestedAt: new Date('2026-03-01T10:00:00Z'), interruptType: 'approval_request', interruptId: 'i-1', resumableActions: ['approve'], interruptPayload: { raw: 'x\u0000' } };
    const hitlEvent = { nodeId: 'review', iteration: 0, interruptId: 'i-1', type: 'approval_request', reasonCode: 'runtime_interrupt', prompt: 'Approve?', payload: { a: 1 }, downstreamNodeIds: [] };

    it('applies a transition only while the guard holds', async () => {
      const run = await newExecution();
      expect(await executions.markStarted(run.id, { t: { replayId: 'r' } })).toBe(false);
      await setStatus(run.id, 'running');
      expect(await executions.markStarted(run.id, { t: { replayId: 'r' } })).toBe(true);
      expect((await executions.findById(run.id))?.replayPlanningByTask).toEqual({ t: { replayId: 'r' } });

      expect(await executions.transition(run.id, { from: ['queued'], patch: { status: 'completed' } })).toBe(false);
      expect(await executions.transition(run.id, { from: ['queued', 'running'], patch: { status: 'completed', endedAt: new Date() } })).toBe(true);
      expect(await executions.markFailed(run.id, 'late', ['queued', 'running', 'pending_approval'])).toBe(false);
      expect(await executions.markFailed(run.id, 'forced')).toBe(true);
      expect((await executions.findById(run.id))?.status).toBe('failed');
      expect(await executions.transition('bad', { patch: { status: 'failed' } })).toBe(false);
    });

    it('only one of two concurrent terminal transitions wins', async () => {
      const run = await newExecution();
      const outcomes = await Promise.all([
        executions.transition(run.id, { from: ['queued', 'running', 'pending_approval'], patch: { status: 'completed' } }),
        executions.transition(run.id, { from: ['queued', 'running', 'pending_approval'], patch: { status: 'cancelled' } }),
      ]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
    });

    it('pauses an open run, appends the audit event with its defaults and refuses a terminal run', async () => {
      const run = await newExecution();
      await setStatus(run.id, 'running');
      expect(await executions.setPendingApproval(run.id, { ...pause, unknownKey: 1 } as never, hitlEvent)).toBe(true);
      const paused = await executions.findById(run.id);
      expect(paused?.status).toBe('pending_approval');
      expect(paused?.pendingApproval).toEqual({ ...pause, interruptPayload: { raw: 'x' } });
      expect(paused?.pendingApproval?.requestedAt).toBeInstanceOf(Date);
      expect(paused?.hitlEvents).toEqual([expect.objectContaining({
        ...hitlEvent, status: 'pending', riskLevel: 'medium', blockerRuleId: null, response: null, respondedAt: null, id: expect.any(String),
      })]);
      expect(paused?.hitlEvents[0].createdAt).toBeInstanceOf(Date);

      expect(await executions.setPendingApproval(run.id, pause)).toBe(true);
      expect((await executions.findById(run.id))?.hitlEvents).toHaveLength(1);

      await setStatus(run.id, 'completed');
      expect(await executions.setPendingApproval(run.id, pause)).toBe(false);
    });

    it('detects a stale interrupt: answered already, or the run is over', async () => {
      const run = await newExecution();
      await setStatus(run.id, 'running');
      await executions.setPendingApproval(run.id, pause, hitlEvent);
      expect(await executions.isInterruptStale(run.id, 'i-1')).toBe(false);
      await executions.answerHitlEvent(run.id, { from: ['pending_approval'], interruptId: 'i-1', response: { action: 'approved' }, patch: { status: 'running', pendingApproval: null } });
      expect(await executions.isInterruptStale(run.id, 'i-1')).toBe(true);
      expect(await executions.isInterruptStale(run.id, 'i-2')).toBe(false);
      await setStatus(run.id, 'cancelled');
      expect(await executions.isInterruptStale(run.id, 'i-2')).toBe(true);
      expect(await executions.isInterruptStale(oid(), 'i-1')).toBe(false);
    });

    it('claims a pending approval only when it matches, and releases the claim', async () => {
      const run = await newExecution();
      await setStatus(run.id, 'running');
      await executions.setPendingApproval(run.id, pause, hitlEvent);
      const claim = (match: { nodeId: string; iteration: number; interruptId?: string }) =>
        executions.transition(run.id, { from: ['pending_approval'], pendingApproval: match, patch: { status: 'running' } });
      expect(await claim({ nodeId: 'other', iteration: 0 })).toBe(false);
      expect(await claim({ nodeId: 'review', iteration: 1 })).toBe(false);
      expect(await claim({ nodeId: 'review', iteration: 0, interruptId: 'nope' })).toBe(false);

      const [a, b] = await Promise.all([claim({ nodeId: 'review', iteration: 0, interruptId: 'i-1' }), claim({ nodeId: 'review', iteration: 0 })]);
      expect([a, b].filter(Boolean)).toHaveLength(1);

      expect(await executions.transition(run.id, { from: ['running'], pendingApproval: { nodeId: 'review', iteration: 0 }, patch: { status: 'pending_approval' } })).toBe(true);
      expect((await executions.findById(run.id))?.status).toBe('pending_approval');
    });

    it('answers every event of the interrupt with the normalised response and leaves the others', async () => {
      const run = await newExecution();
      await setStatus(run.id, 'running');
      await executions.setPendingApproval(run.id, pause, hitlEvent);
      await setStatus(run.id, 'running');
      await executions.setPendingApproval(run.id, { ...pause, interruptId: 'i-2' }, { ...hitlEvent, interruptId: 'i-2' });

      expect(await executions.answerHitlEvent(run.id, {
        from: ['running', 'pending_approval'],
        interruptId: 'i-2',
        response: { action: 'reply', message: 'go', extra: 'dropped' },
        patch: { status: 'queued', queuePosition: 0, pendingApproval: null, inputContext: { __playbook_resume: { action: 'reply' } } },
      })).toBe(true);
      const after = await executions.findById(run.id);
      expect(after).toMatchObject({ status: 'queued', pendingApproval: null, inputContext: { __playbook_resume: { action: 'reply' } } });
      expect(after?.hitlEvents.map((x) => x.status)).toEqual(['pending', 'answered']);
      expect(after?.hitlEvents[1].response).toEqual({ action: 'reply', message: 'go', approved: null, reason: null, feedback: null, scope: 'step_only', remember: false });
      expect(after?.hitlEvents[1].respondedAt).toBeInstanceOf(Date);

      expect(await executions.answerHitlEvent(run.id, { from: ['pending_approval'], interruptId: 'i-1', response: { action: 'x' }, patch: {} })).toBe(false);
    });

    it('cancels an open run atomically, closing its pending events', async () => {
      const run = await newExecution();
      await setStatus(run.id, 'running');
      await executions.setPendingApproval(run.id, pause, hitlEvent);
      const cancelled = await executions.cancelOpen(run.id);
      expect(cancelled).toMatchObject({ status: 'cancelled', pendingApproval: null });
      expect(cancelled?.endedAt).toBeInstanceOf(Date);
      expect(cancelled?.hitlEvents[0]).toMatchObject({ status: 'cancelled', respondedAt: expect.any(Date) });
      expect(await executions.cancelOpen(run.id)).toBeNull();
    });
  });

  describe('task results', () => {
    let executionId: string;
    const key = (taskId: string, iteration = 0) => ({ executionId, taskId, iteration });

    beforeEach(async () => {
      executionId = (await newExecution()).id;
    });

    it('upserts: set always, setOnInsert only on create, NOT NULL documents default when nulled', async () => {
      expect(await taskResults.upsert(key('a'), { status: 'running', startedAt: new Date('2026-01-01T00:00:00Z') }, { parentTaskId: 'p' })).toBe(true);
      expect(await taskResults.upsert(key('a'), { status: 'completed', output: 'done', toolTrace: null, traceMetadata: null }, { parentTaskId: 'ignored', startedAt: new Date() })).toBe(true);
      const row = await taskResults.find(key('a'));
      expect(row).toMatchObject({
        status: 'completed', output: 'done', parentTaskId: 'p', toolTrace: [], traceMetadata: {}, judgeStatus: 'idle', judgeHistory: [], iteration: 0,
      });
      expect(row?.startedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(await taskResults.listForExecution(executionId)).toHaveLength(1);
    });

    it('keeps a string output that looks like JSON a string', async () => {
      await taskResults.upsert(key('num'), { output: '42' });
      await taskResults.upsert(key('obj'), { output: '{"a":1}' });
      await taskResults.upsert(key('doc'), { output: { a: 1 } });
      const byTask = new Map((await taskResults.listForExecution(executionId)).map((x) => [x.taskId, x.output]));
      expect(byTask.get('num')).toBe('42');
      expect(byTask.get('obj')).toBe('{"a":1}');
      expect(byTask.get('doc')).toEqual({ a: 1 });
    });

    it('appends streamed tokens atomically, creating the row as running', async () => {
      await taskResults.appendOutput(key('s'), 'a');
      await Promise.all(Array.from({ length: 12 }, () => taskResults.appendOutput(key('s'), 'b')));
      const row = await taskResults.find(key('s'));
      expect(row?.status).toBe('running');
      expect(row?.output).toBe(`a${'b'.repeat(12)}`);
      expect(await taskResults.appendOutput(key('s\u0000x'), 'c\u0000')).toBe(true);
    });

    it('keeps one row per (execution, task, iteration) under concurrent upserts', async () => {
      await Promise.all(Array.from({ length: 6 }, (_, i) => taskResults.upsert(key('race'), { status: 'running', error: `e${i}` })));
      expect((await taskResults.listForExecution(executionId, { taskIds: ['race'] }))).toHaveLength(1);
    });

    it('reports a write for a run that is gone instead of creating an orphan', async () => {
      expect(await taskResults.upsert({ executionId: oid(), taskId: 'x', iteration: 0 }, { status: 'running' })).toBe(false);
      expect(await taskResults.appendOutput({ executionId: oid(), taskId: 'x', iteration: 0 }, 't')).toBe(false);
      expect(await taskResults.upsert({ executionId: 'bad', taskId: 'x', iteration: 0 }, { status: 'running' })).toBe(false);
    });

    it('lists in the orders the services use, light reads leaving the documents out', async () => {
      await taskResults.upsert(key('b'), { status: 'completed', endedAt: new Date('2026-01-02T00:00:00Z'), startedAt: new Date('2026-01-01T00:00:00Z'), output: 'big', toolTrace: [{ callIndex: 0 }] });
      await taskResults.upsert(key('B'), { status: 'running', startedAt: new Date('2026-01-03T00:00:00Z') });
      await taskResults.upsert(key('a'), { status: 'completed', endedAt: new Date('2026-01-01T00:00:00Z') });
      await taskResults.upsert(key('a', 1), { status: 'failed', endedAt: new Date('2026-01-04T00:00:00Z'), error: 'boom' });

      expect((await taskResults.listForExecution(executionId)).map((x) => `${x.taskId}${x.iteration}`)).toEqual(['B0', 'a0', 'a1', 'b0']);
      expect((await taskResults.listForExecution(executionId, { order: 'ended' })).map((x) => `${x.taskId}${x.iteration}`)).toEqual(['B0', 'a0', 'b0', 'a1']);
      expect((await taskResults.listForExecution(executionId, { order: 'latest' })).map((x) => `${x.taskId}${x.iteration}`)).toEqual(['a1', 'b0', 'a0', 'B0']);
      expect((await taskResults.listForExecution(executionId, { order: 'recentlyStarted', statuses: ['running', 'completed'] })).map((x) => x.taskId)).toEqual(['B', 'b', 'a']);
      expect(await taskResults.listForExecution(executionId, { taskIds: [] })).toEqual([]);

      const light = await taskResults.listForExecution(executionId, { taskIds: ['b'], light: true });
      expect(light[0]).toMatchObject({ taskId: 'b', status: 'completed' });
      expect(light[0]).not.toHaveProperty('output');
      expect(light[0]).not.toHaveProperty('toolTrace');
      const withOutput = await taskResults.listForExecutions([executionId, 'bad'], { taskIds: ['b'], light: true, with: ['output'] });
      expect(withOutput[0].output).toBe('big');
      expect(withOutput[0]).not.toHaveProperty('toolTrace');

      expect((await taskResults.findLatestForTask(executionId, 'a'))?.iteration).toBe(1);
      expect((await taskResults.findLatestForTask(executionId, 'a', { statuses: ['completed'] }))?.iteration).toBe(0);
      expect((await taskResults.findLatestFailed(executionId))).toMatchObject({ taskId: 'a', iteration: 1, error: 'boom' });
      expect(await taskResults.find({ executionId, taskId: 'zzz', iteration: 0 })).toBeNull();
    });

    it('settles the open tasks of a run, interrupted ones included', async () => {
      await taskResults.upsert(key('p'), { status: 'pending' });
      await taskResults.upsert(key('i'), { status: 'interrupted' });
      await taskResults.upsert(key('c'), { status: 'completed' });
      expect(await taskResults.updateManyForExecution(executionId, { statuses: ['pending', 'running', 'interrupted'] }, { status: 'cancelled' })).toBe(2);
      expect((await taskResults.listForExecution(executionId)).map((x) => x.status).sort()).toEqual(['cancelled', 'cancelled', 'completed']);
    });

    it('writes the judge state and appends concurrent history entries without losing one', async () => {
      await taskResults.upsert(key('j'), { status: 'completed' });
      const row = (await taskResults.find(key('j')))!;
      expect(await taskResults.updateJudge(row.id, { judgeStatus: 'evaluating', judgeError: null })).toBe(true);
      const entry = (n: number) => ({ id: `h${n}`, createdAt: new Date(`2026-01-0${n}T00:00:00Z`), attemptNumber: n, scoringMode: 'llm', judgeResult: { overallScore: n } });
      await Promise.all([
        taskResults.pushJudgeHistory(row.id, entry(1), { judgeStatus: 'evaluated', judgeResult: { overallScore: 1 }, judgeScoringMode: 'llm' }),
        taskResults.pushJudgeHistory(row.id, entry(2)),
      ]);
      const after = await taskResults.find(key('j'));
      expect(after).toMatchObject({ judgeStatus: 'evaluated', judgeScoringMode: 'llm', judgeResult: { overallScore: 1 } });
      expect(after?.judgeHistory.map((h) => h.id).sort()).toEqual(['h1', 'h2']);
      expect(after?.judgeHistory[0].createdAt).toBeInstanceOf(Date);
      expect(await taskResults.updateJudge(oid(), { judgeStatus: 'failed' })).toBe(false);
    });

    it('lists the artifact results of the flows the user owns or is shared on', async () => {
      const ownRun = await newExecution();
      const sharedRun = await executions.insert({ flowId: otherFlowId, ownerId: otherId, recursionLimit: 25, maxParallelism: 5 });
      const artifact = [{ type: 'text' }, { type: 'artifact', data: { artifactId: 'a' } }];
      await taskResults.upsert({ executionId: ownRun.id, taskId: 'own', iteration: 0 }, { status: 'completed', components: artifact, endedAt: new Date('2026-05-01T00:00:00Z') });
      await taskResults.upsert({ executionId: ownRun.id, taskId: 'plain', iteration: 0 }, { status: 'completed', components: [{ type: 'text' }] });
      await taskResults.upsert({ executionId: sharedRun.id, taskId: 'shared', iteration: 0 }, { status: 'completed', components: artifact, endedAt: new Date('2026-05-02T00:00:00Z') });

      const mine = (await taskResults.listRecentArtifacts(ownerId, [], 50)).filter((x) => [ownRun.id, sharedRun.id].includes(x.executionId));
      expect(mine.map((x) => x.taskResult.taskId)).toEqual(['own']);
      const withShared = (await taskResults.listRecentArtifacts(ownerId, [otherFlowId], 50)).filter((x) => [ownRun.id, sharedRun.id].includes(x.executionId));
      expect(withShared.map((x) => x.taskResult.taskId)).toEqual(['shared', 'own']);
      expect(withShared[0]).toMatchObject({ flowId: otherFlowId, executionOwnerId: otherId, generatedAt: new Date('2026-05-02T00:00:00Z') });
      expect(withShared[0].taskResult.components).toEqual(artifact);
    });
  });

  describe('router decisions and deletion', () => {
    it('records decisions in order and refuses one for a run that is gone', async () => {
      const run = await newExecution();
      const first = await routerDecisions.create({ executionId: run.id, routerNodeId: 'r', iteration: 0, label: 'yes', decidedAt: new Date('2026-01-01T00:00:00Z') });
      await routerDecisions.create({ executionId: run.id, routerNodeId: 'r', iteration: 1, label: 'no\u0000' });
      expect(first).toMatchObject({ executionId: run.id, routerNodeId: 'r', label: 'yes' });
      expect((await routerDecisions.listForExecution(run.id)).map((x) => x.label)).toEqual(['yes', 'no']);
      expect(await routerDecisions.create({ executionId: oid(), routerNodeId: 'r', iteration: 0, label: 'x' })).toBeNull();
      expect(await routerDecisions.listForExecution('bad')).toEqual([]);
    });

    it('deletes a run with its task results and decisions, or all of an owner\'s runs of a flow', async () => {
      const flow = await newFlow();
      const run = await newExecution({ flowId: flow });
      await taskResults.upsert({ executionId: run.id, taskId: 't', iteration: 0 }, { status: 'completed' });
      await routerDecisions.create({ executionId: run.id, routerNodeId: 'r', iteration: 0, label: 'x' });
      expect(await executions.delete(run.id)).toBe(true);
      expect(await executions.delete(run.id)).toBe(false);
      expect(await taskResults.listForExecution(run.id)).toEqual([]);
      expect(await routerDecisions.listForExecution(run.id)).toEqual([]);

      await newExecution({ flowId: flow });
      await newExecution({ flowId: flow });
      expect(await executions.deleteByFlowAndOwner(flow, otherId)).toBe(0);
      expect(await executions.deleteByFlowAndOwner(flow, ownerId)).toBe(2);
      expect(await executions.countByFlow(flow)).toBe(0);
    });
  });
});
