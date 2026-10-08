import { RootFanoutService } from './root-fanout.service';
import { reserveFanoutManifest } from '../persistence/postgres/root-fanout-reservation';
import type { RootFanoutProposalDto } from '../dto/root-fanout-proposal.dto';
import { updateWorkerPermit } from '../persistence/postgres/root-worker-permits';

jest.mock('../persistence/postgres/root-fanout-reservation', () => ({ reserveFanoutManifest: jest.fn() }));
jest.mock('../persistence/postgres/root-worker-permits', () => ({ updateWorkerPermit: jest.fn() }));
const reserve = jest.mocked(reserveFanoutManifest);
const rootId = 'a'.repeat(24); const parentId = 'b'.repeat(24);
const proposal = () => ({ version: 1, mode: 'foreground', nativeCallId: 'call', nativeCallBranch: 'root.run_fanout@call',
  target: { kind: 'temporary' }, items: [{ key: 'one', task: 'Task', contextRefs: ['workspace'] }] } as RootFanoutProposalDto);

describe('RootFanoutService authority', () => {
  let service: RootFanoutService;
  let conversation: Record<string, unknown>;
  let pool: any;
  let shares: { assertUserHasAccess: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    conversation = { createdBy: 'actor', rootAgentId: rootId, rootWorkEpoch: 3 };
    pool = { rootSnapshotDigest: 'snapshot', delegationEnabled: true, entries: [],
      policy: { fanout: { enabled: true }, temporaryWorkers: { enabled: true } } };
    shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    const work = { getExecution: jest.fn().mockResolvedValue({ role: 'root', depth: 0, rootAgentId: rootId,
      conversationId: 'conversation', conversationEpoch: 3, resultPayload: { nativeState: { actorId: 'actor',
        scope: { immutableSnapshotRef: 'snapshot' }, rootContext: { max_fanout_items: 3 },
        capabilityCeiling: { workspaceIds: ['workspace'] } } } }) };
    service = new RootFanoutService({} as any, work as any,
      { getConversationDocument: jest.fn(async () => conversation) } as any,
      { resolveForActor: jest.fn(async () => pool) } as any, shares as any);
    reserve.mockResolvedValue({ manifestId: 'manifest' } as any);
  });
  it('checks current authority and sources before and after atomic reservation', async () => {
    expect(await service.reserve(parentId, proposal())).toEqual({ manifestId: 'manifest' });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(shares.assertUserHasAccess).toHaveBeenCalledTimes(2);
    expect(shares.assertUserHasAccess).toHaveBeenCalledWith('actor', ['workspace']);
  });
  it.each(['owner', 'epoch', 'binding', 'snapshot', 'policy'])('denies changed %s before reservation', async (change) => {
    if (change === 'owner') conversation.createdBy = 'other';
    if (change === 'epoch') conversation.rootWorkEpoch = 4;
    if (change === 'binding') conversation.rootAgentId = 'other';
    if (change === 'snapshot') pool.rootSnapshotDigest = 'changed';
    if (change === 'policy') pool.policy.fanout.enabled = false;
    await expect(service.reserve(parentId, proposal())).rejects.toThrow('authority changed');
    expect(reserve).not.toHaveBeenCalled();
  });
  it('rejects unapproved references and background before reservation', async () => {
    const invalid = proposal(); invalid.items[0].contextRefs = ['revoked'];
    await expect(service.reserve(parentId, invalid)).rejects.toThrow('not authorized');
    await expect(service.reserve(parentId, { ...proposal(), mode: 'background' } as any)).rejects.toThrow('foreground');
    expect(reserve).not.toHaveBeenCalled();
  });
  it('denies revoked workspace access before reservation', async () => {
    shares.assertUserHasAccess.mockRejectedValue(new Error('revoked workspace'));
    await expect(service.reserve(parentId, proposal())).rejects.toThrow('revoked workspace');
    expect(reserve).not.toHaveBeenCalled();
  });
  it('never returns a runnable manifest if authority changes during reservation', async () => {
    reserve.mockImplementationOnce(async () => { pool.rootSnapshotDigest = 'changed'; return {} as any; });
    await expect(service.reserve(parentId, proposal())).rejects.toThrow('authority changed');
  });
});

describe('RootFanoutService worker permits', () => {
  const childId = 'c'.repeat(24);
  let service: RootFanoutService; let child: any; let parent: any; let pool: any; let conversation: any;
  const update = jest.mocked(updateWorkerPermit);
  let shares: { assertUserHasAccess: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    parent = { role: 'root', status: 'running', rootAgentId: rootId, conversationId: 'conversation', conversationEpoch: 1,
      resultPayload: { nativeState: { actorId: 'actor', scope: { immutableSnapshotRef: 'root' } } } };
    child = { role: 'library_worker', status: 'running', parentExecutionId: parentId,
      resultPayload: { nativeState: { scope: { immutableSnapshotRef: 'worker' },
        rootContext: { selected_agent_id: childId, source_workspace_ids: ['workspace'] } } } };
    pool = { rootSnapshotDigest: 'root', delegationEnabled: true, policy: { temporaryWorkers: { enabled: true } },
      entries: [{ agentId: childId, snapshotDigest: 'worker' }] };
    conversation = { createdBy: 'actor', rootAgentId: rootId, rootWorkEpoch: 1 };
    shares = { assertUserHasAccess: jest.fn().mockResolvedValue(undefined) };
    service = new RootFanoutService({} as any,
      { getExecution: jest.fn(async (id) => id === parentId ? parent : child) } as any,
      { getConversationDocument: jest.fn(async () => conversation) } as any,
      { resolveForActor: jest.fn(async () => pool) } as any, shares as any);
    update.mockResolvedValue(true);
  });
  it('checks current selected worker and positive source proof before acquiring', async () => {
    expect(await service.permit(parentId, childId, { owner: 'owner', operation: 'acquire' })).toEqual({ acquired: true });
    expect(shares.assertUserHasAccess).toHaveBeenCalledWith('actor', ['workspace']);
    expect(update).toHaveBeenCalledWith({}, parentId, childId, 'owner', 'acquire');
  });
  it.each(['stop', 'epoch', 'grant', 'snapshot', 'sources'])('denies %s before slot mutation', async (change) => {
    if (change === 'stop') parent.status = 'cancellation_requested';
    if (change === 'epoch') conversation.rootWorkEpoch = 2;
    if (change === 'grant') pool.entries = [];
    if (change === 'snapshot') pool.entries[0].snapshotDigest = 'changed';
    if (change === 'sources') delete child.resultPayload.nativeState.rootContext.source_workspace_ids;
    await expect(service.permit(parentId, childId, { owner: 'owner', operation: 'acquire' })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
  it('retains owner-checked release after Stop without new authority or grants', async () => {
    parent.status = 'cancellation_requested'; pool.entries = [];
    expect(await service.permit(parentId, childId, { owner: 'owner', operation: 'release' })).toEqual({ acquired: true });
    expect(shares.assertUserHasAccess).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({}, parentId, childId, 'owner', 'release');
  });
  it('denies a grant revoked during asynchronous source checks', async () => {
    shares.assertUserHasAccess.mockImplementationOnce(async () => { pool.entries = []; });
    await expect(service.permit(parentId, childId, { owner: 'owner', operation: 'acquire' })).rejects.toThrow('authority changed');
    expect(update).not.toHaveBeenCalled();
  });
});
