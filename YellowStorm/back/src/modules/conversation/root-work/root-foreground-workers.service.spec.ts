import { RootForegroundWorkersService } from './root-foreground-workers.service';
import { ErrorCode, NotFoundException } from '../../exceptions';

function fixture() {
  const conversation = { id: 'conversation', createdBy: 'owner', rootAgentId: 'agent', rootWorkEpoch: 4 };
  const parent: any = { id: 'root', role: 'root', status: 'running', conversationId: 'conversation', rootAgentId: 'agent',
    conversationEpoch: 4, createdAt: new Date(), resultPayload: { nativeState: {
      actorId: 'owner', origin: { assistantMessageId: 'answer', questionMessageId: 'question' },
      scope: { immutableSnapshotRef: 'snapshot' }, rootContext: {}, capabilityCeiling: { workspaceIds: ['source'] },
      fanoutManifests: [{ mode: 'foreground', target: { kind: 'temporary' }, items: [
        { executionId: 'one', task: 'First assignment' }, { executionId: 'two', task: 'Second assignment' },
        { executionId: 'three', task: 'Third assignment' },
      ] }],
    } } };
  const leaf = (id: string) => ({ ...parent, id, role: 'temporary_worker', parentExecutionId: 'root',
    resultPayload: { nativeState: { admittedRequest: { task: `${id} assignment` } } } });
  const rows = [parent, leaf('one'), leaf('two')];
  const conversations = { getConversationDocument: jest.fn().mockResolvedValue(conversation),
    filterAccessibleWorkspaceIds: jest.fn().mockResolvedValue(['source']) };
  const work = { listWorkerExecutions: jest.fn().mockResolvedValue(rows) };
  const pool = { rootSnapshotDigest: 'snapshot', delegationEnabled: true, entries: [],
    policy: { temporaryWorkers: { enabled: true }, fanout: { enabled: true } } };
  const resolver = { resolveForActor: jest.fn().mockResolvedValue(pool) };
  const results = { authorizeForegroundWorkerStatus: jest.fn().mockResolvedValue({}) };
  const service = new RootForegroundWorkersService(conversations as never, work as never, resolver as never, results as never);
  return { service, parent, rows, conversation, pool, work, resolver, results, conversations };
}

it('projects three trusted temporary workers with two running and one queued, without duplicates', async () => {
  const h = fixture();
  const workers = await h.service.snapshot('conversation', 'owner');
  expect(workers).toHaveLength(3);
  expect(workers.map((worker) => worker.status)).toEqual(['running', 'running', 'queued']);
  expect(workers.every((worker) => worker.role === 'temporary_worker' && worker.mode === 'foreground'
    && worker.originAssistantMessageId === 'answer')).toBe(true);
  expect(h.results.authorizeForegroundWorkerStatus).toHaveBeenCalledTimes(2);
  h.rows[1].status = 'completed'; h.parent.status = 'cancelled';
  expect((await h.service.snapshot('conversation', 'owner')).map((worker) => worker.status)).toEqual(['completed', 'running', 'not_started']);
});

it('includes direct workers but excludes background workers and manifests', async () => {
  const h = fixture(); h.parent.resultPayload.nativeState.fanoutManifests = [];
  h.rows[2].resultPayload.nativeState.backgroundJobId = 'two';
  expect((await h.service.snapshot('conversation', 'owner')).map((worker) => worker.executionId)).toEqual(['one']);
});

it.each(['owner', 'epoch', 'binding', 'snapshot', 'source', 'workerAccess'])('hides inaccessible %s assignments', async (change) => {
  const h = fixture();
  if (change === 'owner') h.conversation.createdBy = 'other';
  if (change === 'epoch') h.conversation.rootWorkEpoch = 5;
  if (change === 'binding') h.conversation.rootAgentId = 'other';
  if (change === 'snapshot') h.pool.rootSnapshotDigest = 'changed';
  if (change === 'source') h.conversations.filterAccessibleWorkspaceIds.mockResolvedValue([]);
  if (change === 'workerAccess') h.results.authorizeForegroundWorkerStatus.mockRejectedValue(new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'revoked'));
  if (change === 'owner') await expect(h.service.snapshot('conversation', 'owner')).rejects.toThrow('unavailable');
  else expect(await h.service.snapshot('conversation', 'owner')).toEqual([]);
});

it('propagates operational failures and hides a target revoked during projection', async () => {
  const h = fixture(); h.resolver.resolveForActor.mockRejectedValueOnce(new Error('database offline'));
  await expect(h.service.snapshot('conversation', 'owner')).rejects.toThrow('database offline');
  h.resolver.resolveForActor.mockResolvedValueOnce(h.pool).mockResolvedValueOnce({ ...h.pool,
    policy: { ...h.pool.policy, temporaryWorkers: { enabled: false } } });
  expect(await h.service.snapshot('conversation', 'owner')).toEqual([]);
});
