import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { agents, catalogAgentTypes, conversations, conversationExecutions, messages, rootBackgroundJobs, rootBackgroundEvents, rootExecutions } from '../../../postgres/schema';
import { PostgresRootWorkStore } from './postgres-root-work.store';
import { RootFollowupStore } from './root-followup.store';
import { newStopRequestId, type RootNativeState } from '../../root-work/root-work.types';
import { producerEvidence } from '../../root-work/root-producer-evidence';
import type { RegisterEvidenceInput } from '../../root-work/root-work.store';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpJwtService } from '@modules/connector/services/mcp-jwt.service';
import { RootDelegateInternalController } from '../../controllers/root-delegate-internal.controller';
import { RootFollowupService } from '../../root-work/root-followup.service';
import { RootWorkService } from '../../root-work/root-work.service';
import { RootConversationReplyService } from '../../root-work/root-conversation-reply.service';
import { RootBackgroundLifecycleService } from '../../root-work/root-background-lifecycle.service';
import { RootBackgroundSubmissionService } from '../../root-work/root-background-submission.service';
import { RootDelegateDefinitionService } from '../../root-work/root-delegate-definition.service';
import { RootTemporaryDefinitionService } from '../../root-work/root-temporary-definition.service';
import { RootFanoutService } from '../../root-work/root-fanout.service';
import { ConversationArtifactService } from '../../services/conversation-artifact.service';
import { RootBackgroundEventStore } from './root-background-event.store';
import { RootBackgroundJobStore } from './root-background-job.store';
import { RootBackgroundDriverService } from '../../root-work/root-background-driver.service';
import { evidenceManifest } from '../../root-work/root-evidence-manifest';
import { startNativeQualificationHost } from '../../../postgres/testing/native-qualification-host';

jest.mock('../../../logger/logger.service', () => ({ ...jest.requireActual('../../../logger/logger.service'), logDomainEvent: jest.fn() }));

