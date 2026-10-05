import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describeIntegration, makeTestDb } from '../../../postgres/testing/pg-integration';
import { conversations, conversationExecutions, messages, rootBackgroundJobs, rootBackgroundEvents } from '../../../postgres/schema';
import { PostgresRootWorkStore } from './postgres-root-work.store';
import { RootFollowupStore } from './root-followup.store';
import { newStopRequestId, type RootNativeState } from '../../root-work/root-work.types';
import { producerEvidence } from '../../root-work/root-producer-evidence';
import type { RegisterEvidenceInput } from '../../root-work/root-work.store';

describeIntegration('sealed synthesis writer and atomic publication', () => {
  const database = makeTestDb();
  const work = new PostgresRootWorkStore(database.db, { setContext: jest.fn() } as never);
  const followups = new RootFollowupStore(database.db);
  const id = () => randomBytes(12).toString('hex');
  let conversationId: string, actorId: string, rootId: string, childId: string;
  let state: RootNativeState;
  beforeEach(async () => {
    conversationId = id(); actorId = id(); rootId = id(); childId = id();
    await database.db.insert(conversations).values({ id: conversationId, createdBy: actorId });
    state = { actorId, sessionId: 'root', invocationId: null, pendingInputs: [], hasBackgroundJobs: true,
      rootContext: { max_child_executions_per_work_group: 2 },
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
  afterEach(async () => { await database.db.delete(conversations).where(eq(conversations.id, conversationId)); });
  afterAll(async () => { await database.close(); });

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

  it('does not synthesize fast child completion before the scheduling seal or an unknown child outcome', async () => {
    expect(await followups.reserve(rootId, actorId, 'missing')).toBeNull();
    const sealed = await seal('outcome_unknown');
    expect(await followups.reserve(rootId, actorId, sealed.digest)).toBeNull();
  });
  it('reserves exactly one shared writer/job/message identity across replicas for a partial failure', async () => {
    const sealed = await seal('failed');
    const rows = await Promise.all([followups.reserve(rootId, actorId, sealed.digest),
      new RootFollowupStore(database.db).reserve(rootId, actorId, sealed.digest)]);
    expect(rows[0]!.id).toBe(rows[1]!.id);
    const writer = await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.conversationId, conversationId));
    expect(writer).toHaveLength(1);
    expect(await database.db.select().from(rootBackgroundJobs).where(eq(rootBackgroundJobs.conversationId, conversationId))).toHaveLength(1);
    expect(await database.db.select().from(messages).where(eq(messages.conversationId, conversationId))).toHaveLength(0);
  });
  it('retains pending ordinary-turn priority before claiming the writer slot', async () => {
    const sealed = await seal(); const messageId = id();
    await database.db.insert(messages).values({ id: messageId, conversationId, senderId: actorId,
      conversationType: 'ai', isStreaming: true, isComplete: false });
    expect(await followups.reserve(rootId, actorId, sealed.digest)).toBeNull();
    await database.db.update(messages).set({ isComplete: true, isStreaming: false }).where(eq(messages.id, messageId));
    expect(await followups.reserve(rootId, actorId, sealed.digest)).not.toBeNull();
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

  it('reads only sealed producer pages while retaining live writer and native ownership', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    const grant = await nativeClaim(reserved.id);
    expect(await followups.readResult(grant, childId, 0)).toMatchObject({ executionId: childId,
      text: 'Child result', nextOffset: null, evidence: [] });
    await expect(followups.readResult(grant, id(), 0)).rejects.toThrow('sealed manifest');
    await database.db.update(conversationExecutions).set({ status: 'cancelled' })
      .where(eq(conversationExecutions.id, reserved.id));
    await expect(followups.readResult(grant, childId, 0)).rejects.toThrow('writer authority');
  });

  it('never starts synthesis beyond the original work-group deadline', async () => {
    state.scope.deadlineEpochMs = Date.now() - 1;
    await work.recordNativeState(rootId, state, 'running');
    const sealed = await seal();
    expect(await followups.reserve(rootId, actorId, sealed.digest)).toBeNull();
  });

  it('lets Stop suppress unpublished synthesis and release its writer for the next request', async () => {
    const sealed = await seal(); const reserved = (await followups.reserve(rootId, actorId, sealed.digest))!;
    await nativeComplete(reserved.id);
    await work.stopRootWork({ conversationId, actorId, expectedEpoch: 0, stopRequestId: newStopRequestId() });
    expect(await followups.publish(reserved.id, actorId, sealed.digest)).toBeNull();
    const [writer] = await database.db.select().from(conversationExecutions).where(eq(conversationExecutions.id, reserved.id));
    expect(writer.status).toBe('cancelled');
    await database.db.insert(conversationExecutions).values({ id: id(), conversationId, userId: actorId,
      messageId: id(), expiresAt: new Date(Date.now() + 60000) });
  });
});
