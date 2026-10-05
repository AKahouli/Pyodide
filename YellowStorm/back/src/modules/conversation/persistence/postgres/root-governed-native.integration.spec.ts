import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, conversationExecutions, messages, rootBackgroundJobs, rootBackgroundEvents, rootExecutions } from '../../../postgres/schema';
import { PostgresRootWorkStore } from './postgres-root-work.store';
import { RootFollowupStore } from './root-followup.store';
import { newStopRequestId, type RootNativeState } from '../../root-work/root-work.types';
import { producerEvidence } from '../../root-work/root-producer-evidence';
import type { RegisterEvidenceInput } from '../../root-work/root-work.store';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RootDelegateInternalController } from '../../controllers/root-delegate-internal.controller';
import { RootFollowupService } from '../../root-work/root-followup.service';
import { RootBackgroundLifecycleService } from '../../root-work/root-background-lifecycle.service';
import { RootBackgroundSubmissionService } from '../../root-work/root-background-submission.service';
import { RootDelegateDefinitionService } from '../../root-work/root-delegate-definition.service';
import { RootTemporaryDefinitionService } from '../../root-work/root-temporary-definition.service';
import { RootFanoutService } from '../../root-work/root-fanout.service';
import { RootBackgroundEventStore } from './root-background-event.store';
import { RootBackgroundJobStore } from './root-background-job.store';
import { RootBackgroundDriverService } from '../../root-work/root-background-driver.service';
import { startNativeQualificationHost } from '../../../postgres/testing/native-qualification-host';
import { governedNativeFixture } from '../../../postgres/testing/governed-native-fixture';
import { RootResultService } from '../../root-work/root-result.service';
import * as grpc from '@grpc/grpc-js';
import { RootInputController } from '../../controllers/root-input.controller';
import { RootInputService } from '../../root-work/root-input.service';
import { RootBackgroundInputService } from '../../root-work/root-background-input.service';
import { CONVERSATION_STORE } from '../conversation-store';
import { ProjectShareService } from '../../../project/project-share.service';
import { RootWorkPublicController } from '../../controllers/root-work-public.controller';
import { RootWorkPublicService } from '../../root-work/root-work-public.service';

