import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { conversations, rootBackgroundJobs, rootEvidenceRecords, rootExecutions } from '../../../postgres/schema';
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
    if (!job.owner) throw new Error('Fixture claim has no owner');
    const nativeOwner = 'fixture-native';
    await database.db.update(rootBackgroundJobs).set({ nativeOwner, nativeOwnerFence: job.fence })
      .where(eq(rootBackgroundJobs.executionId, job.executionId));
    return { ...job, owner: job.owner, nativeOwner, nativeOwnerFence: job.fence };
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

  async function fixture(actorId = id(), fanout = false) {
    const conversationId = id(); conversationIds.push(conversationId);
    const parentId = id();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: actorId });
    const state: RootNativeState = { actorId, sessionId: 'root-session', invocationId: null, pendingInputs: [],
      capabilityCeiling: { workspaceIds: [], toolDigests: [], skillDigests: [], connectors: [] },
      rootContext: { max_child_executions_per_work_group: 5, max_parallel_workers: 1, background_enabled: true,
        max_work_group_duration_seconds: 60, fanout_enabled: fanout, background_fanout_enabled: fanout,
        temporary_workers_enabled: fanout, max_temporary_workers: 2,
        max_fanout_items: 3, catalog: [{ agent_id: actorId, snapshot_digest: 'worker-snapshot', configuration_mode: 'native' }],
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

  const fanoutProposal = (actorId: string, call = 'fanout') => ({ version: 1, mode: 'background',
    nativeCallId: call, nativeCallBranch: `run_fanout@${call}`, target: { kind: 'library', agentId: actorId },
    items: [{ key: 'first', task: 'First' }, { key: 'second', task: 'Second' }] });

  it('atomically admits one coordinator and reserves original ROOT item identities on concurrent replay', async () => {
    const root = await fixture(id(), true); const proposal = fanoutProposal(root.actorId);
    const jobsCreated = await Promise.all([jobs.admitFanout(root.parentId, proposal), jobs.admitFanout(root.parentId, proposal)]);
    expect(jobsCreated[0].executionId).toBe(jobsCreated[1].executionId);
    const parent = (await work.getExecution(root.parentId))!;
    const manifests = parent.resultPayload!.nativeState!.fanoutManifests!;
    expect(manifests).toHaveLength(1);
    const coordinator = (await work.getExecution(jobsCreated[0].executionId))!;
    expect(coordinator).toMatchObject({ role: 'fanout_driver', depth: 0, parentExecutionId: root.parentId });
    expect(coordinator.resultPayload!.nativeState!.backgroundFanout)
      .toEqual({ manifestId: manifests[0].manifestId, digest: manifests[0].digest });
    for (const item of manifests[0].items) {
      await expect(work.registerExecution({ ...root.childInput(), executionId: item.executionId,
        nativeState: { ...root.state, rootContext: { delegate_request_digest: item.requestDigest,
          selected_agent_id: root.actorId }, scope: { ...root.state.scope, role: 'library_worker', depth: 1,
          executionId: item.executionId, parentExecutionId: root.parentId } } })).rejects.toThrow('coordinator ownership');
    }
    expect(await work.getExecution(manifests[0].items[0].executionId)).toBeNull();
    await expect(jobs.admitFanout(root.parentId, { ...proposal,
      items: [{ key: 'first', task: 'Changed' }, proposal.items[1]] })).rejects.toThrow('immutable manifest');
  });

  it('accepts aggregate coordinator lifecycle and rejects a leaf trace at the actual durable event boundary', async () => {
    const root = await fixture(id(), true);
    await database.db.update(rootExecutions).set({ rootAgentId: root.actorId }).where(eq(rootExecutions.id, root.parentId));
    await database.db.update(conversations).set({ rootAgentId: root.actorId }).where(eq(conversations.id, root.conversationId));
    await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const grant = (await claimedNative('control', 30, { global: 1, perUser: 1 }))!;
    await database.db.update(rootBackgroundJobs).set({ nativeInvocationId: 'native-control' })
      .where(eq(rootBackgroundJobs.executionId, grant.executionId));
    const trace = { execution_id: grant.executionId, parent_execution_id: root.parentId, conversation_epoch: 0,
      native_session_id: grant.nativeSessionId, native_invocation_id: 'native-control', producer_agent_id: root.actorId,
      producer_role: 'EXECUTION_ROLE_FANOUT_DRIVER', lifecycle: 'INVOCATION_LIFECYCLE_STATE_STARTED', pending_inputs: [] };
    const accepted = await events.append(grant, grant.requestDigest, [{ eventId: 'control-start', kind: 'lifecycle', trace }]);
    expect(accepted).toHaveLength(1);
    await expect(events.append(grant, grant.requestDigest, [{ eventId: 'leaf-start', kind: 'lifecycle',
      trace: { ...trace, execution_id: 'a'.repeat(24), producer_role: 'EXECUTION_ROLE_LIBRARY_WORKER' } }])).rejects.toThrow('Invalid owned');
    expect((await jobs.getJob(grant.executionId))?.status).toBe('running');
  });

  it('rolls back coordinator and reservations when the outstanding job bound rejects admission', async () => {
    const root = await fixture(id(), true);
    await jobs.admit(root.childInput(), digest); await jobs.admit(root.childInput(), digest);
    await expect(jobs.admitFanout(root.parentId, fanoutProposal(root.actorId))).rejects.toThrow('outstanding allowance');
    expect((await work.getExecution(root.parentId))?.resultPayload?.nativeState?.fanoutManifests).toBeUndefined();
    const children = await database.db.select().from(rootExecutions).where(eq(rootExecutions.parentExecutionId, root.parentId));
    expect(children).toHaveLength(2); expect(children.every((row) => row.role === 'library_worker')).toBe(true);
  });

  it('rejects disabled background fan-out, foreground proposals and admissions behind Stop', async () => {
    const disabled = await fixture();
    await expect(jobs.admitFanout(disabled.parentId, fanoutProposal(disabled.actorId))).rejects.toThrow('enabled active ROOT');
    const root = await fixture(id(), true);
    await expect(jobs.admitFanout(root.parentId, { ...fanoutProposal(root.actorId), mode: 'foreground' }))
      .rejects.toThrow('coordinator ROOT');
    expect((await work.getExecution(root.parentId))?.resultPayload?.nativeState?.fanoutManifests).toBeUndefined();
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    await expect(jobs.admitFanout(root.parentId, fanoutProposal(root.actorId))).rejects.toThrow('active ROOT');
  });

  it('claims a coordinator under occupied compute capacity and leaves model permits available', async () => {
    const root = await fixture(id(), true);
    const coordinator = await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const leaf = await jobs.admit(root.childInput(), digest);
    const foreground = await root.child();
    expect(await updateWorkerPermit(database.db, root.parentId, foreground, 'foreground', 'acquire')).toBe(true);
    const control = await claimedNative('control', 30, { global: 1, perUser: 1 });
    expect(control?.executionId).toBe(coordinator.executionId);
    expect(await updateWorkerPermit(database.db, root.parentId, foreground, 'foreground', 'release')).toBe(true);
    expect(await updateWorkerPermit(database.db, root.parentId, foreground, 'foreground', 'acquire')).toBe(true);
    expect(await updateWorkerPermit(database.db, root.parentId, foreground, 'foreground', 'release')).toBe(true);
    expect((await claimedNative('leaf', 30, { global: 1, perUser: 1 }))?.executionId).toBe(leaf.executionId);
    expect(await updateWorkerPermit(database.db, root.parentId, foreground, 'foreground', 'acquire')).toBe(false);
  });

  it('keeps bounded coordinator ownership separate from global and per-user compute claims', async () => {
    const actor = id(); const first = await fixture(actor, true);
    await jobs.admitFanout(first.parentId, fanoutProposal(actor));
    expect(await claimedNative('control-one', 30, { global: 1, perUser: 1 })).not.toBeNull();
    const second = await fixture(actor, true);
    const queuedControl = await jobs.admitFanout(second.parentId, fanoutProposal(actor));
    const leafRoot = await fixture(actor); const leaf = await jobs.admit(leafRoot.childInput(), digest);
    expect((await claimedNative('compute', 30, { global: 1, perUser: 1 }))?.executionId).toBe(leaf.executionId);
    expect((await jobs.getJob(queuedControl.executionId))?.status).toBe('queued');
    await work.stopRootWork({ conversationId: first.conversationId, stopRequestId: newStopRequestId() });
    expect((await claimedNative('control-two', 30, { global: 1, perUser: 1 }))?.executionId).toBe(queuedControl.executionId);
  });

  it('claims admitted coordinators after foreground failure but fences forged manifest membership', async () => {
    const root = await fixture(id(), true); const coordinator = await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    await work.completeExecution(root.parentId, 'failed', null);
    expect((await claimedNative('control', 30, { global: 1, perUser: 1 }))?.executionId).toBe(coordinator.executionId);
    const forgedRoot = await fixture(id(), true);
    const forged = await jobs.admitFanout(forgedRoot.parentId, fanoutProposal(forgedRoot.actorId));
    await database.db.execute(sql`UPDATE conversation.root_executions
      SET result_payload=jsonb_set(result_payload, '{nativeState,backgroundFanout,digest}', '"forged"'::jsonb)
      WHERE id=${forged.executionId}`);
    expect(await jobs.claim('forged', 30, { global: 2, perUser: 2 })).toBeNull();
    expect((await jobs.getJob(forged.executionId))?.status).toBe('cancelled');
  });

  it('hydrates only stored manifest items under the current coordinator owner after foreground completion', async () => {
    const root = await fixture(id(), true);
    await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const grant = (await claimedNative('control', 30, { global: 1, perUser: 1 }))!;
    await work.completeExecution(root.parentId, 'completed', null);
    const owned = await jobs.getOwnedFanout(grant);
    const first = owned.manifest.items[0];
    const hydrated = await jobs.getOwnedFanoutItem(grant, first.executionId);
    expect(hydrated.role).toBe('library_worker');
    expect(hydrated.request).toEqual({ agentId: root.actorId, nativeCallId: first.nativeRunId,
      nativeCallBranch: first.nativeCallBranch, task: first.task, expectedOutput: '', contextRefs: [] });
    expect(hydrated.parent.id).toBe(root.parentId);
    expect(await work.getExecution(first.executionId)).toBeNull();
    await expect(jobs.getOwnedFanoutItem(grant, id())).rejects.toThrow('outside the owned');
    await expect(jobs.getOwnedFanout({ ...grant, owner: 'other' })).rejects.toThrow('owner, fence');
    await expect(jobs.getOwnedFanout({ ...grant, nativeOwner: 'other-native' })).rejects.toThrow('native owner');
    await database.db.update(rootBackgroundJobs).set({ fence: grant.fence + 1 })
      .where(eq(rootBackgroundJobs.executionId, grant.executionId));
    await expect(jobs.getOwnedFanoutItem(grant, first.executionId)).rejects.toThrow('owner, fence');
  });

  it.each(['task', 'branch'])('rejects a persisted manifest with changed %s despite an unchanged stored digest', async (changed) => {
    const root = await fixture(id(), true); await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const grant = (await claimedNative('control', 30, { global: 1, perUser: 1 }))!;
    const field = changed === 'task' ? 'task' : 'nativeCallBranch';
    await database.db.execute(sql`UPDATE conversation.root_executions SET result_payload=jsonb_set(result_payload,
      ${`{nativeState,fanoutManifests,0,items,0,${field}}`}::text[], '"changed"'::jsonb) WHERE id=${root.parentId}`);
    await expect(jobs.getOwnedFanout(grant)).rejects.toThrow('manifest changed');
  });

  it.each(['running', 'completed'] as const)('materializes only the bound reserved producer with foreground %s and blocks generic writes', async (foregroundStatus) => {
    const root = await fixture(id(), true); await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const grant = (await claimedNative('control', 30, { global: 1, perUser: 1 }))!;
    const manifest = (await jobs.getOwnedFanout(grant)).manifest;
    const item = manifest.items[0]; const owned = await jobs.getOwnedFanoutItem(grant, item.executionId);
    const input = { ...root.childInput(), executionId: item.executionId, nativeState: { ...root.state,
      admittedRequest: owned.request, rootContext: { delegate_request_digest: item.requestDigest, selected_agent_id: root.actorId },
      scope: { ...root.state.scope, executionId: item.executionId, parentExecutionId: root.parentId,
        role: 'library_worker' as const, depth: 1, immutableSnapshotRef: 'worker-snapshot' } } };
    const producerGrant = { ...grant, producerExecutionId: item.executionId };
    if (foregroundStatus === 'completed') await work.completeExecution(root.parentId, 'completed', null);
    const [first, replay] = await Promise.all([jobs.registerOwnedFanoutItem(producerGrant, input),
      jobs.registerOwnedFanoutItem(producerGrant, input)]);
    expect(first.id).toBe(replay.id); expect(first.parentExecutionId).toBe(root.parentId);
    expect(first.resultPayload!.nativeState).toMatchObject({ sessionId: grant.nativeSessionId,
      backgroundFanoutItem: { coordinatorExecutionId: grant.executionId, manifestId: manifest.manifestId, digest: manifest.digest },
      scope: { executionId: item.executionId, parentExecutionId: root.parentId, depth: 1, expectedFence: String(grant.fence) } });
    await expect(updateWorkerPermit(database.db, root.parentId, item.executionId, 'unowned', 'acquire'))
      .rejects.toThrow('coordinator ownership');
    expect(await updateWorkerPermit(database.db, root.parentId, item.executionId, 'native-permit', 'acquire', producerGrant)).toBe(true);
    expect(await updateWorkerPermit(database.db, root.parentId, item.executionId, 'other', 'release')).toBe(false);
    expect(await updateWorkerPermit(database.db, root.parentId, item.executionId, 'native-permit', 'release')).toBe(true);
    await expect(jobs.registerOwnedFanoutItem({ ...producerGrant, producerExecutionId: manifest.items[1].executionId }, input))
      .rejects.toThrow('producer binding');
    await expect(jobs.registerOwnedFanoutItem({ ...producerGrant, nativeOwner: undefined }, input)).rejects.toThrow('immutable binding');
    await expect(jobs.registerOwnedFanoutItem(producerGrant, { ...input, nativeState: { ...input.nativeState,
      admittedRequest: { ...owned.request, task: 'Changed' } } })).rejects.toThrow('owned reservation');
    await expect(work.registerExecution(input)).rejects.toThrow(foregroundStatus === 'completed' ? 'active root' : 'coordinator ownership');
    await expect(jobs.enqueue(item.executionId, item.requestDigest)).rejects.toThrow('independent background job');
    await expect(work.completeExecution(item.executionId, 'completed', null)).rejects.toThrow('coordinator ownership');
    await expect(work.recordNativeState(item.executionId, first.resultPayload!.nativeState!, 'waiting'))
      .rejects.toThrow('coordinator ownership');
    const [evidence] = producerEvidence(first, [{ kind: 'artifact', nativeIdentity: 'tool', outputOrdinal: 0,
      payload: { workspaceId: 'workspace', path: 'output.txt' } }]);
    await expect(work.registerEvidence(evidence)).rejects.toThrow('owned settlement');
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    await expect(jobs.registerOwnedFanoutItem(producerGrant, input)).rejects.toThrow('barrier');
  });

  it('parks and settles a bound item with evidence without releasing coordinator ownership', async () => {
    const root = await fixture(id(), true); await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const grant = (await claimedNative('control', 30, { global: 1, perUser: 1 }))!;
    await database.db.update(rootBackgroundJobs).set({ nativeInvocationId: 'coordinator-invocation' })
      .where(eq(rootBackgroundJobs.executionId, grant.executionId));
    const owned = await jobs.getOwnedFanout(grant); const item = owned.manifest.items[0];
    const bound = await jobs.getOwnedFanoutItem(grant, item.executionId);
    const producerGrant = { ...grant, producerExecutionId: item.executionId };
    const child = await jobs.registerOwnedFanoutItem(producerGrant, { ...root.childInput(), executionId: item.executionId,
      nativeState: { ...root.state, admittedRequest: bound.request,
        rootContext: { delegate_request_digest: item.requestDigest, selected_agent_id: root.actorId },
        scope: { ...root.state.scope, executionId: item.executionId, parentExecutionId: root.parentId,
          role: 'library_worker', depth: 1, immutableSnapshotRef: 'worker-snapshot' } } });
    const state = child.resultPayload!.nativeState!;
    await expect(work.recordNativeState(item.executionId, { ...state, scope: { ...state.scope,
      executionId: owned.manifest.items[1].executionId } }, 'waiting', producerGrant)).rejects.toThrow('producer binding changed');
    expect((await work.getExecution(item.executionId))?.status).toBe('running');
    expect((await work.recordNativeState(item.executionId, state, 'waiting', producerGrant))?.status).toBe('waiting');
    expect((await jobs.getJob(grant.executionId))?.status).toBe('running');
    const [evidence] = producerEvidence(child, [{ kind: 'artifact', nativeIdentity: 'tool', outputOrdinal: 0,
      payload: { workspaceId: 'workspace', path: 'output.txt' } }]);
    await expect(work.completeExecution(item.executionId, 'completed', null, [evidence],
      { ...producerGrant, producerExecutionId: owned.manifest.items[1].executionId })).rejects.toThrow('coordinator ownership');
    const completed = await work.completeExecution(item.executionId, 'completed', { ...child.resultPayload!,
      status: 'completed', text: 'Bound worker output', fullText: 'Complete bound worker output',
      artifactRefs: [evidence.evidenceId] }, [evidence], producerGrant);
    expect(completed?.resultPayload?.artifactRefs).toEqual([evidence.evidenceId]);
    expect(completed?.resultPayload?.fullText).toBe('Complete bound worker output');
    expect((await database.db.select().from(rootEvidenceRecords).where(eq(rootEvidenceRecords.executionId, item.executionId))))
      .toHaveLength(1);
    const control = await jobs.getJob(grant.executionId);
    expect(control).toMatchObject({ status: 'running', owner: grant.owner, fence: grant.fence, nativeOwner: grant.nativeOwner });
    expect(await jobs.heartbeat(grant, 30)).toBe(true);
  });

  it('materializes temporary reservations once without creating extra jobs or replenishing lifetime allowances', async () => {
    const root = await fixture(id(), true);
    await jobs.admitFanout(root.parentId, { ...fanoutProposal(root.actorId), target: { kind: 'temporary' } });
    const grant = (await claimedNative('control', 30, { global: 1, perUser: 1 }))!;
    const owned = await jobs.getOwnedFanout(grant);
    await work.completeExecution(root.parentId, 'completed', null);
    for (const item of owned.manifest.items) {
      const bound = await jobs.getOwnedFanoutItem(grant, item.executionId);
      const registration: RegisterExecutionInput = { ...root.childInput(), role: 'temporary_worker', executionId: item.executionId,
        nativeState: { ...root.state, admittedRequest: bound.request,
          rootContext: { delegate_request_digest: item.requestDigest, selected_agent_id: item.executionId },
          scope: { ...root.state.scope, role: 'temporary_worker', depth: 1, parentExecutionId: root.parentId, executionId: item.executionId } } };
      const producer = { ...grant, producerExecutionId: item.executionId };
      const child = await jobs.registerOwnedFanoutItem(producer, registration);
      await work.completeExecution(item.executionId, 'completed', null, [], producer);
      expect((await jobs.registerOwnedFanoutItem(producer, registration)).id).toBe(child.id);
      expect(await jobs.getJob(item.executionId)).toBeNull();
    }
    const children = await database.db.select().from(rootExecutions).where(eq(rootExecutions.parentExecutionId, root.parentId));
    expect(children.filter((row) => row.role === 'temporary_worker')).toHaveLength(2);
    expect((await jobs.getJob(grant.executionId))?.status).toBe('running');
  });

  it('rolls back item output and evidence if the coordinator lease expires during settlement', async () => {
    const root = await fixture(id(), true); await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const grant = (await claimedNative('control', 30, { global: 1, perUser: 1 }))!;
    const item = (await jobs.getOwnedFanout(grant)).manifest.items[0];
    const bound = await jobs.getOwnedFanoutItem(grant, item.executionId);
    const producer = { ...grant, producerExecutionId: item.executionId };
    const child = await jobs.registerOwnedFanoutItem(producer, { ...root.childInput(), executionId: item.executionId,
      nativeState: { ...root.state, admittedRequest: bound.request,
        rootContext: { delegate_request_digest: item.requestDigest, selected_agent_id: root.actorId },
        scope: { ...root.state.scope, executionId: item.executionId, parentExecutionId: root.parentId,
          role: 'library_worker', depth: 1, immutableSnapshotRef: 'worker-snapshot' } } });
    const [evidence] = producerEvidence(child, [{ kind: 'artifact', nativeIdentity: 'tool', outputOrdinal: 0,
      payload: { path: 'output.txt' } }]);
    const name = `delay_item_${item.executionId}`;
    await database.pool.query(`CREATE FUNCTION conversation.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id = '${item.executionId}' THEN PERFORM pg_sleep(4); END IF; RETURN NEW; END $$`);
    await database.pool.query(`CREATE TRIGGER ${name} BEFORE UPDATE ON conversation.root_executions
      FOR EACH ROW EXECUTE FUNCTION conversation.${name}()`);
    try {
      await database.db.update(rootBackgroundJobs).set({ leaseUntil: sql`clock_timestamp()+interval '3 seconds'` })
        .where(eq(rootBackgroundJobs.executionId, grant.executionId));
      await expect(work.completeExecution(item.executionId, 'completed', { ...child.resultPayload!,
        status: 'completed', fullText: 'Must roll back', artifactRefs: [evidence.evidenceId] }, [evidence], producer))
        .rejects.toThrow('owner, fence');
      expect((await work.getExecution(item.executionId))?.status).toBe('running');
      expect(await work.listEvidenceForExecution(item.executionId)).toEqual([]);
    } finally {
      await database.pool.query(`DROP TRIGGER ${name} ON conversation.root_executions`);
      await database.pool.query(`DROP FUNCTION conversation.${name}()`);
    }
  });

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

  it('resumes only the sealed waiting fanout coordinator with typed input and current epoch', async () => {
    const root = await fixture(id(), true);
    const job = await jobs.admitFanout(root.parentId, fanoutProposal(root.actorId));
    const grant = (await claimedNative('owner', 30, { global: 2, perUser: 2 }))!;
    await database.db.update(rootBackgroundJobs).set({ nativeInvocationId: 'fanout-invocation' })
      .where(eq(rootBackgroundJobs.executionId, job.executionId));
    const state = (await work.getExecution(job.executionId))!.resultPayload!.nativeState!;
    await work.recordNativeState(job.executionId, { ...state, invocationId: 'fanout-invocation', pendingInputs: [
      { inputId: 'approve', inputVersion: 2, functionName: 'adk_request_confirmation' }] }, 'waiting', grant as any);
    const response = [{ inputId: 'approve', inputVersion: 2, response: { confirmed: false } }];
    await expect(jobs.queueInputs(root.conversationId, job.executionId, id(), response)).rejects.toThrow('authority');
    await expect(jobs.queueInputs(root.conversationId, job.executionId, root.actorId,
      [{ ...response[0], inputVersion: 1 }])).rejects.toThrow('stale');
    expect(await jobs.queueInputs(root.conversationId, job.executionId, root.actorId, response))
      .toEqual({ executionId: job.executionId, status: 'queued' });
    expect((await jobs.getJob(job.executionId))!.pendingInputResponses?.[0].response).toEqual({ confirmed: false });
    const resumed = (await claimedNative('resumed', 30, { global: 2, perUser: 2 }))!;
    expect(resumed.nativeInvocationId).toBe('fanout-invocation');
    expect(resumed.fence).toBeGreaterThan(grant.fence);
    await work.stopRootWork({ conversationId: root.conversationId, stopRequestId: newStopRequestId() });
    await expect(jobs.queueInputs(root.conversationId, job.executionId, root.actorId, response)).rejects.toThrow('authority');
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