describeIntegration('sealed synthesis writer and atomic publication', () => {
  const database = makeTestDb();
  const work = new PostgresRootWorkStore(database.db, { setContext: jest.fn() } as never);
  const followups = new RootFollowupStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  // Real execution-authority boundary fixture: a dedicated RSA signer over the
  // live root-work/job stores, as production ADK calls are authenticated.
  const machine = 'root-followup-store-machine-credential-000001';
  const authorityValues: Record<string, unknown> = { NODE_ENV: 'production',
    MCP_JWT_ISSUER: 'followup-store-test', ADK_ROOT_RUNTIME_SERVICE_TOKEN: machine };
  const authorityConfig = { get: (name: string, fallback?: unknown) => authorityValues[name] ?? fallback } as ConfigService;
  const authorityConversations = { findById: jest.fn() }, authorityMessages = { findById: jest.fn() };
  const authorityUsers = { findById: jest.fn() };
  let authorityDirectory: string, signer: McpJwtService, realWork: RootWorkService;
  let jobs: RootBackgroundJobStore;
  let conversationId: string, actorId: string, rootId: string, childId: string;
  let state: RootNativeState;
  beforeAll(async () => {
    authorityDirectory = mkdtempSync(join(tmpdir(), 'ws01-followup-'));
    const keyPath = join(authorityDirectory, 'ephemeral.pem');
    writeFileSync(keyPath, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      .export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    authorityValues.MCP_JWT_PRIVATE_KEY_FILE = keyPath;
    signer = new McpJwtService(authorityConfig, authorityUsers as never, {} as never, {} as never);
    jobs = new RootBackgroundJobStore(database.db);
    realWork = new RootWorkService(work as never, signer, authorityConversations as never,
      authorityMessages as never, authorityUsers as never, jobs);
  });
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
    authorityConversations.findById.mockResolvedValue({ id: conversationId, createdBy: actorId,
      isGroup: false, isArchived: false, rootWorkEpoch: 0, rootAgentId: actorId, members: [] });
    authorityUsers.findById.mockResolvedValue({ id: actorId, status: 'active' });
  });
  afterEach(async () => {
    await database.db.delete(conversations).where(eq(conversations.id, conversationId));
    await database.db.delete(agents).where(eq(agents.id, actorId));
    await database.db.delete(catalogAgentTypes).where(eq(catalogAgentTypes.id, actorId));
  });
  afterAll(async () => {
    await database.close();
    if (authorityDirectory) rmSync(authorityDirectory, { recursive: true, force: true });
  });

  async function seal(childStatus: 'completed' | 'failed' | 'outcome_unknown' = 'completed', evidence: RegisterEvidenceInput[] = []) {
    await work.completeExecution(childId, childStatus, { executionId: childId, producerAgentId: actorId,
      producerRole: 'library_worker', status: childStatus, text: childStatus === 'completed' ? 'Child result' : null,
      citationRefs: evidence.filter((item) => item.kind === 'citation').map((item) => item.evidenceId),
      artifactRefs: evidence.filter((item) => item.kind === 'artifact').map((item) => item.evidenceId),
      safeError: childStatus === 'completed' ? null : 'Could not confirm' }, evidence);
    const root = await work.completeExecution(rootId, 'completed', null);
    return root!.resultPayload!.nativeState!.schedulingSeal!;
  }
  async function nativeClaim(executionId: string) {
    const owner = 'fixture', nativeOwner = 'native';
    await database.db.update(rootBackgroundJobs).set({ status: 'running', owner, nativeOwner,
      nativeOwnerFence: 1, fence: 1, leaseUntil: new Date(Date.now() + 60000) })
      .where(eq(rootBackgroundJobs.executionId, executionId));
    return { executionId, owner, nativeOwner, fence: 1 };
  }
  async function nativeComplete(executionId: string, fullText = 'Synthesis') {
    const grant = await nativeClaim(executionId);
    return work.completeExecution(executionId, 'completed', { executionId, producerAgentId: actorId,
      producerRole: 'followup', status: 'completed', text: fullText, fullText,
      citationRefs: [], artifactRefs: [], safeError: null }, [], grant);
  }

  async function legacyWriter(execution: typeof rootExecutions.$inferSelect) {
    const nativeState = (execution.resultPayload as any).nativeState;
    await database.db.insert(conversationExecutions).values({ id: execution.id, conversationId, userId: actorId,
      messageId: nativeState.followup.publicationMessageId, ownerReplicaId: 'root-followup',
      expiresAt: new Date(Date.now() + 60000) });
  }


  it('releases an old synthesis reservation and reuses it for one publication after a user turn', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const manifest = JSON.parse((reserved.resultPayload as any).nativeState.admittedRequest.task);
    expect(manifest.itemCounts).toMatchObject({ requested: 1, completed: 1, cancelled: 0 });
    expect(manifest.results).toEqual(expect.arrayContaining([expect.objectContaining({ executionId: childId, role: 'library_worker' })]));
    await legacyWriter(reserved);
    await followups.releaseLegacyWriters();
    const foregroundId = id();
    await database.db.insert(conversationExecutions).values({ id: foregroundId, conversationId, userId: actorId,
      messageId: id(), expiresAt: new Date(Date.now() + 60000) });
    await nativeComplete(reserved.id);
    expect(await followups.publish(reserved.id, actorId, sealed.digest)).toBeNull();
    const [foreground] = await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.id, foregroundId));
    expect(foreground.status).toBe('running');
    await database.db.update(conversationExecutions).set({ status: 'completed' }).where(eq(conversationExecutions.id, foregroundId));
    const publication = (await followups.publish(reserved.id, actorId, sealed.digest))!;
    expect(publication.isComplete).toBe(true);
    expect((await followups.publish(reserved.id, actorId, sealed.digest))!.id).toBe(publication.id);
  });

  it('uses the frozen Root request model when synthesis usage has no model metadata', async () => {
    state.requestProfile = { modelId: 'frozen-root-model', content: 'Give a comparison table with direct links' } as any;
    state.clarifications = [{ invocationId: 'invocation', inputId: 'origin', inputVersion: 1,
      question: 'Departure city?', response: { city: 'Paris', budget: 800 }, responseDigest: 'accepted-digest' }];
    await work.recordNativeState(rootId, state, 'running');
    await work.recordNativeState(rootId, { ...state, clarifications: undefined }, 'running');
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const packet = JSON.parse((reserved.resultPayload as any).nativeState.admittedRequest.task);
    expect(packet.originalRequest).toBe('Give a comparison table with direct links');
    expect(packet.originalRequestTruncated).toBe(false);
    expect(packet.clarifications).toEqual([{ inputId: 'origin', inputVersion: 1,
      question: 'Departure city?', response: { city: 'Paris', budget: 800 } }]);
    await nativeComplete(reserved.id);
    const publication = (await followups.publish(reserved.id, actorId, sealed.digest))!;
    expect(publication.modelId).toBe('frozen-root-model');
  });

  it('stages 101 producer identities idempotently and preserves all aliases through atomic settlement and synthesis paging', async () => {
    const child = (await work.getExecution(childId))!;
    const records = Array.from({ length: 101 }, (_, index) => producerEvidence(child, [{ kind: 'citation',
      nativeIdentity: `call-${index}`, outputOrdinal: 0,
      payload: { type: 'web', reference: String(index + 1), source: `https://official.test/page/${index}` },
    }])[0]);
    await work.stageEvidence(childId, records.slice(0, 100));
    await work.stageEvidence(childId, records.slice(0, 100));
    expect((await work.listEvidenceForExecution(childId))).toHaveLength(100);
    await expect(work.stageEvidence(childId, [{ ...records[0], payload: { title: 'changed' } }])).rejects.toThrow('replay conflicts');
    await expect(work.stageEvidence(childId, [{ ...records[100], executionId: rootId }])).rejects.toThrow('binding');
    const manifest = evidenceManifest(records);
    const result = { executionId: childId, producerAgentId: actorId, producerRole: 'library_worker' as const,
      status: 'completed' as const, text: 'Sources [1] and [101]', citationRefs: records.map((item) => item.evidenceId), artifactRefs: [], safeError: null };
    await expect(work.completeExecution(childId, 'completed', result, [], undefined, manifest)).rejects.toThrow('incomplete');
    expect((await work.getExecution(childId))!.status).toBe('running');
    await work.stageEvidence(childId, records.slice(100));
    await expect(work.completeExecution(childId, 'completed', { ...result, citationRefs: [records[0].evidenceId] }, [], undefined, manifest))
      .rejects.toThrow('references changed');
    await work.completeExecution(childId, 'completed', result, [], undefined, manifest);
    const root = (await work.completeExecution(rootId, 'completed', null))!;
    const sealed = root.resultPayload!.nativeState!.schedulingSeal!;
    const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const packet = JSON.parse((reserved.resultPayload as { nativeState: RootNativeState }).nativeState.admittedRequest!.task);
    expect(packet.evidence).toHaveLength(100); expect(packet.evidenceTruncated).toBe(true);
    const grant = await nativeClaim(reserved.id);
    const page = await followups.readResult(grant, childId, 0);
    expect(page.evidence).toHaveLength(101);
    expect(new Set(page.evidence.map((item) => item.evidenceId))).toEqual(new Set(records.map((item) => item.evidenceId)));
    expect(page.evidence.some((item) => item.nativeReference === '101')).toBe(true);
    await expect(work.stageEvidence(childId, records.slice(0, 1))).rejects.toThrow('binding');
  });

  it('cancels a legacy followup reservation without leaving the Conversation writer occupied', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    await legacyWriter(reserved);
    const jobs = new RootBackgroundJobStore(database.db);
    expect(await jobs.cancel(conversationId, actorId, reserved.id, 0)).toMatchObject({ status: 'cancelled' });
    const [writer] = await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.id, reserved.id));
    expect(writer.status).toBe('cancelled');
    await database.db.insert(conversationExecutions).values({ id: id(), conversationId, userId: actorId,
      messageId: id(), expiresAt: new Date(Date.now() + 60000) });
    expect(await followups.publish(reserved.id, actorId, sealed.digest)).toBeNull();
  });

  it('does not synthesize fast child completion before the scheduling seal or an unknown child outcome', async () => {
    expect(await followups.reserve(rootId, actorId, 'missing')).toBeNull();
    const sealed = await seal('outcome_unknown');
    expect(await followups.reserve(rootId, actorId, sealed.digest)).toBeNull();
  });
  it('reserves one synthesis job across replicas without occupying the Conversation writer', async () => {
    const sealed = await seal('failed');
    const rows = await Promise.all([followups.reserve(rootId, actorId, sealed.digest),
      new RootFollowupStore(database.db).reserve(rootId, actorId, sealed.digest)]);
    expect(rows[0]!.id).toBe(rows[1]!.id);
    const writer = await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.conversationId, conversationId));
    expect(writer).toHaveLength(0);
    expect(await database.db.select().from(rootBackgroundJobs).where(eq(rootBackgroundJobs.conversationId, conversationId))).toHaveLength(1);
    expect(await database.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(0);
  });
  it('synthesizes alongside a user turn and defers publication until that turn finishes', async () => {
    const sealed = await seal(); const messageId = id();
    await database.db.insert(messages).values({ id: messageId, conversationId, senderId: actorId,
      conversationType: 'ai', isStreaming: true, isComplete: false });
    const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    expect(reserved).not.toBeNull();
    await nativeComplete(reserved.id);
    expect(await followups.publish(reserved.id, actorId, sealed.digest)).toBeNull();
    await database.db.update(messages).set({ isComplete: true, isStreaming: false }).where(eq(messages.id, messageId));
    expect(await followups.publish(reserved.id, actorId, sealed.digest)).not.toBeNull();
  });
  it('lets a foreground writer run while synthesis prepares and publishes once after it releases', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const foregroundId = id();
    await database.db.insert(conversationExecutions).values({ id: foregroundId, conversationId, userId: actorId,
      messageId: id(), expiresAt: new Date(Date.now() + 60000) });
    const grant = await nativeClaim(reserved.id);
    expect(await followups.readResult(grant, childId, 0)).toMatchObject({ text: 'Child result' });
    await nativeComplete(reserved.id);
    expect(await followups.publish(reserved.id, actorId, sealed.digest)).toBeNull();
    await database.db.update(conversationExecutions).set({ status: 'completed' }).where(eq(conversationExecutions.id, foregroundId));
    const publication = (await followups.publish(reserved.id, actorId, sealed.digest))!;
    expect(publication.isComplete).toBe(true);
    expect((await followups.publish(reserved.id, actorId, sealed.digest))!.id).toBe(publication.id);
  });

  it('recovers native completion before publication and atomically publishes one message and one outbox event', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    expect(await nativeComplete(reserved.id)).not.toBeNull();
    const replicas = [new RootFollowupStore(database.db), new RootFollowupStore(database.db)];
    const published = await Promise.all(replicas.map((store) => store.publish(reserved.id, actorId, sealed.digest)));
    expect(published[0]!.id).toBe(published[1]!.id);
    expect(await database.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(1);
    expect(await database.db.select().from(rootBackgroundEvents).where(eq(rootBackgroundEvents.executionId, reserved.id))).toHaveLength(1);
    const [conversation] = await database.db.select().from(conversations).where(eq(conversations.id, conversationId));
    expect(conversation.messageCount).toBe(1);
  });
  it('publishes the Root identity and actual synthesis model, ignoring sibling usage', async () => {
    await database.db.insert(catalogAgentTypes).values({ id: actorId, name: actorId, slug: actorId });
    await database.db.insert(agents).values({ id: actorId, name: 'Pinned Root', role: 'Assistant',
      agentTypeId: actorId, createdBy: actorId });
    await database.db.update(conversations).set({ rootAgentId: actorId }).where(eq(conversations.id, conversationId));
    await database.db.update(rootExecutions).set({ rootAgentId: actorId }).where(eq(rootExecutions.id, rootId));
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    await nativeComplete(reserved.id);
    await database.db.insert(rootBackgroundJobs).values({ executionId: childId, parentExecutionId: rootId,
      conversationId, actorId, conversationEpoch: 0, requestDigest: 'b'.repeat(64), status: 'completed',
      maxAttempts: 1, deadline: new Date(Date.now() + 60000), nativeSessionId: `fixture_${childId}` });
    for (const [executionId, model] of [[reserved.id, 'actual-synthesis-model'], [childId, 'worker-model']]) {
      await database.db.insert(rootBackgroundEvents).values({ executionId, conversationId, actorId,
        conversationEpoch: 0, eventId: id(), payloadDigest: 'a'.repeat(64),
        payload: { kind: 'usage', usage: { model, inputTokens: 1, outputTokens: 2 } } });
    }
    const published = (await followups.publish(reserved.id, actorId, sealed.digest))!;
    expect(published.agentIds).toEqual([actorId]);
    expect(published.modelId).toBe('actual-synthesis-model');
    expect(published.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agentActivity', data: expect.objectContaining({ actorId, actorName: 'Pinned Root' }) }),
      expect.objectContaining({ type: 'text', data: expect.objectContaining({ actorId }) }),
    ]));
  });
  it('marks canonical long results as previews and exposes every remaining page', async () => {
    const fullText = 'a'.repeat(8000) + 'b'.repeat(8000) + 'FINAL CONCLUSION';
    await work.completeExecution(childId, 'completed', { executionId: childId, producerAgentId: actorId,
      producerRole: 'library_worker', status: 'completed', text: fullText.slice(0, 8000), fullText,
      citationRefs: [], artifactRefs: [], safeError: null });
    const root = await work.completeExecution(rootId, 'completed', null);
    const sealed = root!.resultPayload!.nativeState!.schedulingSeal!;
    const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const packet = JSON.parse((reserved.resultPayload as any).nativeState.admittedRequest.task);
    expect(packet.results[0]).toMatchObject({ text: 'a'.repeat(8000), textTruncated: true, nextOffset: 8000 });
    const grant = await nativeClaim(reserved.id);
    expect(await followups.readResult(grant, childId, 8000)).toMatchObject({ text: 'b'.repeat(8000), nextOffset: 16000 });
    expect(await followups.readResult(grant, childId, 16000)).toMatchObject({ text: 'FINAL CONCLUSION', nextOffset: null });
  });
  it('retains original sibling evidence IDs while assigning deterministic display aliases and no private locations', async () => {
    const secondId = id();
    await work.registerExecution({ executionId: secondId, conversationId, rootAgentId: null, workGroupId: null,
      parentExecutionId: rootId, role: 'library_worker', depth: 1, attempt: 1, conversationEpoch: 0,
      nativeState: { ...state, hasBackgroundJobs: undefined, rootContext: { selected_agent_id: actorId },
        scope: { ...state.scope, executionId: secondId, parentExecutionId: rootId, role: 'library_worker', depth: 1 } } });
    const capture = async (producerId: string, filename: string) => producerEvidence((await work.getExecution(producerId))!,
      [{ kind: 'citation', nativeIdentity: 'same-native-call', outputOrdinal: 0,
        payload: { reference: '1', filename, url: 'https://source.test/path?token=SUPPLIED_CREDENTIAL' } },
      { kind: 'artifact', nativeIdentity: 'same-native-artifact', outputOrdinal: 0,
        payload: { artifact_id: 'shared-native-id', filename } }]);
    const firstEvidence = await capture(childId, 'first.pdf');
    const secondEvidence = await capture(secondId, 'second.pdf');
    await work.completeExecution(secondId, 'completed', { executionId: secondId, producerAgentId: actorId,
      producerRole: 'library_worker', status: 'completed', text: 'Second [1]',
      citationRefs: secondEvidence.filter((item) => item.kind === 'citation').map((item) => item.evidenceId),
      artifactRefs: secondEvidence.filter((item) => item.kind === 'artifact').map((item) => item.evidenceId), safeError: null }, secondEvidence);
    const sealed = await seal('completed', firstEvidence);
    const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const packet = JSON.parse((reserved.resultPayload as any).nativeState.admittedRequest.task);
    const mappings = packet.evidence.filter((item: any) => item.displayReference);
    expect(mappings.map((item: any) => item.displayReference).sort()).toEqual(['1', '2']);
    expect(mappings.every((item: any) => item.nativeReference === '1')).toBe(true);
    await nativeComplete(reserved.id, 'Synthesis [1] [2]');
    const published = (await followups.publish(reserved.id, actorId, sealed.digest))!;
    const citations = (published.components as any[]).filter((component) => component.type === 'citation');
    expect(citations.map((component) => component.data.evidenceId).sort())
      .toEqual([...firstEvidence, ...secondEvidence].filter((item) => item.kind === 'citation').map((item) => item.evidenceId).sort());
    expect(citations.map((component) => component.data.reference).sort()).toEqual(['1', '2']);
    expect(JSON.stringify(published.components)).not.toContain('SUPPLIED_CREDENTIAL');
    const artifacts = (published.components as any[]).filter((component) => component.type === 'artifact');
    expect(new Set(artifacts.map((component) => component.data.artifactId)).size).toBe(2);
    expect(artifacts.every((component) => component.data.nativeArtifactId === 'shared-native-id')).toBe(true);
  });

  it('rejects final citation aliases absent from the sealed registry without publishing', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    await nativeComplete(reserved.id, 'Unsupported [99]');
    await expect(followups.publish(reserved.id, actorId, sealed.digest)).rejects.toThrow('sealed registry');
    expect(await database.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(0);
    expect(await database.db.select().from(rootBackgroundEvents).where(eq(rootBackgroundEvents.executionId, reserved.id))).toHaveLength(0);
  });

  it('reads sealed producer pages without reserving a writer and rejects revoked native ownership', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const grant = await nativeClaim(reserved.id);
    expect(await followups.readResult(grant, childId, 0)).toMatchObject({ executionId: childId,
      text: 'Child result', nextOffset: null, evidence: [] });
    await expect(followups.readResult(grant, id(), 0)).rejects.toThrow('sealed manifest');
    expect(await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.id, reserved.id))).toHaveLength(0);
    await database.db.update(rootBackgroundJobs).set({ status: 'cancelled', fence: 2 })
      .where(eq(rootBackgroundJobs.executionId, reserved.id));
    await expect(followups.readResult(grant, childId, 0)).rejects.toThrow('owner, fence');
  });

  it('never starts synthesis beyond the original work-group deadline', async () => {
    state.scope.deadlineEpochMs = Date.now() - 1;
    await work.recordNativeState(rootId, state, 'running');
    const sealed = await seal();
    expect(await followups.reserve(rootId, actorId, sealed.digest)).toBeNull();
  });

  it('qualifies the real HTTP guard, DTO and result-reader boundary against isolated PostgreSQL', async () => {
    // Root identity binding: the same pinned Root agent the authority chain verifies.
    await database.db.update(conversations).set({ rootAgentId: actorId }).where(eq(conversations.id, conversationId));
    await database.db.update(rootExecutions).set({ rootAgentId: actorId }).where(eq(rootExecutions.id, rootId));
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const grant = await nativeClaim(reserved.id);
    const owned = await followups.owned(grant);
    // Profile/source lookup is a disposable fixture seam; SQL ownership and HTTP wiring are real.
    const service = new RootFollowupService(followups, {
      getExecution: async (executionId: string) => ({ ...await work.getExecution(executionId), rootAgentId: actorId }),
    } as never, { authorizeSynthesisMember: async () => ({}) } as never, {
      getConversationDocument: async () => {
        const [conversation] = await database.db.select().from(conversations).where(eq(conversations.id, conversationId));
        return { ...conversation, rootAgentId: actorId };
      },
    } as never, { resolveForActor: async () => ({ policy: { background: { enabled: true } }, rootSnapshotDigest: 'pinned' }) } as never,
    {} as never);
    const results = { authorizeBackgroundExecution: async () => ({}) };
    const lifecycle = new RootBackgroundLifecycleService({} as never,
      new RootBackgroundEventStore(database.db, results as never), {} as never, {} as never,
      results as never, work as never, {} as never, service);
    const definitions = new RootDelegateDefinitionService(realWork, {
      getConversationDocument: async () => ({ ...(await database.db.select().from(conversations)
        .where(eq(conversations.id, conversationId)))[0], rootAgentId: actorId }),
    } as never, { resolveForActor: async () => ({ policy: { background: { enabled: true } }, rootSnapshotDigest: 'pinned' }) } as never,
    {} as never, {} as never, {} as never, jobs, {} as never);
    const module = await Test.createTestingModule({ controllers: [RootDelegateInternalController], providers: [
      { provide: ConfigService, useValue: authorityConfig },
      { provide: RootWorkService, useValue: realWork },
      { provide: RootDelegateDefinitionService, useValue: definitions },
      { provide: RootBackgroundLifecycleService, useValue: lifecycle },
      ...[RootTemporaryDefinitionService, RootFanoutService, RootBackgroundSubmissionService, RootConversationReplyService,
        ConversationArtifactService].map((provide) => ({ provide, useValue: {} })),
    ] }).compile();
    const app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    try {
      await app.listen(0, '127.0.0.1');
      const endpoint = `${await app.getUrl()}/internal/root-work/${reserved.id}/background-synthesis-results/${childId}`;
      const body = { owner: grant.owner, fence: grant.fence, nativeOwner: grant.nativeOwner,
        requestDigest: owned.job.requestDigest, offset: 0 };
      const authority = await realWork.issueBackgroundAuthority((await jobs.getJob(reserved.id))!);
      const post = (value: unknown, secret: string | undefined = machine, token: string | null = authority) => fetch(endpoint,
        { method: 'POST', headers: { 'content-type': 'application/json',
          'x-yellowstorm-service-principal': 'adk-root-runtime',
          ...(secret ? { 'x-yellowstorm-service-token': secret } : {}),
          ...(token ? { 'x-yellowstorm-execution-authority': token } : {}) }, body: JSON.stringify(value) });
      expect((await post(body, 'wrong')).status).toBe(401);
      expect((await post(body, machine, null)).status).toBe(401);
      expect((await post({ ...body, offset: -1 })).status).toBe(400);
      // The authority chain itself rejects a foreign actor selector before DTO validation.
      expect((await post({ ...body, actorId: 'impersonation' })).status).toBe(401);
      expect((await post({ ...body, requestDigest: 'f'.repeat(64) })).status).toBe(500);
      const response = await post(body);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ executionId: childId, text: 'Child result', nextOffset: null });
      const eventEndpoint = `${await app.getUrl()}/internal/root-work/${reserved.id}/background-events`;
      const eventBody = { ...body, events: [{ eventId: 'followup_usage', kind: 'usage',
        usage: { inputTokens: 2, outputTokens: 1 } }] };
      delete (eventBody as Partial<typeof body>).offset;
      const postEvent = (value = eventBody, token: string | undefined = authority) => fetch(eventEndpoint,
        { method: 'POST', headers: { 'content-type': 'application/json',
          'x-yellowstorm-service-principal': 'adk-root-runtime', 'x-yellowstorm-service-token': machine,
          ...(token ? { 'x-yellowstorm-execution-authority': token } : {}) }, body: JSON.stringify(value) });
      expect((await postEvent({ ...eventBody, nativeOwner: 'wrong' })).status).toBe(500);
      const eventResponse = await postEvent();
      expect(eventResponse.status).toBe(201);
      const acknowledgement = await eventResponse.json();
      expect(acknowledgement).toMatchObject({ events: [{ eventId: 'followup_usage' }] });
      expect(await (await postEvent()).json()).toEqual(acknowledgement);
      expect(await database.db.select().from(rootBackgroundEvents)
        .where(eq(rootBackgroundEvents.executionId, reserved.id))).toHaveLength(1);
      await database.db.update(rootBackgroundJobs).set({ status: 'cancelled', fence: 2 })
        .where(eq(rootBackgroundJobs.executionId, reserved.id));
      const revoked = await post(body);
      expect(revoked.status).toBe(401);
      expect(await revoked.text()).not.toContain('Child result');
      expect((await postEvent()).status).toBe(401);
    } finally { await app.close(); }
  });

  it('lets Stop suppress unpublished synthesis while leaving the writer available for the next request', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    await nativeComplete(reserved.id);
    await work.stopRootWork({ conversationId, actorId, expectedEpoch: 0, stopRequestId: newStopRequestId() });
    expect(await followups.publish(reserved.id, actorId, sealed.digest)).toBeNull();
    const writers = await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.id, reserved.id));
    expect(writers).toHaveLength(0);
    await database.db.insert(conversationExecutions).values({ id: id(), conversationId, userId: actorId,
      messageId: id(), expiresAt: new Date(Date.now() + 60000) });
  });

  (process.env.VECTOR_REAL_MODEL_QUALIFY === '1' ? it : it.skip)(
    'runs the production scheduler, authenticated native host, provider and owned HTTP lifecycle', async () => {
    // Only profile/source lookup is synthetic; transport, scheduler, SQL and model execution are real.
    await database.db.update(conversations).set({ rootAgentId: actorId }).where(eq(conversations.id, conversationId));
    await database.db.update(rootExecutions).set({ rootAgentId: actorId }).where(eq(rootExecutions.id, rootId));
    const results = { authorizeSynthesisMember: async () => ({}),
      authorizeBackgroundExecution: async (_conversation: string, executionId: string) => work.getExecution(executionId) };
    const service = new RootFollowupService(followups, work as never, results as never, { getConversationDocument: async () => {
      const [conversation] = await database.db.select().from(conversations).where(eq(conversations.id, conversationId));
      return conversation;
    } } as never, { resolveForActor: async () => ({ policy: { background: { enabled: true } }, rootSnapshotDigest: 'pinned' }) } as never,
    { buildGrpcAgentsForPlaybook: async () => [{ id: actorId, name: 'QualificationSynthesis',
      description: 'Synthetic qualification', prompt: 'Return VECTORNATIVENEST exactly. Do not use tools or citations.',
      tools: [], brain_context: [], skills: [], save_memory: false, chatbot: { model: 'gpt-6-luna' } }] } as never);
    const jobs = new RootBackgroundJobStore(database.db);
    const lifecycle = new RootBackgroundLifecycleService(jobs, new RootBackgroundEventStore(database.db, results as never),
      {} as never, {} as never, results as never, work as never, {} as never, service);
    const definitions = new RootDelegateDefinitionService(realWork, { getConversationDocument: async () => {
      const [conversation] = await database.db.select().from(conversations).where(eq(conversations.id, conversationId));
      return conversation;
    } } as never, { resolveForActor: async () => ({ policy: { background: { enabled: true } }, rootSnapshotDigest: 'pinned' }) } as never,
    {} as never, {} as never, {} as never, jobs, {} as never);
    const token = machine;
    const module = await Test.createTestingModule({ controllers: [RootDelegateInternalController], providers: [
      { provide: ConfigService, useValue: authorityConfig },
      { provide: RootWorkService, useValue: realWork },
      { provide: RootDelegateDefinitionService, useValue: definitions },
      { provide: RootBackgroundLifecycleService, useValue: lifecycle },
      { provide: ConversationArtifactService, useValue: {} },
      ...[RootTemporaryDefinitionService, RootFanoutService, RootBackgroundSubmissionService, RootConversationReplyService]
        .map((provide) => ({ provide, useValue: {} })),
    ] }).compile();
    const app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    let native: Awaited<ReturnType<typeof startNativeQualificationHost>> | undefined;
    let driver: RootBackgroundDriverService | undefined;
    try {
      await app.listen(0, '127.0.0.1');
      native = await startNativeQualificationHost(`${await app.getUrl()}/api/v1`, token);
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
      const sealed = await seal();
      const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
      const configuration = { get: (name: string, fallback: unknown) => name === 'grpcSecurity.apiKey' ? transport.key
        : name === 'conversation.rootBackgroundEnabled' ? true : name.startsWith('conversation.rootBackgroundMax') ? 1 : fallback };
      driver = new RootBackgroundDriverService(jobs, { rootBackgroundReady: readiness,
        getChatbotClient: () => transport.client } as never, configuration as ConfigService, service, realWork);
      driver.onModuleInit();
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
      const occupied = await database.db.execute(sql`SELECT count(*)::int AS count FROM conversation.root_model_slots WHERE status <> 'free'`);
      expect(occupied.rows[0].count).toBe(0);
    } finally {
      await driver?.onModuleDestroy();
      await native?.close();
      await app.close();
    }
  }, 180000);
});