describeIntegration('real governed Root native qualification', () => {
  const database = makeTestDb();
  const work = new PostgresRootWorkStore(database.db, { setContext: jest.fn() } as never);
  const followups = new RootFollowupStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  let conversationId: string, actorId: string, rootId: string, childId: string;
  let state: RootNativeState;
  let governedFixture: Awaited<ReturnType<typeof governedNativeFixture>> | undefined;
  beforeEach(async () => {
    conversationId = id(); actorId = id(); rootId = id(); childId = id();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: actorId });
    state = { actorId, sessionId: 'root', invocationId: null, pendingInputs: [], hasBackgroundJobs: true,
      rootContext: { max_child_executions_per_work_group: 2, max_parallel_workers: 1 },
      scope: { executionId: rootId, role: 'root', depth: 0, parentExecutionId: null, workGroupId: null,
        conversationEpoch: 0, attempt: 1, expectedFence: null, resumeIntent: 'start',
        immutableSnapshotRef: 'pinned', nativeInvocationId: null, nativeSessionId: 'root', deadlineEpochMs: null } };
    await work.registerExecution({ executionId: rootId, conversationId, rootAgentId: null, workGroupId: null,
      parentExecutionId: null, role: 'root', depth: 0, attempt: 1, conversationEpoch: 0, nativeState: state });
    await work.registerExecution({ executionId: childId, conversationId, rootAgentId: null, workGroupId: null,
      parentExecutionId: rootId, role: 'library_worker', depth: 1, attempt: 1, conversationEpoch: 0,
      nativeState: { ...state, hasBackgroundJobs: undefined,
        rootContext: { ...state.rootContext, selected_agent_id: actorId },
        scope: { ...state.scope, executionId: childId, parentExecutionId: rootId, role: 'library_worker', depth: 1 } } });
  });
  afterEach(async () => {
    await database.db.delete(conversations).where(eq(conversations.id, conversationId));
    await governedFixture?.close(); governedFixture = undefined;
  });
  afterAll(async () => { await database.close(); });

  (process.env.VECTOR_REAL_MODEL_QUALIFY === '1' ? it : it.skip)(
    'executes governed library and fanout workers before one sealed publication', async () => {
    // The disposable profile compiler is a fixture seam; governance, worker execution and result authorization are real.
    const governed = governedFixture = await governedNativeFixture(database.db, conversationId, actorId);
    await database.db.update(rootExecutions).set({ rootAgentId: actorId }).where(eq(rootExecutions.conversationId, conversationId));
    state.scope.immutableSnapshotRef = governed.digest;
    state.rootContext.governance_revision = governed.revisionId;
    state.rootContext.root_agent_id = actorId;
    state.rootContext.delegate_definition_mode = 'lazy';
    state.rootContext.background_enabled = true;
    state.rootContext.max_outstanding_background_jobs = 2;
    state.rootContext.background_task_timeout_seconds = 180;
    state.rootContext.background_max_attempts = 1;
    state.rootContext.fanout_enabled = true;
    state.rootContext.background_fanout_enabled = true;
    state.rootContext.max_fanout_items = 2;
    state.rootContext.max_child_executions_per_work_group = 3;
    state.rootContext.max_work_group_duration_seconds = 240;
    state.rootContext.catalog = [{ agent_id: governed.workerId, snapshot_digest: governed.workerDigest, configuration_mode: 'native' }];
    state.scope.deadlineEpochMs = Date.now() + 240000;
    state.capabilityCeiling = { toolDigests: [], skillDigests: [], connectors: [], workspaceIds: [governed.workspaceId] };
    await work.recordNativeState(rootId, state, 'running');
    await database.db.delete(rootExecutions).where(eq(rootExecutions.id, childId));
    const conversationsFixture = { getConversationDocument: governed.getConversationDocument };
    const results = new RootResultService(conversationsFixture as never, work as never, governed.resolver);
    const profiles = { buildGrpcAgentsForPlaybook: async (_actor: string, agentIds: string[]) => agentIds.map((agentId) => ({
      id: agentId, name: agentId === actorId ? 'QualificationSynthesis' : 'QualificationWorker',
      description: 'Synthetic qualification', prompt: 'Return VECTORNATIVENEST exactly. Do not use tools or citations.',
      tools: [], brain_context: [], skills: [], save_memory: false, chatbot: { model: 'gpt-6-luna' },
    })) };
    const jobs = new RootBackgroundJobStore(database.db);
    const definitions = new RootDelegateDefinitionService(work as never, conversationsFixture as never,
      governed.resolver, profiles as never, {} as never, {} as never, jobs);
    const fanout = new RootFanoutService(database.db, work as never, conversationsFixture as never,
      governed.resolver, {} as never);
    const service = new RootFollowupService(followups, work as never, results as never,
    { getConversationDocument: governed.getConversationDocument } as never, governed.resolver,
    profiles as never);
    const lifecycle = new RootBackgroundLifecycleService(jobs, new RootBackgroundEventStore(database.db, results as never),
      definitions, {} as never, results as never, work as never, fanout, service);
    const token = id();
    const waitFixture = process.env.VECTOR_NATIVE_WAIT_QUALIFY === '1';
    const module = await Test.createTestingModule({ controllers: [RootDelegateInternalController, RootInputController, RootWorkPublicController], providers: [
      { provide: RootWorkPublicService, useValue: new RootWorkPublicService(conversationsFixture as never, work as never,
        jobs, new RootBackgroundEventStore(database.db, results), results,
        { getActiveStreamSnapshot: () => null } as never, {} as never, { get: () => true } as never) },
      { provide: CONVERSATION_STORE, useValue: { findActiveAccessById: async (requestedId: string) => {
        const [row] = await database.db.select().from(conversations).where(eq(conversations.id, requestedId));
        return row ? { ...row, memberIds: [], invitedEmails: [] } : null;
      } } },
      { provide: ProjectShareService, useValue: { hasAccess: async () => false } },
      { provide: RootInputService, useValue: new RootInputService(conversationsFixture as never, work as never,
        jobs, results, { get: () => true } as never) },
      { provide: RootBackgroundInputService, useValue: new RootBackgroundInputService(jobs, results) },
      { provide: ConfigService, useValue: { get: () => token } },
      { provide: RootBackgroundLifecycleService, useValue: lifecycle },
      { provide: RootDelegateDefinitionService, useValue: definitions },
      { provide: RootFanoutService, useValue: fanout },
      ...[RootTemporaryDefinitionService, RootBackgroundSubmissionService]
        .map((provide) => ({ provide, useValue: {} })),
    ] }).compile();
    const app = module.createNestApplication({ logger: false });
    // Test authentication seam; public ownership guard and DTO validation remain real.
    app.use((request: { headers: Record<string, string>; user?: unknown }, _response: unknown, next: () => void) => {
      request.user = { _id: request.headers['x-qualification-actor'] ?? '', email: 'qualification@example.invalid' };
      next();
    });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    let native: Awaited<ReturnType<typeof startNativeQualificationHost>> | undefined;
    let driver: RootBackgroundDriverService | undefined;
    try {
      await app.listen(0, '127.0.0.1');
      native = await startNativeQualificationHost(`${await app.getUrl()}/api/v1`, token, true, waitFixture);
      const transport = native;
      const readiness = () => new Promise<boolean>((resolveReady, reject) => {
        transport.client.GetRootWorkCapabilities({}, transport.metadata, async (error: Error | null,
          response: { background_ready: boolean; background_followup_ready: boolean; control_database_fingerprint: string }) => {
          if (error) { reject(error); return; }
          try { resolveReady(response.background_ready && response.background_followup_ready
            && response.control_database_fingerprint === await jobs.controlInstance()); } catch (failure) { reject(failure); }
        });
      });
      expect(await readiness()).toBe(true);
      expect((await governed.resolver.resolveForActor(actorId, actorId, conversationId, governed.revisionId))
        .rootSnapshotDigest).toBe(governed.digest);
      await governed.resolver.assertWorkspaces(conversationId, actorId, [governed.workspaceId]);
      await governed.bindings.update(governed.binding.id, { enabled: false });
      await expect(governed.resolver.assertWorkspaces(conversationId, actorId, [governed.workspaceId]))
        .rejects.toThrow('source access changed');
      await governed.bindings.update(governed.binding.id, { enabled: true });
      const configuration = { get: (name: string, fallback: unknown) => name === 'grpcSecurity.apiKey' ? transport.key
        : name === 'conversation.rootBackgroundEnabled' ? true : name.startsWith('conversation.rootBackgroundMax') ? 1 : fallback };
      driver = new RootBackgroundDriverService(jobs, { rootBackgroundReady: readiness,
        getChatbotClient: () => transport.client } as never, configuration as ConfigService, service);
      const submissions = new RootBackgroundSubmissionService(work as never, jobs, driver, governed.resolver,
        definitions, {} as never, results, fanout);
      const submitted = await submissions.submit(rootId, { workerKind: 'specialist', agentId: governed.workerId,
        nativeCallId: 'qualification_leaf', nativeCallBranch: 'delegate_to_agent@qualification_leaf',
        task: 'Return VECTORNATIVENEST exactly.', expectedOutput: 'VECTORNATIVENEST', contextRefs: [] });
      childId = submitted.executionId;
      driver.onModuleInit();
      const workerDeadline = Date.now() + 90000;
      while (Date.now() < workerDeadline) {
        const worker = await work.getExecution(childId);
        if (worker?.terminalAt) break;
        await new Promise((done) => setTimeout(done, 500));
      }
      const worker = (await work.getExecution(childId))!;
      expect(worker.status).toBe('completed');
      expect(worker.resultPayload).toMatchObject({ producerAgentId: governed.workerId, producerRole: 'library_worker' });
      expect(worker.resultPayload?.fullText ?? worker.resultPayload?.text).toContain('VECTORNATIVENEST');
      expect((await jobs.getJob(childId))?.nativeInvocationId).toBeTruthy();
      const batch = await submissions.submitFanout(rootId, { version: 1, mode: 'background',
        nativeCallId: 'qualification_batch', nativeCallBranch: 'run_fanout@qualification_batch',
        target: { kind: 'library', agentId: governed.workerId },
        items: [{ key: 'first', task: 'Return VECTORNATIVENEST exactly.' },
          { key: 'second', task: 'Return VECTORNATIVENEST exactly.' }] });
      const batchDeadline = Date.now() + 90000;
      let resumedInvocation: string | undefined;
      if (waitFixture) {
        while (Date.now() < batchDeadline && (await jobs.getJob(batch.executionId))?.status !== 'waiting') {
          await new Promise((done) => setTimeout(done, 500));
        }
        expect((await jobs.getJob(batch.executionId))?.status).toBe('waiting');
        resumedInvocation = (await jobs.getJob(batch.executionId))!.nativeInvocationId!;
        const endpoint = `${await app.getUrl()}/api/v1/conversations/${conversationId}/root-inputs`;
        const headers = { 'x-qualification-actor': actorId, 'content-type': 'application/json' };
        const pending = await fetch(endpoint, { headers });
        expect(pending.status).toBe(200);
        const rows = await pending.json() as { executionId: string; inputs: { inputId: string; inputVersion: number }[] }[];
        const input = rows.find((row) => row.executionId === batch.executionId)!.inputs[0];
        const submit = (actor: string, inputId: string, inputVersion: number) => fetch(`${endpoint}/background/${batch.executionId}`,
          { method: 'POST', headers: { ...headers, 'x-qualification-actor': actor },
            body: JSON.stringify({ inputResponses: [{ inputId, inputVersion, response: { allow: false } }] }) });
        expect((await submit(id(), input.inputId, input.inputVersion)).status).toBe(403);
        expect((await submit(actorId, 'wrong-input', input.inputVersion)).status).toBe(400);
        expect((await submit(actorId, input.inputId, input.inputVersion + 1)).status).toBe(400);
        if (process.env.VECTOR_NATIVE_WAIT_STOP_QUALIFY === '1') {
          const stop = await fetch(`${await app.getUrl()}/api/v1/conversations/${conversationId}/root-work/stop`,
            { method: 'POST', headers, body: JSON.stringify({ stopRequestId: newStopRequestId(), expectedEpoch: 0 }) });
          expect(stop.status).toBe(201);
          expect(await stop.json()).toMatchObject({ applied: true, barrierEpoch: 1 });
          expect((await submit(actorId, input.inputId, input.inputVersion)).status).toBe(404);
          expect((await jobs.getJob(batch.executionId))!.status).toBe('cancelled');
          expect(await database.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(0);
          const nextRootId = id();
          const nextState = { ...state, scope: { ...state.scope, executionId: nextRootId, conversationEpoch: 1,
            deadlineEpochMs: Date.now() + 120000 } };
          await work.registerExecution({ executionId: nextRootId, conversationId, rootAgentId: actorId, workGroupId: null,
            parentExecutionId: null, role: 'root', depth: 0, attempt: 1, conversationEpoch: 1, nativeState: nextState });
          const next = await submissions.submit(nextRootId, { workerKind: 'specialist', agentId: governed.workerId,
            nativeCallId: 'after_stop', nativeCallBranch: 'delegate_to_agent@after_stop',
            task: 'Return VECTORNATIVENEST exactly.', expectedOutput: 'VECTORNATIVENEST', contextRefs: [] });
          const nextDeadline = Date.now() + 90000;
          while (Date.now() < nextDeadline && !(await work.getExecution(next.executionId))?.terminalAt) {
            await new Promise((done) => setTimeout(done, 500));
          }
          expect(await work.getExecution(next.executionId)).toMatchObject({ status: 'completed', conversationEpoch: 1 });
          expect(await database.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(0);
          await driver.onModuleDestroy();
          const slots = await database.db.execute(sql`SELECT count(*)::int AS count FROM conversation.root_model_slots WHERE status <> 'free'`);
          expect(slots.rows[0].count).toBe(0);
          return;
        }
        expect((await submit(actorId, input.inputId, input.inputVersion)).status).toBe(201);
        expect((await jobs.getJob(batch.executionId))!.pendingInputResponses?.[0].response).toEqual({ allow: false });
      }
      while (Date.now() < batchDeadline) {
        if ((await work.getExecution(batch.executionId))?.terminalAt) break;
        await new Promise((done) => setTimeout(done, 500));
      }
      const batchStatus = (await work.getExecution(batch.executionId))?.status;
      if (batchStatus !== 'completed') throw new Error(JSON.stringify({ batchStatus,
        hasNativeInvocation: Boolean((await jobs.getJob(batch.executionId))?.nativeInvocationId),
        diagnostics: transport.diagnostics }));
      expect((await jobs.getJob(batch.executionId))?.nativeInvocationId).toBeTruthy();
      if (waitFixture) expect((await jobs.getJob(batch.executionId))?.nativeInvocationId).toBe(resumedInvocation);
      const manifest = (await work.getExecution(rootId))!.resultPayload!.nativeState!.fanoutManifests![0];
      for (const item of manifest.items) {
        expect(await work.getExecution(item.executionId)).toMatchObject({ status: 'completed', parentExecutionId: rootId,
          resultPayload: { producerAgentId: governed.workerId, producerRole: 'library_worker' } });
      }
      if (waitFixture) expect(transport.diagnostics.filter((value) =>
        (value as { kind?: string }).kind === 'fixture_compile')).toHaveLength(1);
      const completedRoot = await work.completeExecution(rootId, 'completed', null);
      const sealed = completedRoot!.resultPayload!.nativeState!.schedulingSeal!;
      const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
      const deadline = Date.now() + 90000;
      let published: typeof messages.$inferSelect[] = [];
      while (Date.now() < deadline) {
        published = await database.db.select().from(messages).where(eq(messages.conversationId, conversationId));
        if (published.length) break;
        await new Promise((done) => setTimeout(done, 500));
      }
      const diagnosticJob = await jobs.getJob(reserved.id);
      if (published.length !== 1) throw new Error(JSON.stringify({ publications: published.length,
        status: diagnosticJob?.status, hasNativeInvocation: Boolean(diagnosticJob?.nativeInvocationId),
        diagnostics: transport.diagnostics }));
      expect(JSON.stringify(published[0])).toContain('VECTORNATIVENEST');
      const job = (await jobs.getJob(reserved.id))!;
      expect(job.nativeInvocationId).toBeTruthy(); expect(job.initialInputEventId).toBeTruthy();
      expect(await database.db.select().from(rootBackgroundEvents)
        .where(eq(rootBackgroundEvents.executionId, reserved.id))).not.toHaveLength(0);
      await service.reconcile();
      expect(await database.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(1);
      await driver.onModuleDestroy();
      await governed.bindings.update(governed.binding.id, { enabled: false });
      await expect(results.authorizeBackgroundExecution(conversationId, reserved.id, actorId))
        .rejects.toThrow('source access is unavailable');
      await governed.bindings.update(governed.binding.id, { enabled: true });
      await expect(results.authorizeBackgroundExecution(conversationId, reserved.id, actorId))
        .resolves.toMatchObject({ id: reserved.id });
      const occupied = await database.db.execute(sql`SELECT count(*)::int AS count FROM conversation.root_model_slots WHERE status <> 'free'`);
      expect(occupied.rows[0].count).toBe(0);
    } finally {
      await driver?.onModuleDestroy();
      await native?.close();
      await app.close();
    }
  }, 330000);
  it('rehearses disabling flags and rejects native dispatch before ownership', async () => {
    const native = await startNativeQualificationHost('http://127.0.0.1:9/api/v1', id(), false);
    try {
      const capability = await new Promise<unknown>((done, reject) => native.client.GetRootWorkCapabilities({}, native.metadata,
        (error: Error | null, value: unknown) => error ? reject(error) : done(value)));
      expect(capability).toMatchObject({ background_ready: false, background_fanout_ready: false,
        background_followup_ready: false, background_protocol_version: 1 });
      const code = await new Promise<number>((done, reject) => {
        const call = native.client.RunBackgroundInvocation({ protocol_version: 1, execution_id: id(),
          conversation_id: conversationId, actor_id: id(), conversation_epoch: 0, owner: 'rollback', fence: 1,
          request_digest: '0'.repeat(64), control_database_fingerprint: 'disabled' }, native.metadata);
        const timeout = setTimeout(() => { call.cancel(); reject(new Error('Disabled dispatch did not reject')); }, 5000);
        call.on('error', (error: grpc.ServiceError) => { clearTimeout(timeout); done(error.code); });
      });
      expect(code).toBe(grpc.status.FAILED_PRECONDITION);
    } finally { await native.close(); }
  }, 90000);
});
