import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { conversations, rootBackgroundJobs, rootExecutions } from '../../../postgres/schema';
import { stableStringify } from '../../../agent/services/agent-execution-snapshot.service';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { PostgresRootWorkStore } from './postgres-root-work.store';
import { RootBackgroundJobStore } from './root-background-job.store';
import { RootBackgroundEventStore } from './root-background-event.store';
import { updateWorkerPermit } from './root-worker-permits';
import { producerEvidence } from '../../root-work/root-producer-evidence';
import { newStopRequestId, RootNativeState } from '../../root-work/root-work.types';
import type { RegisterExecutionInput } from '../../root-work/root-work.store';

describeIntegration('background job owner/fence admission', () => {
  const database = makeTestDb();
  const work = new PostgresRootWorkStore(database.db, { setContext: jest.fn() } as any);
  const jobs = new RootBackgroundJobStore(database.db);
  const authorization = { authorizeBackgroundExecution: jest.fn().mockResolvedValue({}) };
  const events = new RootBackgroundEventStore(database.db, authorization as any);
  async function claimedNative(...args: Parameters<RootBackgroundJobStore['claim']>) {
    const job = await jobs.claim(...args);
    if (!job) return null;
    const nativeOwner = 'fixture-native';
    await database.db.update(rootBackgroundJobs).set({ nativeOwner, nativeOwnerFence: job.fence })
      .where(eq(rootBackgroundJobs.executionId, job.executionId));
    return { ...job, nativeOwner, nativeOwnerFence: job.fence };
  }
  const id = () => randomBytes(12).toString('hex');
  const digest = 'a'.repeat(64);
  let conversationIds: string[];

  beforeAll(async () => {
    // Migration is permitted only on the explicitly isolated test database.
    const client = await database.pool.connect();
    try {
      const result = await client.query('select current_database() as name');
      if (result.rows[0].name !== process.env.POSTGRES_TEST_DB || result.rows[0].name === process.env.POSTGRES_DB) {
        throw new Error('Refusing background test migration outside isolated database');
      }
      await client.query('BEGIN');
      await client.query(readFileSync(resolve(process.cwd(), 'drizzle/0044_root_background_jobs.sql'), 'utf8'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  });
  beforeEach(() => { conversationIds = []; authorization.authorizeBackgroundExecution.mockReset().mockResolvedValue({}); });
  afterEach(async () => {
    for (const conversationId of conversationIds) await database.db.delete(conversations).where(eq(conversations.id, conversationId));
  });
  afterAll(async () => { await database.close(); });

  async function fixture(actorId = id()) {
    const conversationId = id(); conversationIds.push(conversationId);
    const parentId = id();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: actorId });
    const state: RootNativeState = { actorId, sessionId: 'root-session', invocationId: null, pendingInputs: [],
      rootContext: { max_child_executions_per_work_group: 5, max_parallel_workers: 1, background_enabled: true,
        max_work_group_duration_seconds: 60,
        max_outstanding_background_jobs: 2, background_task_timeout_seconds: 60, background_max_attempts: 3 },
      scope: { role: 'root', executionId: parentId, parentExecutionId: null, workGroupId: null, depth: 0, attempt: 1,
        conversationEpoch: 0, expectedFence: null, resumeIntent: 'start', immutableSnapshotRef: 'snapshot',
        nativeInvocationId: null, nativeSessionId: 'root-session', deadlineEpochMs: Date.now() + 60000 } };
    await work.registerExecution({ executionId: parentId, conversationId, rootAgentId: null, workGroupId: null,
      parentExecutionId: null, role: 'root', depth: 0, attempt: 1, conversationEpoch: 0, nativeState: state });
    const childInput = (): RegisterExecutionInput => {
      const childId = id();
      return { executionId: childId, conversationId, rootAgentId: null, workGroupId: null,
        parentExecutionId: parentId, role: 'library_worker', depth: 1, attempt: 1, conversationEpoch: 0,
        nativeState: { ...state, rootContext: { delegate_request_digest: digest, selected_agent_id: actorId, source_workspace_ids: [] },
          scope: { ...state.scope, role: 'library_worker', executionId: childId, parentExecutionId: parentId, depth: 1 } } };
    };
    const child = async () => {
      const input = childInput(); await work.registerExecution(input); return input.executionId;
    };
    return { conversationId, parentId, state, actorId, child, childInput };
  }

  it('rolls back execution admission when outstanding capacity rejects the job', async () => {
    const root = await fixture();
    await jobs.admit(root.childInput(), digest); await jobs.admit(root.childInput(), digest);
    const rejected = root.childInput();
    await expect(jobs.admit(rejected, digest)).rejects.toThrow('outstanding allowance');
    expect(await work.getExecution(rejected.executionId)).toBeNull();
    expect(await jobs.getJob(rejected.executionId)).toBeNull();
    const children = await database.db.select().from(rootExecutions)
      .where(eq(rootExecutions.parentExecutionId, root.parentId));
    expect(children).toHaveLength(2);
  });

  it('admits concurrent identical requests once and rejects conflicting frozen requests', async () => {
    const root = await fixture(); const input = root.childInput();
    const outcomes = await Promise.all([jobs.admit(input, digest), jobs.admit(input, digest)]);
    expect(outcomes[0].executionId).toBe(outcomes[1].executionId);
    expect((await work.getExecution(input.executionId))?.resultPayload?.nativeState?.backgroundJobId).toBe(input.executionId);
    const changed = { ...input, nativeState: { ...input.nativeState!, rootContext: {
      ...input.nativeState!.rootContext, delegate_request_digest: 'b'.repeat(64) } } };
    await expect(jobs.admit(changed, 'b'.repeat(64))).rejects.toThrow('frozen request');
    await expect(jobs.admit({ ...input, nativeState: { ...input.nativeState!, admittedRequest: {
      nativeCallId: 'other-call', nativeCallBranch: 'delegate_to_agent@other-call', task: 'changed',
    } } }, digest)).rejects.toThrow('frozen request');
    expect((await jobs.getJob(input.executionId))?.requestDigest).toBe(digest);
  });

  it('does not admit a child behind Stop or a terminal foreground parent', async () => {
    const root = await fixture(); const input = root.childInput();
    await work.completeExecution(root.parentId, 'completed', null);
    await expect(jobs.admit(input, digest)).rejects.toThrow('active root');
    expect(await work.getExecution(input.executionId)).toBeNull();
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    await expect(jobs.admit(input, digest)).rejects.toThrow('barrier');
    expect(await jobs.getJob(input.executionId)).toBeNull();
  });

  it('enqueues immutably and atomically limits outstanding jobs', async () => {
    const root = await fixture(); const ids = [await root.child(), await root.child(), await root.child()];
    const outcomes = await Promise.allSettled(ids.map((childId) => jobs.enqueue(childId, digest)));
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const winner = ids[outcomes.findIndex((result) => result.status === 'fulfilled')];
    expect((await jobs.enqueue(winner, digest)).executionId).toBe(winner);
    await expect(jobs.enqueue(winner, 'b'.repeat(64))).rejects.toThrow('immutable request');
    expect((await work.getExecution(winner))?.resultPayload?.nativeState?.backgroundJobId).toBe(winner);
  });

  it('publishes sanitized owned components once with immutable replay and durable sequence', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    const event = { eventId: 'tool-completed', kind: 'component' as const, action: 'update' as const,
      component: { id: 'tool', type: 'toolActivity', data: { toolName: 'send', status: 'completed',
        summary: 'Authorization: Bearer private-credential', paramsJson: '{"prompt":"private-prompt"}',
        resultJson: '{"token":"private-result"}', privatePrompt: 'private-prompt', actorId: 'forged-actor' } } };
    const ack = await events.append(grant as any, digest, [event]);
    expect(await events.append(grant as any, digest, [event])).toEqual(ack);
    const replay = await events.replay(root.conversationId, root.actorId, 0, '0');
    expect(authorization.authorizeBackgroundExecution).toHaveBeenCalledWith(root.conversationId, childId, root.actorId);
    authorization.authorizeBackgroundExecution.mockRejectedValueOnce(new Error('source access revoked'));
    await expect(events.replay(root.conversationId, root.actorId, 0, '0')).rejects.toThrow('source access revoked');
    expect(replay).toHaveLength(1); expect(replay[0].sequence).toBe(ack[0].sequence);
    const encoded = JSON.stringify(replay);
    expect(encoded).not.toContain('private-credential'); expect(encoded).not.toContain('private-prompt');
    expect(encoded).not.toContain('private-result'); expect(encoded).not.toContain('forged-actor');
    expect(encoded).toContain('[REDACTED]');
    await expect(events.append(grant as any, digest, [{ ...event,
      component: { ...event.component, data: { toolName: 'send', status: 'failed' } } }])).rejects.toThrow('replay conflicts');
    await expect(events.replay(root.conversationId, id(), 0, '0')).rejects.toThrow('authority');
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    await expect(events.append(grant as any, digest, [event])).rejects.toThrow('owner, fence');
  });

  it('stores native hints without releasing ownership and old replay cannot rewind pending inputs', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    await database.db.update(rootBackgroundJobs).set({ nativeInvocationId: 'native-invocation' })
      .where(eq(rootBackgroundJobs.executionId, childId));
    const trace = { execution_id: childId, parent_execution_id: root.parentId, native_session_id: `background_${childId}`,
      native_invocation_id: 'native-invocation', producer_agent_id: root.actorId, producer_role: 'EXECUTION_ROLE_LIBRARY_WORKER',
      lifecycle: 'INVOCATION_LIFECYCLE_STATE_WAITING', pending_inputs: [{ input_id: 'input', function_name: 'adk_request_input',
        response_schema_absent: true, input_version: 1 }] };
    const first = { eventId: 'waiting-hint', kind: 'lifecycle' as const, trace };
    await events.append(grant as any, digest, [first]);
    expect((await work.getExecution(childId))?.status).toBe('running');
    expect((await work.getExecution(childId))?.resultPayload?.nativeState?.pendingInputs).toHaveLength(1);
    expect(await jobs.heartbeat(grant as any, 30)).toBe(true);
    await events.append(grant as any, digest, [{ ...first, eventId: 'cleared-hint', trace: { ...trace, pending_inputs: [] } }]);
    await events.append(grant as any, digest, [first]);
    expect((await work.getExecution(childId))?.resultPayload?.nativeState?.pendingInputs).toEqual([]);
    expect(await events.replay(root.conversationId, root.actorId, 0, '0')).toHaveLength(2);
    const usage = { eventId: 'usage', kind: 'usage' as const, usage: { inputTokens: 10, outputTokens: 5, model: 'model' } };
    const usageAck = await events.append(grant as any, digest, [usage]);
    expect(await events.append(grant as any, digest, [usage])).toEqual(usageAck);
    expect(await events.replay(root.conversationId, root.actorId, 0, usageAck[0].sequence)).toEqual([]);
    expect(await events.replay(root.conversationId, root.actorId, 0, '0')).toHaveLength(3);
  });

  it.each(['completed', 'failed', 'cancelled', 'outcome_unknown'] as const)('loads immutable admitted inputs after foreground ROOT becomes %s without Stop', async (rootStatus) => {
    const root = await fixture();
    const request = { nativeCallId: 'call', nativeCallBranch: 'delegate_to_agent@call',
      agentId: root.actorId, task: 'original task', expectedOutput: '', contextRefs: [] };
    const childId = createHash('sha256').update(`${root.parentId}:${request.nativeCallBranch}`).digest('hex').slice(0, 24);
    const requestDigest = createHash('sha256').update(stableStringify({ agentId: request.agentId,
      task: request.task, expectedOutput: '', contextRefs: [] })).digest('hex');
    await work.registerExecution({ executionId: childId, conversationId: root.conversationId, rootAgentId: null,
      workGroupId: null, parentExecutionId: root.parentId, role: 'library_worker', depth: 1, attempt: 1,
      conversationEpoch: 0, nativeState: { ...root.state, admittedRequest: request,
        rootContext: { selected_agent_id: root.actorId, delegate_request_digest: requestDigest },
        scope: { ...root.state.scope, role: 'library_worker', executionId: childId, parentExecutionId: root.parentId, depth: 1 } } });
    await jobs.enqueue(childId, requestDigest);
    await work.completeExecution(root.parentId, rootStatus, null);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    const owned = await jobs.getOwnedHydration(grant as any);
    expect(owned.request).toEqual(request); expect(owned.parent.status).toBe(rootStatus);
    expect(owned.job.nativeSessionId).toBe(`background_${childId}`);
    await expect(root.child()).rejects.toThrow('parent');
    await expect(jobs.getOwnedHydration({ executionId: childId, owner: 'other', fence: grant.fence }))
      .rejects.toThrow('owner, fence');
    await database.db.update(rootExecutions).set({ resultPayload: { ...owned.child.resultPayload as any,
      nativeState: { ...owned.state, admittedRequest: { ...request, task: 'replacement task' } } } })
      .where(eq(rootExecutions.id, childId));
    await expect(jobs.getOwnedHydration(grant as any)).rejects.toThrow('admitted request changed');
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    await expect(jobs.getOwnedHydration(grant as any)).rejects.toThrow('authority changed');
  });

  it.each(['archive', 'group', 'actor', 'root'] as const)('rejects queued and owned work after %s binding changes', async (change) => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    await database.db.update(conversations).set(change === 'archive' ? { isArchived: true }
      : change === 'group' ? { isGroup: true } : change === 'actor' ? { createdBy: id() } : { rootAgentId: id() })
      .where(eq(conversations.id, root.conversationId));
    expect(await jobs.heartbeat(grant as any, 30)).toBe(false);
    expect(await jobs.markDispatched(grant as any)).toBe(false);
    await expect(work.completeExecution(childId, 'completed', null, [], grant as any))
      .rejects.toThrow('authority changed');
    await expect(jobs.enqueue(childId, digest)).rejects.toThrow('authority');
    await database.db.update(rootBackgroundJobs).set({ leaseUntil: sql`clock_timestamp()-interval '1 second'` })
      .where(eq(rootBackgroundJobs.executionId, childId));
    expect(await claimedNative('new_owner', 30, { global: 2, perUser: 2 })).toBeNull();
    const [job] = await database.db.select().from(rootBackgroundJobs).where(eq(rootBackgroundJobs.executionId, childId));
    expect(job.status).toBe('cancelled'); expect(job.fence).toBe(grant.fence + 1);
  });

  it('claims once across replicas, fences expired owners, and marks recovery instead of a new start', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const claims = await Promise.all([claimedNative('replica_one', 30, { global: 2, perUser: 2 }),
      claimedNative('replica_two', 30, { global: 2, perUser: 2 })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    expect(await jobs.markDispatched(first as any)).toBe(true);
    await database.db.update(rootBackgroundJobs).set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(rootBackgroundJobs.executionId, childId));
    const next = (await claimedNative('successor', 30, { global: 2, perUser: 2 }))!;
    expect(next.fence).toBe(first.fence + 1); expect(next.startedAt).not.toBeNull();
    expect(await jobs.heartbeat(first as any, 30)).toBe(false);
    expect(await jobs.markDispatched(first as any)).toBe(false);
    expect(await jobs.heartbeat(next as any, 30)).toBe(true);
  });

  it('does not let a saturated actor block another actor admission', async () => {
    const first = await fixture(); const pending = await fixture(first.actorId); const other = await fixture();
    const firstId = await first.child(); await jobs.enqueue(firstId, digest);
    expect((await claimedNative('first', 30, { global: 2, perUser: 1 }))?.executionId).toBe(firstId);
    const pendingId = await pending.child(); await jobs.enqueue(pendingId, digest);
    const otherId = await other.child(); await jobs.enqueue(otherId, digest);
    expect((await claimedNative('other', 30, { global: 2, perUser: 1 }))?.executionId).toBe(otherId);
    expect(await claimedNative('third', 30, { global: 2, perUser: 1 })).toBeNull();
  });

  it('fences queued/running jobs with Stop and refuses late heartbeats or dispatch', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    expect(await jobs.heartbeat(grant as any, 30)).toBe(false);
    expect(await jobs.markDispatched(grant as any)).toBe(false);
    const [job] = await database.db.select().from(rootBackgroundJobs).where(eq(rootBackgroundJobs.executionId, childId));
    expect(job.status).toBe('cancelled'); expect(job.owner).toBeNull(); expect(job.fence).toBe(grant.fence + 1);
    expect(await claimedNative('new_owner', 30, { global: 2, perUser: 2 })).toBeNull();
  });
  it('counts background claims reciprocally when a foreground worker requests the final ROOT slot', async () => {
    const root = await fixture(); const backgroundId = await root.child(); const foregroundId = await root.child();
    await jobs.enqueue(backgroundId, digest);
    expect(await claimedNative('background', 30, { global: 2, perUser: 2 })).not.toBeNull();
    expect(await updateWorkerPermit(database.db, root.parentId, foregroundId, 'foreground', 'acquire')).toBe(false);
    await expect(work.completeExecution(backgroundId, 'completed', null)).rejects.toThrow('owned job authority');
  });

  it('settles complete text/evidence/job status atomically only for the current owner and fence', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const first = (await claimedNative('old_owner', 30, { global: 2, perUser: 2 }))!;
    await database.db.update(rootBackgroundJobs).set({ leaseUntil: sql`clock_timestamp()-interval '1 second'` })
      .where(eq(rootBackgroundJobs.executionId, childId));
    const next = (await claimedNative('current_owner', 30, { global: 2, perUser: 2 }))!;
    const child = (await work.getExecution(childId))!;
    const evidence = producerEvidence(child, [{ kind: 'citation', nativeIdentity: 'native-source', outputOrdinal: 0,
      payload: { reference: '1', url: 'https://example.com/source' } }]);
    const result = { executionId: childId, producerAgentId: root.actorId, producerRole: 'library_worker' as const,
      status: 'completed' as const, text: 'summary', fullText: 'full output', citationRefs: [evidence[0].evidenceId], artifactRefs: [], safeError: null };
    await expect(work.completeExecution(childId, 'completed', result, evidence, first as any)).rejects.toThrow('owner, fence');
    expect(await work.listEvidenceForExecution(childId)).toEqual([]);
    expect((await work.getExecution(childId))?.status).toBe('running');
    expect((await work.completeExecution(childId, 'completed', result, evidence, next as any))?.resultPayload?.fullText).toBe('full output');
    expect(await work.listEvidenceForExecution(childId)).toHaveLength(1);
    const [job] = await database.db.select().from(rootBackgroundJobs).where(eq(rootBackgroundJobs.executionId, childId));
    expect(job.status).toBe('completed'); expect(job.owner).toBeNull(); expect(job.leaseUntil).toBeNull();
  });

  it('parks only the committed native mapping and releases ownership without automatic retry', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    await database.db.update(rootBackgroundJobs).set({ nativeInvocationId: 'native-invocation' })
      .where(eq(rootBackgroundJobs.executionId, childId));
    const state = (await work.getExecution(childId))!.resultPayload!.nativeState!;
    const waiting = { ...state, invocationId: 'native-invocation',
      pendingInputs: [{ inputId: 'input', functionName: 'adk_request_input' }] };
    await expect(work.recordNativeState(childId, { ...waiting, invocationId: 'different' }, 'waiting', grant as any))
      .rejects.toThrow('committed invocation');
    expect((await work.recordNativeState(childId, waiting, 'waiting', grant as any))?.status).toBe('waiting');
    const [job] = await database.db.select().from(rootBackgroundJobs).where(eq(rootBackgroundJobs.executionId, childId));
    expect(job.status).toBe('waiting'); expect(job.owner).toBeNull();
    expect(await claimedNative('other', 30, { global: 2, perUser: 2 })).toBeNull();
  });

  it('durably queues only current human confirmation and replay does not queue another turn', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    await database.db.update(rootBackgroundJobs).set({ nativeInvocationId: 'native-invocation', attempts: 3 })
      .where(eq(rootBackgroundJobs.executionId, childId));
    const state = (await work.getExecution(childId))!.resultPayload!.nativeState!;
    await work.recordNativeState(childId, { ...state, invocationId: 'native-invocation', pendingInputs: [
      { inputId: 'approve', inputVersion: 2, functionName: 'adk_request_confirmation' }] }, 'waiting', grant as any);
    const response = [{ inputId: 'approve', inputVersion: 2, response: { confirmed: false } }];
    await expect(jobs.queueInputs(root.conversationId, childId, id(), response)).rejects.toThrow('authority');
    await expect(jobs.queueInputs(root.conversationId, childId, root.actorId,
      [{ ...response[0], inputVersion: 1 }])).rejects.toThrow('stale');
    expect(await jobs.queueInputs(root.conversationId, childId, root.actorId, response)).toEqual({ executionId: childId, status: 'queued' });
    const [queued] = await database.db.select().from(rootBackgroundJobs).where(eq(rootBackgroundJobs.executionId, childId));
    expect(queued.attempts).toBe(0); expect(queued.nativeOwner).toBeNull();
    expect(queued.pendingInputResponses?.[0].response).toEqual({ confirmed: false });
    expect(queued.nativeInvocationId).toBe('native-invocation');
    const next = (await claimedNative('new-owner', 30, { global: 2, perUser: 2 }))!;
    expect(next.fence).toBeGreaterThan(grant.fence);
    expect((await jobs.queueInputs(root.conversationId, childId, root.actorId, response)).status).toBe('running');
    expect((await jobs.getJob(childId))!.fence).toBe(next.fence);
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    await expect(jobs.queueInputs(root.conversationId, childId, root.actorId, response)).rejects.toThrow('authority');
  });

  it('rolls back a running native-state write that crosses lease expiry and rejects standalone evidence', async () => {
    const root = await fixture(); const childId = await root.child(); await jobs.enqueue(childId, digest);
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    await database.db.update(rootBackgroundJobs).set({ nativeInvocationId: 'committed-invocation' })
      .where(eq(rootBackgroundJobs.executionId, childId));
    const state = (await work.getExecution(childId))!.resultPayload!.nativeState!;
    const name = `delay_${childId}`;
    // Isolated database only; delay this fixture's UPDATE after the initial owner check.
    await database.pool.query(`CREATE FUNCTION conversation.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = '${childId}' THEN PERFORM pg_sleep(1.5); END IF; RETURN NEW; END $$`);
    await database.pool.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON conversation.root_executions
      FOR EACH ROW EXECUTE FUNCTION conversation.${name}()`);
    try {
      await database.db.update(rootBackgroundJobs).set({ leaseUntil: sql`clock_timestamp()+interval '1 second'` })
        .where(eq(rootBackgroundJobs.executionId, childId));
      await expect(work.recordNativeState(childId, { ...state, invocationId: 'committed-invocation' }, 'running', grant as any))
        .rejects.toThrow('expired before native state commit');
      expect((await work.getExecution(childId))!.resultPayload!.nativeState!.invocationId).toBeNull();
      await database.db.update(rootBackgroundJobs).set({ leaseUntil: sql`clock_timestamp()+interval '1 second'` })
        .where(eq(rootBackgroundJobs.executionId, childId));
      await expect(events.append(grant as any, digest, [{ eventId: 'late-component', kind: 'component', action: 'add',
        component: { id: 'progress', type: 'agentActivity', data: { summary: 'progress', status: 'running' } } }]))
        .rejects.toThrow('event lease expired before commit');
      expect(await events.replay(root.conversationId, root.actorId, 0, '0')).toEqual([]);
      await expect(work.registerEvidence({ evidenceId: id(), executionId: childId, conversationId: root.conversationId,
        producerAgentId: root.actorId, kind: 'citation', payload: {}, dedupKey: id() }))
        .rejects.toThrow('atomic owned settlement');
      expect(await work.listEvidenceForExecution(childId)).toEqual([]);
    } finally {
      await database.pool.query(`DROP TRIGGER ${name} ON conversation.root_executions`);
      await database.pool.query(`DROP FUNCTION conversation.${name}()`);
    }
  });
});
