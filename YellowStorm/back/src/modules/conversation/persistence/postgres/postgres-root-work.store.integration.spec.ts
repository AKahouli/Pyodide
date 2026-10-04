import { createHash, randomBytes } from 'crypto';
import { stableStringify } from '../../../agent/services/agent-execution-snapshot.service';
import { eq } from 'drizzle-orm';
import { LoggerService } from '@modules/logger';
import { conversations, rootExecutions } from '@modules/postgres/schema';
import { describeIntegration, makeTestDb } from '@modules/postgres/testing/pg-integration';
import { newStopRequestId, RootNativeState } from '../../root-work/root-work.types';
import { PostgresRootWorkStore } from './postgres-root-work.store';
import { producerEvidence } from '../../root-work/root-producer-evidence';
import { reserveFanoutManifest } from './root-fanout-reservation';
import { updateWorkerPermit } from './root-worker-permits';

describeIntegration('PostgresRootWorkStore epoch and native mapping', () => {
  const database = makeTestDb();
  const logger = { setContext: jest.fn() } as unknown as LoggerService;
  const store = new PostgresRootWorkStore(database.db, logger);
  let conversationId: string;
  let executionId: string;
  let nativeState: RootNativeState;
  const newId = () => randomBytes(12).toString('hex');
  const input = () => ({ executionId, conversationId, rootAgentId: null, workGroupId: null,
    parentExecutionId: null, role: 'root' as const, depth: 0, attempt: 1,
    conversationEpoch: 0, nativeState });

  beforeEach(async () => {
    conversationId = newId();
    executionId = newId();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: newId() });
    nativeState = { actorId: newId(), sessionId: 'native-session', invocationId: null,
      pendingInputs: [], rootContext: {},
      scope: { role: 'root', executionId, parentExecutionId: null, workGroupId: null,
        depth: 0, attempt: 1, conversationEpoch: 0, expectedFence: null, resumeIntent: 'start',
        immutableSnapshotRef: null, nativeInvocationId: null, nativeSessionId: 'native-session',
        deadlineEpochMs: null } };
  });
  afterEach(async () => { await database.db.delete(conversations).where(eq(conversations.id, conversationId)); });
  afterAll(async () => { await database.close(); });

  const fanoutProposal = (callId = 'fanout') => ({ version: 1, mode: 'foreground', nativeCallId: callId,
    nativeCallBranch: `root.run_fanout@${callId}`, target: { kind: 'temporary' },
    items: [{ key: 'a', task: 'A' }, { key: 'b', task: 'B' }] });
  const enableFanout = () => {
    nativeState.capabilityCeiling = { workspaceIds: [], tools: [], connectorBindings: [] } as unknown as RootNativeState['capabilityCeiling'];
    nativeState.rootContext = { fanout_enabled: true, max_fanout_items: 3,
      max_child_executions_per_work_group: 2, max_work_group_duration_seconds: 60,
      temporary_workers_enabled: true, max_temporary_workers: 2 };
  };

  it('shares worker slots across concurrent callers and never lets another owner release them', async () => {
    nativeState.rootContext = { max_parallel_workers: 1, max_child_executions_per_work_group: 3,
      max_work_group_duration_seconds: 60 };
    await store.registerExecution(input());
    const ids = [newId(), newId()];
    for (const id of ids) await store.registerExecution({ ...input(), executionId: id, parentExecutionId: executionId,
      role: 'library_worker', depth: 1 });
    const results = await Promise.all(ids.map((id) => updateWorkerPermit(database.db, executionId, id, `owner_${id}`, 'acquire')));
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = ids[results.indexOf(true)]; const loser = ids[results.indexOf(false)];
    expect(await updateWorkerPermit(database.db, executionId, winner, `owner_${winner}`, 'acquire')).toBe(true);
    expect(await updateWorkerPermit(database.db, executionId, winner, 'other', 'acquire')).toBe(false);
    expect(await updateWorkerPermit(database.db, executionId, winner, 'other', 'release')).toBe(false);
    await store.recordNativeState(executionId, nativeState, 'waiting');
    expect((await store.getExecution(executionId))?.resultPayload?.nativeState?.workerPermits?.[winner]).toBe(`owner_${winner}`);
    expect(await updateWorkerPermit(database.db, executionId, winner, `owner_${winner}`, 'release')).toBe(true);
    expect(await updateWorkerPermit(database.db, executionId, loser, `owner_${loser}`, 'acquire')).toBe(true);
    await store.stopRootWork({ conversationId, stopRequestId: newStopRequestId() });
    expect(await updateWorkerPermit(database.db, executionId, loser, `owner_${loser}`, 'acquire')).toBe(false);
    expect(await updateWorkerPermit(database.db, executionId, loser, `owner_${loser}`, 'release')).toBe(true);
  });

  it('reserves all fan-out allowances atomically and keeps replay immutable', async () => {
    enableFanout(); await store.registerExecution(input());
    const outcomes = await Promise.allSettled(['one', 'two'].map((id) => reserveFanoutManifest(database.db, executionId, fanoutProposal(id))));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof reserveFanoutManifest>>>;
    expect(await reserveFanoutManifest(database.db, executionId, fanoutProposal(winner.value.nativeCallId))).toEqual(winner.value);
    const changed = fanoutProposal(winner.value.nativeCallId); changed.items[0].task = 'Changed';
    await expect(reserveFanoutManifest(database.db, executionId, changed)).rejects.toThrow('immutable manifest');
    await expect(store.registerExecution({ ...input(), executionId: newId(), role: 'library_worker', depth: 1,
      parentExecutionId: executionId })).rejects.toThrow('budget');
    const childId = winner.value.items[0].executionId;
    const item = winner.value.items[0];
    const actualRequest = { task: item.task, expectedOutput: item.expectedOutput ?? '', contextRefs: item.contextRefs ?? [],
      nativeCallId: item.nativeRunId, nativeCallBranch: item.nativeCallBranch };
    for (const changed of [{ ...actualRequest, task: 'Changed' }, { ...actualRequest, expectedOutput: 'Changed' },
      { ...actualRequest, contextRefs: ['unapproved'] }]) {
      const digest = createHash('sha256').update(stableStringify(changed)).digest('hex');
      await expect(store.registerExecution({ ...input(), executionId: childId, role: 'temporary_worker', depth: 1,
        parentExecutionId: executionId, nativeState: { ...nativeState,
          rootContext: { delegate_request_digest: digest } } })).rejects.toThrow('reserved target or request');
    }
    expect((await store.registerExecution({ ...input(), executionId: childId, role: 'temporary_worker', depth: 1,
      parentExecutionId: executionId, nativeState: { ...nativeState,
        rootContext: { delegate_request_digest: winner.value.items[0].requestDigest } } })).id).toBe(childId);
    await expect(store.registerExecution({ ...input(), executionId: newId(), role: 'temporary_worker', depth: 1,
      parentExecutionId: executionId })).rejects.toThrow('allowance');
  });

  it('counts model workers rather than coordinator executions against lifetime allowances', async () => {
    enableFanout(); await store.registerExecution(input());
    await database.db.insert(rootExecutions).values({ id: newId(), conversationId, rootAgentId: null,
      workGroupId: null, parentExecutionId: executionId, role: 'fanout_driver', depth: 0,
      attempt: 1, conversationEpoch: 0, status: 'running' });
    const manifest = await reserveFanoutManifest(database.db, executionId, fanoutProposal());
    for (const item of manifest.items) {
      await store.registerExecution({ ...input(), executionId: item.executionId, parentExecutionId: executionId,
        role: 'temporary_worker', depth: 1, nativeState: { ...nativeState,
          rootContext: { delegate_request_digest: item.requestDigest } } });
    }
    await expect(store.registerExecution({ ...input(), executionId: newId(), parentExecutionId: executionId,
      role: 'temporary_worker', depth: 1 })).rejects.toThrow('allowance');
  });

  it('preserves server reservations against stale native traces and fences them with Stop', async () => {
    enableFanout(); await store.registerExecution(input());
    const manifest = await reserveFanoutManifest(database.db, executionId, fanoutProposal());
    await store.recordNativeState(executionId, nativeState, 'waiting');
    expect((await store.getExecution(executionId))?.resultPayload?.nativeState?.fanoutManifests).toEqual([manifest]);
    await store.stopRootWork({ conversationId, stopRequestId: newStopRequestId() });
    await expect(reserveFanoutManifest(database.db, executionId, fanoutProposal())).rejects.toThrow('active ROOT');
  });

  it('denies stale admission and completion after Stop, then settles cancellation', async () => {
    await store.registerExecution(input());
    await store.stopRootWork({ conversationId, stopRequestId: newStopRequestId() });
    await expect(store.registerExecution({ ...input(), executionId: newId() })).rejects.toThrow();
    expect(await store.completeExecution(executionId, 'completed', null)).toBeNull();
    expect(await store.recordNativeState(executionId, nativeState, 'waiting')).toBeNull();
    expect((await store.completeExecution(executionId, 'cancelled', null))?.status).toBe('cancelled');
  });

  it('retains the latest native mapping when a result completes', async () => {
    await store.registerExecution(input());
    const state = { ...nativeState, invocationId: 'invocation',
      pendingInputs: [{ inputId: 'input', inputVersion: 2, functionName: 'adk_request_input', responseSchemaAbsent: true }] };
    await store.recordNativeState(executionId, state, 'waiting');
    expect((await store.listWaitingRoots(conversationId, 0)).map((row) => row.id)).toEqual([executionId]);
    expect(await store.listWaitingRoots(conversationId, 1)).toEqual([]);
    const complete = await store.completeExecution(executionId, 'completed', {
      executionId, producerAgentId: null, producerRole: 'root', status: 'completed',
      text: 'done', citationRefs: [], artifactRefs: [], safeError: null,
    });
    expect(complete?.resultPayload?.nativeState).toEqual(state);
    expect(await store.listWaitingRoots(conversationId, 0)).toEqual([]);
    expect(await store.recordNativeState(executionId, nativeState, 'running')).toBeNull();
  });

  it('rejects invocation remapping and conflicting replay identity', async () => {
    await store.registerExecution(input());
    await store.recordNativeState(executionId, { ...nativeState, invocationId: 'first' }, 'running');
    await expect(store.recordNativeState(executionId, { ...nativeState, invocationId: 'second' }, 'waiting'))
      .rejects.toThrow('mapping conflicts');
    await expect(store.registerExecution({ ...input(), attempt: 2 })).rejects.toThrow('identity conflicts');
  });

  it('atomically limits concurrent children and preserves identical replay', async () => {
    nativeState.rootContext = { max_child_executions_per_work_group: 1 };
    await store.registerExecution(input());
    const childInput = (id: string) => ({ ...input(), executionId: id, role: 'library_worker' as const,
      depth: 1, parentExecutionId: executionId,
      nativeState: { ...nativeState, rootContext: { delegate_request_digest: 'request' },
        resolvedDefinitionsDigest: 'definition',
        scope: { ...nativeState.scope, executionId: id, role: 'library_worker' as const,
          parentExecutionId: executionId, depth: 1, immutableSnapshotRef: 'worker-snapshot' } } });
    const calls = [childInput(newId()), childInput(newId())];
    const admitted = await Promise.allSettled(calls.map((call) => store.registerExecution(call)));
    expect(admitted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = calls[admitted.findIndex((result) => result.status === 'fulfilled')];
    await store.markWaiting(winner.executionId);
    expect(await store.listWaitingRoots(conversationId, 0)).toEqual([]);
    await store.markWaiting(executionId);
    expect((await store.listWaitingRoots(conversationId, 0)).map((row) => row.id)).toEqual([executionId]);
    expect((await store.registerExecution(winner)).id).toBe(winner.executionId);
    await expect(store.registerExecution({ ...winner, nativeState: { ...winner.nativeState,
      rootContext: { delegate_request_digest: 'changed-request' } } })).rejects.toThrow('Worker replay conflicts');
    await store.stopRootWork({ conversationId, stopRequestId: newStopRequestId() });
    expect(await store.listWaitingRoots(conversationId, 0)).toEqual([]);
    await expect(store.registerExecution(winner)).rejects.toThrow('barrier');
  });

  it('rejects parked child replay after the root deadline expires', async () => {
    nativeState.rootContext = { max_child_executions_per_work_group: 2, max_work_group_duration_seconds: 60 };
    await store.registerExecution(input());
    const childId = newId();
    const child = { ...input(), executionId: childId, role: 'library_worker' as const,
      depth: 1, parentExecutionId: executionId };
    await store.registerExecution(child);
    await store.markWaiting(childId);
    await database.db.update(rootExecutions).set({ createdAt: new Date(Date.now() - 61000) })
      .where(eq(rootExecutions.id, executionId));
    await expect(store.registerExecution(child)).rejects.toThrow('deadline expired');
    expect((await store.getExecution(childId))?.status).toBe('waiting');
  });

  it('commits complete output and producer evidence together under the Stop fence', async () => {
    nativeState.rootContext = { max_child_executions_per_work_group: 1, max_work_group_duration_seconds: 60 };
    await store.registerExecution(input());
    const childId = newId();
    const child = await store.registerExecution({ ...input(), executionId: childId,
      role: 'library_worker', depth: 1, parentExecutionId: executionId,
      nativeState: { ...nativeState, rootContext: { selected_agent_id: newId() } } });
    const evidence = producerEvidence(child, [{ kind: 'citation', nativeIdentity: 'native-call',
      outputOrdinal: 0, payload: { reference: '7', filename: 'source.pdf' } }]);
    const fullText = 'x'.repeat(9000);
    const result = { executionId: childId, producerAgentId: evidence[0].producerAgentId,
      producerRole: 'library_worker' as const, status: 'completed' as const,
      text: fullText.slice(0, 8000), fullText, citationRefs: [evidence[0].evidenceId], artifactRefs: [], safeError: null };
    const [settled] = await Promise.all([
      store.completeExecution(childId, 'completed', result, evidence),
      store.stopRootWork({ conversationId, stopRequestId: newStopRequestId() }),
    ]);
    const records = await store.listEvidenceForExecution(childId);
    expect(records).toHaveLength(settled ? 1 : 0);
    if (settled) {
      expect(settled.resultPayload?.fullText).toBe(fullText);
      expect(settled.resultPayload?.citationRefs).toEqual([records[0].id]);
    }
    expect(await store.completeExecution(childId, 'completed', result, evidence)).toBeNull();
    expect(await store.listEvidenceForExecution(childId)).toEqual(records);
  });

  it('reserves temporary lifetime allowance atomically without replenishing it on completion', async () => {
    nativeState.rootContext = { temporary_workers_enabled: true, max_temporary_workers: 1,
      max_child_executions_per_work_group: 3, max_work_group_duration_seconds: 60 };
    await store.registerExecution(input());
    const calls = [newId(), newId()].map((id) => ({ ...input(), executionId: id,
      parentExecutionId: executionId, role: 'temporary_worker' as const, depth: 1 }));
    const results = await Promise.allSettled(calls.map((call) => store.registerExecution(call)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = calls[results.findIndex((result) => result.status === 'fulfilled')];
    expect((await store.registerExecution(winner)).id).toBe(winner.executionId);
    await store.completeExecution(winner.executionId, 'completed', null);
    expect((await store.registerExecution(winner)).status).toBe('completed');
    await expect(store.registerExecution({ ...winner, executionId: newId() })).rejects.toThrow('temporary worker allowance');
    expect((await store.registerExecution({ ...winner, executionId: newId(), role: 'library_worker' })).role).toBe('library_worker');
  });

  it('denies temporary admission when the frozen root opted out', async () => {
    nativeState.rootContext = { temporary_workers_enabled: false, max_temporary_workers: 4,
      max_child_executions_per_work_group: 10 };
    await store.registerExecution(input());
    await expect(store.registerExecution({ ...input(), executionId: newId(), parentExecutionId: executionId,
      role: 'temporary_worker', depth: 1 })).rejects.toThrow('disabled');
  });
});
