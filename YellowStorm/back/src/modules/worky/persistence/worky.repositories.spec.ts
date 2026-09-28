import { eq, inArray } from 'drizzle-orm';
import { isForeignKeyViolation, isUniqueViolation, newObjectId, withTransaction } from '@common/postgres';
import * as schema from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '../../postgres/testing/pg-integration';
import {
  WorkyAuditRepository,
  WorkyBudgetRepository,
  WorkyGovernanceRepository,
  WorkyInteractionRepository,
  WorkyMailRepository,
  WorkyMemoryRepository,
  WorkyMessageRepository,
  WorkyMirrorRepository,
  WorkyPlanRepository,
  WorkyReportRepository,
  WorkySchedulerRepository,
  WorkyStreamRepository,
  WorkyTaskRepository,
  WorkyTaskResultRepository,
} from './index';

describeIntegration('worky repositories (integration)', () => {
  const oid = (): string => newObjectId();
  const { db, close } = makeTestDb();
  const streams = new WorkyStreamRepository(db as never);
  const tasks = new WorkyTaskRepository(db as never);
  const messages = new WorkyMessageRepository(db as never);
  const mirror = new WorkyMirrorRepository(db as never);
  const interactions = new WorkyInteractionRepository(db as never);
  const plans = new WorkyPlanRepository(db as never);
  const budget = new WorkyBudgetRepository(db as never);
  const audit = new WorkyAuditRepository(db as never);
  const results = new WorkyTaskResultRepository(db as never);
  const scheduler = new WorkySchedulerRepository(db as never);
  const mail = new WorkyMailRepository(db as never);
  const memory = new WorkyMemoryRepository(db as never);
  const governance = new WorkyGovernanceRepository(db as never);
  const reports = new WorkyReportRepository(db as never);

  let ownerId: string;
  let otherId: string;
  let sharedId: string;
  const workspaceIds: string[] = [];

  const newStream = (owner = ownerId, title = `stream ${oid()}`) => streams.create({ ownerUserId: owner, workspaceId: owner, title });
  const newTask = (streamId: string, extra: Partial<Parameters<WorkyTaskRepository['create']>[0]> = {}) =>
    tasks.create({ streamId, title: 'a task', lane: 'backlog', actionCategory: 'internal_analysis', ...extra });

  beforeAll(async () => {
    ownerId = oid();
    otherId = oid();
    sharedId = oid();
    for (const id of [ownerId, otherId, sharedId]) {
      await db.insert(schema.identityUsers).values({ id, email: `wk-${id.slice(-8)}@example.com`, passwordHash: 'hash', emailVerified: true, status: 'active' });
    }
  });

  afterAll(async () => {
    // Streams cascade to everything below them; audit rows, policies and mail rows are removed explicitly.
    await db.delete(schema.workyStreams).where(inArray(schema.workyStreams.ownerUserId, [ownerId, otherId, sharedId]));
    await db.delete(schema.workyAuditEvents).where(inArray(schema.workyAuditEvents.streamId, [ownerId, ...workspaceIds]));
    await db.delete(schema.workyGovernancePolicies).where(inArray(schema.workyGovernancePolicies.workspaceId, workspaceIds));
    await db.delete(schema.identityUsers).where(inArray(schema.identityUsers.id, [ownerId, otherId, sharedId]));
    await close();
  });

  describe('streams', () => {
    it('creates a stream with the documented defaults and reads it back with its shares', async () => {
      const created = await newStream();
      expect(created).toMatchObject({
        ownerUserId: ownerId,
        status: 'created',
        controlState: 'active',
        currentPlanVersion: 0,
        executionPlanVersion: null,
        aiSessionId: null,
        shares: [],
        budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
      });
      const share = await streams.upsertShare(created.id, otherId, 'read');
      const found = await streams.findById(created.id);
      expect(found?.shares).toEqual([expect.objectContaining({ id: share.id, userId: otherId, permission: 'read' })]);
      expect(await streams.findById('not-an-id')).toBeNull();
      expect(await streams.findById(oid())).toBeNull();
    });

    it('changes a share in place, refuses a second row for the same user and reports what it removed', async () => {
      const stream = await newStream();
      const first = await streams.upsertShare(stream.id, otherId, 'read');
      const again = await streams.upsertShare(stream.id, otherId, 'write');
      expect(again.id).toBe(first.id);
      expect(again.permission).toBe('write');
      expect(await streams.listShares(stream.id)).toHaveLength(1);

      expect((await streams.updateSharePermission(stream.id, first.id, 'read'))?.permission).toBe('read');
      expect(await streams.updateSharePermission(oid(), first.id, 'read')).toBeNull();
      expect((await streams.deleteShare(stream.id, first.id))?.userId).toBe(otherId);
      expect(await streams.deleteShare(stream.id, first.id)).toBeNull();
    });

    it('finds a stream by its manager session id, which is unique', async () => {
      const a = await newStream();
      const b = await newStream();
      const session = `session-${oid()}`;
      await streams.update(a.id, { aiSessionId: session });
      expect(await streams.findByAiSessionId(session)).toEqual({ id: a.id, ownerUserId: ownerId });
      expect(await streams.findByAiSessionId('nope')).toBeNull();
      const clash = await streams.update(b.id, { aiSessionId: session }).catch((e: unknown) => e);
      expect(isUniqueViolation(clash, 'uq_worky_streams_ai_session')).toBe(true);
    });

    it('detects a taken title among the owner\'s other streams only', async () => {
      const a = await newStream(ownerId, `title-${oid()}`);
      const b = await newStream(ownerId, `title-${oid()}`);
      expect(await streams.titleTaken(ownerId, a.title, b.id)).toBe(true);
      expect(await streams.titleTaken(ownerId, a.title, a.id)).toBe(false);
      expect(await streams.titleTaken(otherId, a.title, b.id)).toBe(false);
    });

    it('lists what the user owns or is shared on, with counts, attention and lane stats', async () => {
      const marker = `lst-${oid()}`;
      const own = await newStream(sharedId, `${marker} own`);
      const shared = await newStream(otherId, `${marker} shared`);
      const hidden = await newStream(otherId, `${marker} hidden`);
      await streams.upsertShare(shared.id, sharedId, 'read');
      await streams.update(own.id, { status: 'waiting_for_owner' });
      const blocked = await newTask(shared.id, { lane: 'blocked' });
      await newTask(shared.id, { lane: 'done' });
      await newTask(hidden.id, { lane: 'blocked' });

      const all = await streams.listForUser(sharedId, { search: marker, page: 1, limit: 10, sort: 'title', sortDir: 'asc' });
      expect(all.items.map((s) => s.title)).toEqual([`${marker} own`, `${marker} shared`]);
      expect(all.total).toBe(2);
      expect(all.statusCounts).toEqual({ created: 1, waiting_for_owner: 1 });
      // The owned stream needs attention through its status, the shared one through a blocked task.
      expect(all.attentionCount).toBe(2);
      expect(all.laneCounts.get(shared.id)).toEqual({ blocked: 1, done: 1 });
      expect(all.laneCounts.get(own.id)).toBeUndefined();
      expect(all.items.find((s) => s.id === shared.id)?.shares).toHaveLength(1);

      const attention = await streams.listForUser(sharedId, { search: marker, attention: true, page: 1, limit: 10 });
      expect(attention.total).toBe(2);
      const created = await streams.listForUser(sharedId, { search: marker, statuses: ['created'], page: 1, limit: 10 });
      expect(created.items.map((s) => s.id)).toEqual([shared.id]);
      // The status filter does not change the counts of the scope.
      expect(created.statusCounts).toEqual({ created: 1, waiting_for_owner: 1 });

      await tasks.update(blocked.id, { lane: 'done' });
      expect((await streams.listForUser(sharedId, { search: marker, page: 1, limit: 10 })).attentionCount).toBe(1);

      const page2 = await streams.listForUser(sharedId, { search: marker, page: 2, limit: 1, sort: 'title', sortDir: 'asc' });
      expect(page2.items.map((s) => s.title)).toEqual([`${marker} shared`]);
      expect(page2.total).toBe(2);
    });

    it('treats a search as text, not as a pattern', async () => {
      const stream = await newStream(otherId, `100% done_${oid()}`);
      const found = await streams.listForUser(otherId, { search: '100% done_', page: 1, limit: 5 });
      expect(found.items.map((s) => s.id)).toContain(stream.id);
      expect((await streams.listForUser(otherId, { search: '%', page: 1, limit: 100 })).items.every((s) => s.title.includes('%'))).toBe(true);
    });

    it('linearises the plan version: only one of two concurrent writers advances it', async () => {
      const stream = await newStream();
      const outcomes = await Promise.all([streams.advancePlanVersion(stream.id, 0), streams.advancePlanVersion(stream.id, 0)]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      expect((await streams.findById(stream.id))?.currentPlanVersion).toBe(1);
      expect(await streams.advancePlanVersion(stream.id, 0)).toBe(false);
      expect(await streams.advancePlanVersion(stream.id, 1)).toBe(true);
    });

    it('reserves budget atomically: the limit holds under concurrency, a limit of 0 is unlimited', async () => {
      const limited = await newStream();
      await streams.setBudgetLimits(limited.id, { limitUsd: 1, limitTokens: 0, enforcement: 'hard_stop' });
      // Ten reservations of 0.3 USD race for a 1 USD budget: exactly three fit.
      const outcomes = await Promise.all(Array.from({ length: 10 }, () => streams.reserveBudget(limited.id, 0.3, 100)));
      expect(outcomes.filter(Boolean)).toHaveLength(3);
      const after = await streams.findById(limited.id);
      expect(after?.budget.spendUsd).toBeCloseTo(0.9, 8);
      expect(after?.budget.tokensUsed).toBe(300);

      await streams.releaseBudget(limited.id, 0.3, 100);
      expect((await streams.findById(limited.id))?.budget.spendUsd).toBeCloseTo(0.6, 8);
      // Releasing more than was reserved never drives a counter below zero.
      await streams.releaseBudget(limited.id, 50, 5000);
      expect(await streams.findById(limited.id)).toMatchObject({ budget: { spendUsd: 0, tokensUsed: 0 } });

      const unlimited = await newStream();
      expect(await streams.reserveBudget(unlimited.id, 1000, 1_000_000)).toBe(true);
      expect(await streams.reserveBudget(oid(), 1, 1)).toBe(false);

      const tokenLimited = await newStream();
      await streams.setBudgetLimits(tokenLimited.id, { limitUsd: 0, limitTokens: 100, enforcement: 'notify' });
      expect(await streams.reserveBudget(tokenLimited.id, 5, 60)).toBe(true);
      expect(await streams.reserveBudget(tokenLimited.id, 5, 60)).toBe(false);
      expect((await streams.findById(tokenLimited.id))?.budget).toMatchObject({ spendUsd: 5, tokensUsed: 60, enforcement: 'notify' });
    });

    it('deletes a stream together with everything under it, audit rows included', async () => {
      const stream = await newStream();
      const task = await newTask(stream.id);
      await messages.create({ streamId: stream.id, role: 'owner', content: 'hi' });
      await mirror.upsertProjection(stream.id, { title: 'plan', status: 'running' });
      await mirror.upsertStepComponent(stream.id, 'c1', { stepExternalId: 's1', type: 'toolActivity', data: {} });
      await interactions.create({ streamId: stream.id, taskId: task.id, type: 'clarification', question: 'why?' });
      await budget.insertCostEvent({ streamId: stream.id, taskId: task.id, type: 'llm', provider: 'p', modelId: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0.1 });
      await results.append({ taskId: task.id, status: 'done', summary: 'ok', payload: null, contentArtifactId: null, createdByWorkerId: null });
      await audit.append({ streamId: stream.id, action: 'stream.created' });

      expect(await streams.delete(stream.id)).toBe(true);
      expect(await streams.delete(stream.id)).toBe(false);
      expect(await tasks.findById(task.id)).toBeNull();
      expect(await messages.listRecent(stream.id, 10)).toEqual([]);
      expect(await mirror.findProjection(stream.id)).toBeNull();
      expect(await mirror.listStepComponents(stream.id, 's1')).toEqual([]);
      expect(await interactions.listByStream(stream.id)).toEqual([]);
      expect(await budget.costTotals(stream.id)).toMatchObject({ eventCount: 0 });
      expect(await results.listForTask(task.id)).toEqual([]);
      expect(await audit.listForScope(stream.id)).toEqual([]);
    });
  });

  describe('tasks', () => {
    it('creates a task with its budget and dependencies and reads it back', async () => {
      const stream = await newStream();
      const dep = await newTask(stream.id, { title: 'first' });
      const task = await newTask(stream.id, {
        title: 'second',
        dependsOn: [dep.id],
        requiredTools: ['search'],
        acceptanceCriteria: ['done'],
        budgetEstimateUsd: 0.25,
        tokensEstimate: 1234,
      });
      expect(task).toMatchObject({
        streamId: stream.id,
        lane: 'backlog',
        executionState: 'not_started',
        controlState: 'active',
        priority: 'medium',
        dependsOn: [dep.id],
        requiredTools: ['search'],
        acceptanceCriteria: ['done'],
        budget: { estimateUsd: 0.25, actualUsd: 0, tokensEstimate: 1234, tokensActual: 0 },
      });
      expect((await tasks.findByIds([dep.id, task.id, 'bad'])).map((t) => t.id).sort()).toEqual([dep.id, task.id].sort());
      expect((await tasks.listIdsByStream(stream.id)).sort()).toEqual([dep.id, task.id].sort());
      expect(await tasks.countByStream(stream.id)).toBe(2);
    });

    it('rejects a lane, a category or a negative budget the model does not know', async () => {
      const stream = await newStream();
      expect(await newTask(stream.id, { lane: 'sideways' }).catch((e: unknown) => e)).toBeInstanceOf(Error);
      expect(await newTask(stream.id, { actionCategory: 'teleport' }).catch((e: unknown) => e)).toBeInstanceOf(Error);
      expect(await newTask(stream.id, { budgetEstimateUsd: -1 }).catch((e: unknown) => e)).toBeInstanceOf(Error);
    });

    it('mirrors a manager step idempotently and keeps one task per (stream, step id)', async () => {
      const stream = await newStream();
      const set = {
        title: 'Analyse',
        description: 'look at it',
        ordinal: 2,
        lane: 'running',
        executionState: 'running',
        result: null,
        blockedReason: null,
        wave: 1,
        dependsOnStepIds: ['s0'],
        assigneeKey: 'analyst',
        kind: 'execute',
        question: null,
        interruptId: null,
        assigneeName: null,
        assigneeRole: null,
        isPersona: false,
        isDynamicDelegate: false,
      };
      const first = await tasks.upsertMirrored(stream.id, 's1', set);
      const replay = await tasks.upsertMirrored(stream.id, 's1', { ...set, lane: 'done', executionState: 'done', result: 'fine' });
      expect(replay.id).toBe(first.id);
      expect(replay).toMatchObject({ lane: 'done', executionState: 'done', result: 'fine', dependsOnStepIds: ['s0'], wave: 1, ordinal: 2 });
      expect(replay.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
      expect(await tasks.countByStream(stream.id)).toBe(1);
      // The same step id in another stream is another task.
      const other = await newStream();
      expect((await tasks.upsertMirrored(other.id, 's1', set)).id).not.toBe(first.id);
      // Two writers mirroring the same step at once still end with one row.
      await Promise.all([tasks.upsertMirrored(stream.id, 's2', set), tasks.upsertMirrored(stream.id, 's2', set)]);
      expect(await tasks.countByStream(stream.id)).toBe(2);
    });

    it('falls back to a numbered title and strips NUL from mirrored text', async () => {
      const stream = await newStream();
      const task = await tasks.upsertMirrored(stream.id, 's9', { title: '', ordinal: 4, description: 'a\u0000b', lane: 'backlog', executionState: 'not_started' });
      expect(task.title).toBe('Step 4');
      expect(task.description).toBe('ab');
    });

    it('lists the board by lane, least recently updated first, within a limit', async () => {
      const stream = await newStream();
      const a = await newTask(stream.id, { title: 'a', lane: 'done' });
      const b = await newTask(stream.id, { title: 'b', lane: 'running' });
      await newTask(stream.id, { title: 'c', lane: 'superseded' });
      const c = await newTask(stream.id, { title: 'd', lane: 'blocked' });
      await tasks.update(a.id, { title: 'a2' });
      const board = await tasks.listForBoard(stream.id, ['done', 'running', 'blocked'], 10);
      expect(board.map((t) => t.id)).toEqual([b.id, c.id, a.id]);
      expect((await tasks.listForBoard(stream.id, ['done', 'running', 'blocked'], 2)).map((t) => t.id)).toEqual([b.id, c.id]);
    });

    it('updates within a stream only, and clears an assignee', async () => {
      const stream = await newStream();
      const other = await newStream();
      const task = await newTask(stream.id);
      expect(await tasks.updateInStream(task.id, other.id, { lane: 'done' })).toBeNull();
      const assigned = await tasks.updateInStream(task.id, stream.id, { assigneeType: 'human_agent', assigneeId: otherId, theoreticalDeadlineAt: new Date('2030-01-01T00:00:00Z') });
      expect(assigned).toMatchObject({ assigneeType: 'human_agent', assigneeId: otherId });
      expect(assigned?.theoreticalDeadlineAt?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
      expect(await tasks.update(task.id, { assigneeType: 'unassigned', assigneeId: null, theoreticalDeadlineAt: null })).toMatchObject({ assigneeId: null, theoreticalDeadlineAt: null });
    });

    it('adds an actual cost atomically', async () => {
      const stream = await newStream();
      const task = await newTask(stream.id, { budgetEstimateUsd: 1 });
      await Promise.all([tasks.addActualCost(task.id, 0.1, 100), tasks.addActualCost(task.id, 0.2, 50)]);
      expect((await tasks.findById(task.id))?.budget).toMatchObject({ estimateUsd: 1, tokensActual: 150 });
      expect((await tasks.findById(task.id))?.budget.actualUsd).toBeCloseTo(0.3, 8);
      expect(await tasks.addActualCost(oid(), 1, 1)).toBeNull();
    });

    it('completes a task once: stamps duration from startedAt, then refuses a terminal one', async () => {
      const stream = await newStream();
      const task = await newTask(stream.id);
      await db.update(schema.workyTasks).set({ startedAt: new Date(Date.now() - 5000) }).where(eq(schema.workyTasks.id, task.id));
      const at = new Date();
      expect(await tasks.completeIfOpen(task.id, { lane: 'done', executionState: 'done' }, at)).toBe(true);
      const done = await tasks.findById(task.id);
      expect(done).toMatchObject({ lane: 'done', executionState: 'done' });
      expect(done?.durationMs).toBeGreaterThanOrEqual(4900);
      expect(await tasks.completeIfOpen(task.id, { lane: 'done', executionState: 'failed' }, new Date())).toBe(false);
      // Without a start there is no duration.
      const unstarted = await newTask(stream.id);
      expect(await tasks.completeIfOpen(unstarted.id, { lane: 'done', executionState: 'failed' }, new Date())).toBe(true);
      expect((await tasks.findById(unstarted.id))?.durationMs).toBeNull();
    });

    it('takes its dependents with it when a task is deleted, and nulls what only points at it', async () => {
      const stream = await newStream();
      const task = await newTask(stream.id);
      const interaction = await interactions.create({ streamId: stream.id, taskId: task.id, type: 'approval', question: 'ok?' });
      await results.append({ taskId: task.id, status: 'done', summary: '', payload: null, contentArtifactId: null, createdByWorkerId: null });
      await budget.createReservation({ streamId: stream.id, taskId: task.id, amountUsd: 1, tokens: 1, status: 'reserved' });
      await db.delete(schema.workyTasks).where(eq(schema.workyTasks.id, task.id));
      expect(await results.listForTask(task.id)).toEqual([]);
      expect((await interactions.findById(interaction.id))?.taskId).toBeNull();
    });

    it('refuses a task under a stream that does not exist', async () => {
      const err = await newTask(oid()).catch((e: unknown) => e);
      expect(isForeignKeyViolation(err)).toBe(true);
    });
  });

  describe('messages and the Electric mirror', () => {
    it('lists the last N messages oldest first and attaches their components', async () => {
      const stream = await newStream();
      const created: string[] = [];
      for (const content of ['one', 'two', 'three']) created.push((await messages.create({ streamId: stream.id, role: 'owner', content })).id);
      expect((await messages.listRecent(stream.id, 2)).map((m) => m.content)).toEqual(['two', 'three']);
      expect((await messages.listRecent(stream.id, 10)).map((m) => m.id)).toEqual(created);

      await messages.mirror(stream.id, 'm1', { role: 'manager', content: 'answer', turnId: 't1', emittedAt: new Date() });
      await messages.upsertComponent(stream.id, 'k2', { messageExternalId: 'm1', ordinal: 2, type: 'choice', data: { b: 1 } });
      await messages.upsertComponent(stream.id, 'k1', { messageExternalId: 'm1', ordinal: 1, type: 'text', data: { a: 1 } });
      const components = await messages.listComponents(stream.id, ['m1']);
      expect(components.map((c) => c.externalId)).toEqual(['k1', 'k2']);
      expect(components[1].data).toEqual({ b: 1 });
      expect(await messages.listComponents(stream.id, [])).toEqual([]);
    });

    it('adopts the owner\'s local copy instead of duplicating it, then updates it in place', async () => {
      const stream = await newStream();
      const local = await messages.create({ streamId: stream.id, role: 'owner', content: 'hello' });
      const mirrored = await messages.mirror(stream.id, 'pg-1', { role: 'owner', content: 'hello', turnId: 'turn-1', emittedAt: new Date('2030-01-01T00:00:00Z') });
      expect(mirrored.id).toBe(local.id);
      expect(mirrored).toMatchObject({ externalId: 'pg-1', turnId: 'turn-1' });
      const replay = await messages.mirror(stream.id, 'pg-1', { role: 'owner', content: 'hello', turnId: 'turn-1', emittedAt: new Date() });
      expect(replay.id).toBe(local.id);
      expect(await messages.listRecent(stream.id, 10)).toHaveLength(1);
    });

    it('inserts a manager message once, and a second owner message with the same content separately', async () => {
      const stream = await newStream();
      const a = await messages.mirror(stream.id, 'pg-a', { role: 'manager', content: 'reply', emittedAt: new Date() });
      const b = await messages.mirror(stream.id, 'pg-a', { role: 'manager', content: 'reply edited', emittedAt: new Date() });
      expect(b.id).toBe(a.id);
      expect(b.content).toBe('reply edited');
      await messages.mirror(stream.id, 'pg-o1', { role: 'owner', content: 'same', emittedAt: new Date() });
      await messages.mirror(stream.id, 'pg-o2', { role: 'owner', content: 'same', emittedAt: new Date() });
      expect((await messages.listRecent(stream.id, 10)).map((m) => m.externalId)).toEqual(['pg-a', 'pg-o1', 'pg-o2']);
    });

    it('writes the plan and the session halves of a projection independently', async () => {
      const stream = await newStream();
      expect(await mirror.findProjection(stream.id)).toBeNull();
      await mirror.upsertProjection(stream.id, { title: 'Plan', goal: 'win', status: 'running' });
      await mirror.upsertProjection(stream.id, { sessionStatus: 'waiting', activeInterruptId: 'i-1' });
      expect(await mirror.findProjection(stream.id)).toMatchObject({ title: 'Plan', goal: 'win', status: 'running', sessionStatus: 'waiting', activeInterruptId: 'i-1' });
      await mirror.upsertProjection(stream.id, { status: 'completed', activeInterruptId: null });
      expect(await mirror.findProjection(stream.id)).toMatchObject({ title: 'Plan', status: 'completed', sessionStatus: 'waiting', activeInterruptId: null });
    });

    it('stores step components and artifacts and finds them by step', async () => {
      const stream = await newStream();
      await mirror.upsertStepComponent(stream.id, 'c2', { stepExternalId: 's1', ordinal: 2, type: 'toolActivity', data: { n: 2 } });
      await mirror.upsertStepComponent(stream.id, 'c1', { stepExternalId: 's1', ordinal: 1, type: 'toolActivity', data: { n: 1 } });
      await mirror.upsertStepComponent(stream.id, 'c3', { stepExternalId: 's2', ordinal: 0, type: 'toolActivity', data: {} });
      expect((await mirror.listStepComponents(stream.id, 's1')).map((c) => c.externalId)).toEqual(['c1', 'c2']);

      await mirror.upsertStepArtifact(stream.id, 'a1', { stepExternalId: 's1', filePath: 'p/a.csv', filename: 'a.csv', artifactKind: 'data', mimeType: null, size: 12 });
      await mirror.upsertStepArtifact(stream.id, 'a1', { stepExternalId: 's1', filePath: 'p/a.csv', filename: 'a.csv', artifactKind: 'data', mimeType: 'text/csv', size: 12 });
      expect(await mirror.listStepArtifacts(stream.id, 's1')).toHaveLength(1);
      expect(await mirror.findStepArtifact(stream.id, 's1', 'a1')).toMatchObject({ mimeType: 'text/csv', size: 12 });
      expect(await mirror.findStepArtifact(stream.id, 's2', 'a1')).toBeNull();
    });

    it('keeps the resume position of a shape', async () => {
      const shape = `shape-${oid()}`;
      expect(await mirror.findCursor(shape)).toBeNull();
      await mirror.saveCursor(shape, 'h-1', '0_0');
      await mirror.saveCursor(shape, 'h-1', '10_0');
      expect(await mirror.findCursor(shape)).toMatchObject({ shape, handle: 'h-1', logOffset: '10_0' });
      await mirror.saveCursor(shape, null, '11_0');
      expect(await mirror.findCursor(shape)).toMatchObject({ handle: null, logOffset: '11_0' });
      await db.delete(schema.workyElectricCursors).where(eq(schema.workyElectricCursors.shape, shape));
    });
  });

  describe('interactions and plan history', () => {
    it('answers an interaction once', async () => {
      const stream = await newStream();
      const created = await interactions.create({ streamId: stream.id, type: 'clarification', question: 'which?', options: ['a', 'b'], targetUserId: ownerId, blocksTaskIds: [oid()] });
      expect(created).toMatchObject({ status: 'pending', options: ['a', 'b'], blockingScope: 'stream' });
      expect((await interactions.listPending(stream.id)).map((i) => i.id)).toEqual([created.id]);

      const answered = await interactions.respond(created.id, { status: 'responded', response: 'a' });
      expect(answered).toMatchObject({ status: 'responded', response: 'a' });
      expect(answered?.respondedAt).toBeInstanceOf(Date);
      expect(await interactions.respond(created.id, { status: 'canceled', response: '' })).toBeNull();
      expect(await interactions.listPending(stream.id)).toEqual([]);
      expect(await interactions.findById(created.id)).toMatchObject({ status: 'responded' });
    });

    it('lets only one of two concurrent answers win', async () => {
      const stream = await newStream();
      const created = await interactions.create({ streamId: stream.id, type: 'approval', question: 'go?' });
      const outcomes = await Promise.all([
        interactions.respond(created.id, { status: 'responded', response: 'yes' }),
        interactions.respond(created.id, { status: 'canceled', response: '' }),
      ]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
    });

    it('stores a delta and version per number and applies a pending delta once', async () => {
      const stream = await newStream();
      const delta = await plans.createDelta({
        streamId: stream.id, basePlanVersion: 0, resultPlanVersion: 0, phase: 'replan', triggerEventId: 'ev-1',
        status: 'pending_approval', applyMode: 'manual', reason: 'because', createdBy: ownerId, body: { create_tasks: [] },
      });
      expect(await plans.findDeltaById(delta.id)).toMatchObject({ status: 'pending_approval', body: { create_tasks: [] }, appliedAt: null });
      expect(await plans.markApplied(delta.id, { resultPlanVersion: 1, approvedBy: ownerId })).toBe(true);
      expect(await plans.markApplied(delta.id, { resultPlanVersion: 2, approvedBy: ownerId })).toBe(false);
      expect(await plans.findDeltaById(delta.id)).toMatchObject({ status: 'applied', resultPlanVersion: 1, approvedBy: ownerId });

      const applied = await plans.createDelta({
        streamId: stream.id, basePlanVersion: 1, resultPlanVersion: 2, phase: 'replan', triggerEventId: 'ev-2',
        status: 'applied', applyMode: 'pending_approval', reason: '', createdBy: ownerId, body: {},
      });
      expect(applied.appliedAt).toBeInstanceOf(Date);

      await plans.createVersion({ streamId: stream.id, versionNumber: 1, phase: 'planning', createdBy: ownerId, triggerEventId: 'ev-1', summary: '+1 task' });
      const dup = await plans.createVersion({ streamId: stream.id, versionNumber: 1, phase: 'planning', createdBy: ownerId, summary: '' }).catch((e: unknown) => e);
      expect(isUniqueViolation(dup, 'uq_worky_plan_versions_number')).toBe(true);
    });
  });

  describe('budget records', () => {
    it('tracks reservations through their statuses', async () => {
      const stream = await newStream();
      const task = await newTask(stream.id);
      const reservation = await budget.createReservation({ streamId: stream.id, taskId: task.id, amountUsd: 0.5, tokens: 10, status: 'reserved' });
      expect(await budget.findReservation(reservation.id)).toMatchObject({ amountUsd: 0.5, tokens: 10, status: 'reserved' });
      expect(await budget.transitionReservation(reservation.id, 'released', 'consumed')).toBeNull();
      expect(await budget.transitionReservation(reservation.id, 'reserved', 'released')).toMatchObject({ status: 'released' });
      expect(await budget.transitionReservation(reservation.id, 'reserved', 'released')).toBeNull();

      await budget.createReservation({ streamId: stream.id, taskId: task.id, amountUsd: 1, tokens: 1, status: 'reserved' });
      await budget.createReservation({ streamId: stream.id, taskId: task.id, amountUsd: 1, tokens: 1, status: 'denied' });
      expect(await budget.consumeOpenReservations(task.id)).toBe(1);
      expect(await budget.consumeOpenReservations(task.id)).toBe(0);
    });

    it('sums the cost events of a stream', async () => {
      const stream = await newStream();
      const empty = await budget.costTotals(stream.id);
      expect(empty).toEqual({ totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, eventCount: 0 });
      await budget.insertCostEvent({ streamId: stream.id, taskId: null, type: 'llm', provider: 'p', modelId: 'm', inputTokens: 100, outputTokens: 20, costUsd: 0.125 });
      await budget.insertCostEvent({ streamId: stream.id, taskId: null, type: 'tool', provider: 'p', modelId: 'm', inputTokens: 1, outputTokens: 2, costUsd: 0.25 });
      expect(await budget.costTotals(stream.id)).toEqual({ totalCostUsd: 0.375, totalInputTokens: 101, totalOutputTokens: 22, eventCount: 2 });
    });
  });

  describe('audit, traces, results', () => {
    it('appends audit rows for a scope that is not a stream and drops a malformed actor', async () => {
      const scope = oid();
      workspaceIds.push(scope);
      await audit.append({ streamId: scope, actorUserId: 'not-an-id', action: 'governance.policy.upserted', targetType: 'workspace', targetId: scope, details: { a: 'x\u0000y' } });
      await audit.append({ streamId: scope, actorUserId: ownerId, action: 'second' });
      const rows = await audit.listForScope(scope);
      expect(rows.map((r) => r.action)).toEqual(['governance.policy.upserted', 'second']);
      expect(rows[0]).toMatchObject({ actorUserId: null, targetId: scope, details: { a: 'xy' } });
      expect(rows[1].actorUserId).toBe(ownerId);
    });

    it('lists traces per stream and per task, oldest first, within a limit', async () => {
      const stream = await newStream();
      const t1 = await newTask(stream.id);
      const t2 = await newTask(stream.id);
      for (const [task, name] of [[t1, 'a'], [t2, 'b'], [t1, 'c']] as const) {
        await audit.createTrace({ streamId: stream.id, taskId: task.id, kind: 'tool', name, summary: '', rawPayloadUri: 'https://x/raw', durationMs: 12.7 });
      }
      expect((await audit.listTracesForStream(stream.id, 10)).map((t) => t.name)).toEqual(['a', 'b', 'c']);
      expect((await audit.listTracesForStream(stream.id, 2)).map((t) => t.name)).toEqual(['a', 'b']);
      const forTask = await audit.listTracesForTask(stream.id, t1.id, 10);
      expect(forTask.map((t) => t.name)).toEqual(['a', 'c']);
      expect(forTask[0]).toMatchObject({ durationMs: 13, rawPayloadUri: 'https://x/raw' });
      expect(await audit.listWorkersByStream(stream.id)).toEqual([]);
    });

    it('numbers task results per task, also when two writers race', async () => {
      const stream = await newStream();
      const task = await newTask(stream.id);
      const other = await newTask(stream.id);
      const input = { status: 'done', summary: 's', payload: { output: 'x' }, contentArtifactId: null, createdByWorkerId: null };
      const raced = await Promise.all([results.append({ taskId: task.id, ...input }), results.append({ taskId: task.id, ...input })]);
      expect(raced.map((r) => r.version).sort()).toEqual([1, 2]);
      await results.append({ taskId: task.id, ...input, payload: null });
      expect((await results.listForTask(task.id)).map((r) => r.version)).toEqual([3, 2, 1]);
      expect((await results.append({ taskId: other.id, ...input })).version).toBe(1);
      expect((await results.listForTask(task.id))[0].payload).toBeNull();
    });
  });

  describe('scheduler', () => {
    it('claims each due timer exactly once across concurrent workers and not before it is due', async () => {
      const stream = await newStream();
      const past = new Date(Date.now() - 60_000);
      const ids = new Set<string>();
      for (let i = 0; i < 6; i += 1) ids.add((await scheduler.create({ streamId: stream.id, taskId: null, eventType: 'human_task.reminder', fireAt: past })).id);
      const future = await scheduler.create({ streamId: stream.id, taskId: null, eventType: 'human_task.deadline', fireAt: new Date(Date.now() + 3_600_000) });

      const claimed: string[] = [];
      const worker = async (): Promise<void> => {
        for (;;) {
          const event = await scheduler.claimDue(new Date(), oid());
          if (!event) return;
          claimed.push(event.id);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const mine = claimed.filter((id) => ids.has(id));
      expect(mine.sort()).toEqual([...ids].sort());
      expect(claimed).not.toContain(future.id);
      expect(new Set(claimed).size).toBe(claimed.length);

      const row = await db.select().from(schema.workyScheduledEvents).where(eq(schema.workyScheduledEvents.id, mine[0]));
      expect(row[0]).toMatchObject({ status: 'claimed' });
      expect(row[0].claimToken).toBeTruthy();
    });

    it('fires a claimed timer once, cancels only pending ones and requeues an expired lease', async () => {
      const stream = await newStream();
      const past = new Date(Date.now() - 60_000);
      const a = await scheduler.create({ streamId: stream.id, taskId: null, eventType: 'e', fireAt: past });
      const b = await scheduler.create({ streamId: stream.id, taskId: null, eventType: 'e', fireAt: new Date(Date.now() + 3_600_000) });

      await scheduler.cancelPending(b.id);
      expect((await db.select().from(schema.workyScheduledEvents).where(eq(schema.workyScheduledEvents.id, b.id)))[0].status).toBe('canceled');

      expect(await scheduler.markFired(a.id, new Date())).toBe(false); // not claimed yet
      const claimed = await scheduler.claimDue(new Date(), 'tok');
      expect(claimed).not.toBeNull();
      // A claimed timer cannot be cancelled: the worker holding the lease dispatches it.
      await scheduler.cancelPending(claimed!.id);
      expect((await db.select().from(schema.workyScheduledEvents).where(eq(schema.workyScheduledEvents.id, claimed!.id)))[0].status).toBe('claimed');

      // Its lease is older than the cutoff, so it goes back in the queue.
      expect(await scheduler.requeueExpired(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(1);
      const requeued = (await db.select().from(schema.workyScheduledEvents).where(eq(schema.workyScheduledEvents.id, claimed!.id)))[0];
      expect(requeued).toMatchObject({ status: 'pending', claimToken: null, claimedAt: null });

      const again = await scheduler.claimDue(new Date(), 'tok2');
      expect(again?.id).toBeDefined();
      expect(await scheduler.markFired(again!.id, new Date())).toBe(true);
      expect(await scheduler.markFired(again!.id, new Date())).toBe(false);
    });
  });

  describe('mail', () => {
    it('records an outbound mail once per stream and dedup key', async () => {
      const stream = await newStream();
      const other = await newStream();
      const input = { streamId: stream.id, taskId: null, kind: 'human_task.assigned', dedupKey: `key-${oid()}` };
      expect(await mail.recordMail(input)).toBe(true);
      expect(await mail.recordMail(input)).toBe(false);
      expect(await mail.recordMail({ ...input, streamId: other.id })).toBe(true);
    });

    it('a repeated mail does not abort the surrounding transaction', async () => {
      const stream = await newStream();
      const input = { streamId: stream.id, taskId: null, kind: 'k', dedupKey: `key-${oid()}` };
      await withTransaction(db, async () => {
        expect(await mail.recordMail(input)).toBe(true);
        expect(await mail.recordMail(input)).toBe(false);
        expect(await mail.recordMail({ ...input, dedupKey: `${input.dedupKey}-2` })).toBe(true);
      });
    });

    it('keeps one subscription per (user, mailbox) and finds it by client state, expiry and user', async () => {
      const user = oid();
      await db.insert(schema.identityUsers).values({ id: user, email: `wk-mail-${user.slice(-8)}@example.com`, passwordHash: 'h', emailVerified: true, status: 'active' });
      try {
        expect(await mail.findByUser(user)).toBeNull();
        const state = `state-${oid()}`;
        const soon = new Date(Date.now() + 5 * 60_000);
        const created = await mail.upsertMailbox(user, 'microsoft', { subscriptionId: 'sub-1', clientState: state, expiresAt: soon, notificationUrl: 'https://a' });
        const again = await mail.upsertMailbox(user, 'microsoft', { notificationUrl: 'https://b' });
        expect(again.id).toBe(created.id);
        expect(again).toMatchObject({ subscriptionId: 'sub-1', clientState: state, notificationUrl: 'https://b' });
        expect((await mail.findByClientState(state))?.id).toBe(created.id);
        expect(await mail.findByClientState('nope')).toBeNull();
        expect((await mail.findByUser(user))?.id).toBe(created.id);

        const polled = await mail.upsertMailbox(user, 'gmail', { subscriptionId: null, clientState: null, expiresAt: null, notificationUrl: null });
        expect(polled.subscriptionId).toBeNull();
        // Only the push subscription that expires soon is due for renewal.
        const due = (await mail.listExpiring(new Date(Date.now() + 20 * 60_000))).filter((s) => s.userId === user);
        expect(due.map((s) => s.id)).toEqual([created.id]);
        expect((await mail.listExpiring(new Date(Date.now() + 60_000))).filter((s) => s.userId === user)).toEqual([]);

        const later = new Date(Date.now() + 72 * 3_600_000);
        await mail.setExpiry(created.id, later);
        await mail.setLastSwept(polled.id, later);
        expect((await mail.findByClientState(state))?.expiresAt?.getTime()).toBe(later.getTime());
        expect((await mail.listAll()).filter((s) => s.userId === user)).toHaveLength(2);
        await mail.deleteById(created.id);
        expect(await mail.findByClientState(state)).toBeNull();
      } finally {
        await db.delete(schema.identityUsers).where(eq(schema.identityUsers.id, user));
      }
    });
  });

  describe('memory, governance, reports', () => {
    it('confirms a proposal into an entry once, and rejects only a pending one', async () => {
      const stream = await newStream();
      const proposal = await memory.createProposal({ ownerUserId: ownerId, sourceStreamId: stream.id, category: 'stream_summary', title: 'Summary', content: 'it went well' });
      expect(proposal).toMatchObject({ status: 'pending', decidedAt: null });
      const confirmed = await memory.confirm(proposal.id);
      expect(confirmed?.proposal).toMatchObject({ status: 'confirmed' });
      expect(confirmed?.entry).toMatchObject({ ownerUserId: ownerId, sourceProposalId: proposal.id, sourceStreamId: stream.id, title: 'Summary' });
      expect(await memory.confirm(proposal.id)).toBeNull();
      expect(await memory.reject(proposal.id)).toBeNull();
      expect((await memory.findEntryByProposal(proposal.id))?.id).toBe(confirmed?.entry.id);

      const second = await memory.createProposal({ ownerUserId: ownerId, sourceStreamId: null, category: 'preference', title: 'Likes', content: 'tea' });
      expect((await memory.reject(second.id))?.status).toBe('rejected');
      expect(await memory.confirm(second.id)).toBeNull();
      expect(await memory.findEntryByProposal(second.id)).toBeNull();

      expect((await memory.listProposals(ownerId, 'rejected', 100)).map((p) => p.id)).toContain(second.id);
      expect((await memory.listProposals(ownerId, undefined, 1))).toHaveLength(1);
      expect((await memory.listEntries(ownerId, 100)).map((e) => e.id)).toContain(confirmed?.entry.id);
      expect(await memory.listEntries('bad', 10)).toEqual([]);
    });

    it('deleting a stream deletes the memory that came from it', async () => {
      const stream = await newStream();
      const proposal = await memory.createProposal({ ownerUserId: ownerId, sourceStreamId: stream.id, category: 'person', title: 'P', content: 'c' });
      await memory.confirm(proposal.id);
      await streams.delete(stream.id);
      expect(await memory.findProposal(proposal.id)).toBeNull();
      expect(await memory.findEntryByProposal(proposal.id)).toBeNull();
    });

    it('upserts a workspace policy and returns the same row on the second call', async () => {
      const workspace = oid();
      workspaceIds.push(workspace);
      expect(await governance.findWorkspacePolicy(workspace)).toBeNull();
      const first = await governance.upsertWorkspacePolicy({
        workspaceId: workspace, defaultLevel: 'notify', categories: [{ category: 'external_send', level: 'approval' }], allowStreamOwnerOverride: true, maxOwnerRelaxLevel: 'notify',
      });
      const second = await governance.upsertWorkspacePolicy({
        workspaceId: workspace, defaultLevel: 'approval', categories: [], allowStreamOwnerOverride: false, maxOwnerRelaxLevel: 'approval',
      });
      expect(second.id).toBe(first.id);
      expect(await governance.findWorkspacePolicy(workspace)).toMatchObject({ defaultLevel: 'approval', categories: [], allowStreamOwnerOverride: false });
      expect((await governance.upsertWorkspacePolicy({ workspaceId: workspace, defaultLevel: 'bogus', categories: [], allowStreamOwnerOverride: true, maxOwnerRelaxLevel: 'notify' }).catch((e: unknown) => e))).toBeInstanceOf(Error);
    });

    it('keeps one report per stream and overwrites it', async () => {
      const stream = await newStream();
      expect(await reports.findByStream(stream.id)).toBeNull();
      const first = await reports.upsert(stream.id, { type: 'rich', status: 'ready', summary: 's1', markdown: '# one', metadata: { taskCount: 1 }, generatedAt: new Date() });
      const second = await reports.upsert(stream.id, { type: 'lightweight', status: 'ready', summary: 's2', markdown: '# two', metadata: { taskCount: 2 }, generatedAt: new Date() });
      expect(second.id).toBe(first.id);
      expect(await reports.findByStream(stream.id)).toMatchObject({ type: 'lightweight', summary: 's2', markdown: '# two', metadata: { taskCount: 2 } });
    });
  });
});
