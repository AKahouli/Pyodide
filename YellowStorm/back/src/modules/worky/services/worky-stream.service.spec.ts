import { ConfigService } from '@nestjs/config';
import { newObjectId } from '@common/postgres';
import { WorkyStreamService } from './worky-stream.service';
import type { WorkyStreamListResult } from '../persistence/worky-stream.repository';
import type { WorkyStreamRecord, WorkyStreamShareRecord } from '../worky.types';

const stream = (over: Partial<WorkyStreamRecord> = {}): WorkyStreamRecord => ({
  id: newObjectId(),
  ownerUserId: newObjectId(),
  shares: [],
  workspaceId: newObjectId(),
  artifactWorkspaceId: null,
  managerAgentId: null,
  managerModelId: null,
  workerModelId: null,
  voicePrompt: null,
  aiSessionId: null,
  governancePolicyRef: null,
  title: 'Stream',
  status: 'created',
  controlState: 'active',
  schedulerEnabled: false,
  currentPlanVersion: 0,
  executionPlanVersion: null,
  budget: { limitUsd: 0, limitTokens: 0, spendUsd: 0, tokensUsed: 0, enforcement: 'hard_stop' },
  startedAt: null,
  completedAt: null,
  activeDurationMinutes: 0,
  lastActivityAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const share = (over: Partial<WorkyStreamShareRecord> = {}): WorkyStreamShareRecord => ({
  id: newObjectId(),
  streamId: newObjectId(),
  userId: newObjectId(),
  permission: 'read',
  createdAt: new Date('2026-02-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  ...over,
});

const emptyList = (over: Partial<WorkyStreamListResult> = {}): WorkyStreamListResult => ({
  items: [],
  total: 0,
  statusCounts: {},
  attentionCount: 0,
  laneCounts: new Map(),
  ...over,
});

function makeService(repo: Record<string, jest.Mock> = {}) {
  const streams = {
    create: jest.fn(async (input: { ownerUserId: string; workspaceId: string; title: string }) => stream(input)),
    findById: jest.fn().mockResolvedValue(null),
    findByAiSessionId: jest.fn().mockResolvedValue(null),
    titleTaken: jest.fn().mockResolvedValue(false),
    update: jest.fn(),
    delete: jest.fn().mockResolvedValue(true),
    listForUser: jest.fn().mockResolvedValue(emptyList()),
    upsertShare: jest.fn(),
    updateSharePermission: jest.fn(),
    deleteShare: jest.fn(),
    ...repo,
  };
  const agentRepository = { deleteByIdAndOwner: jest.fn().mockResolvedValue(undefined) };
  const agentTypeService = { findOrCreateBySlug: jest.fn() };
  const workspaceService = { delete: jest.fn() };
  const workspaceDocuments = { deleteAllByWorkspace: jest.fn() };
  const config = { get: jest.fn((_key: string, fallback?: number) => fallback ?? 0) } as unknown as ConfigService;
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const orchestrator = { createSession: jest.fn().mockResolvedValue('sess-new') };
  const users = { byId: jest.fn(), byIds: jest.fn().mockResolvedValue(new Map()), byEmails: jest.fn().mockResolvedValue(new Map()) };
  const events = { disconnectUserFromStream: jest.fn() };
  const service = new WorkyStreamService(
    streams as never,
    agentRepository as never,
    agentTypeService as never,
    workspaceService as never,
    workspaceDocuments as never,
    config,
    logger as never,
    orchestrator as never,
    users as never,
    events as never,
  );
  return { service, streams, agentRepository, workspaceService, workspaceDocuments, logger, orchestrator, users, events };
}

describe('WorkyStreamService.create', () => {
  const userId = newObjectId();

  it('persists the stream without provisioning a workspace or Manager agent', async () => {
    const { service, streams, orchestrator } = makeService();

    const result = await service.create(userId, { title: '  Benchmark analysis ' });

    // workspaceId falls back to the owner id (governance scope) when no
    // explicit parent workspace is supplied.
    expect(streams.create).toHaveBeenCalledWith({ ownerUserId: userId, workspaceId: userId, title: 'Benchmark analysis' });
    // The orchestrator session is created lazily, not on create().
    expect(orchestrator.createSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ownerUserId: userId,
      access: 'owner',
      title: 'Benchmark analysis',
      status: 'created',
      controlState: 'active',
      artifactWorkspaceId: null,
      managerAgentId: null,
      managerModelId: null,
      workerModelId: null,
      budget: { enforcement: 'hard_stop' },
    });
  });

  it('uses an explicit parent workspaceId when provided', async () => {
    const { service, streams } = makeService();
    const workspaceId = newObjectId();

    await service.create(userId, { title: 'Scoped', workspaceId });

    expect(streams.create).toHaveBeenCalledWith(expect.objectContaining({ workspaceId }));
  });
});

describe('WorkyStreamService.findByAiSessionId', () => {
  it('returns streamId + ownerUserId', async () => {
    const { service } = makeService({
      findByAiSessionId: jest.fn().mockResolvedValue({ id: 'stream-1', ownerUserId: 'owner-1' }),
    });

    await expect(service.findByAiSessionId('sess-xyz')).resolves.toEqual({ streamId: 'stream-1', ownerUserId: 'owner-1' });
  });

  it('returns null when no stream carries the session', async () => {
    const { service } = makeService();

    await expect(service.findByAiSessionId('sess-none')).resolves.toBeNull();
  });
});

describe('WorkyStreamService.ensureKickoffContext', () => {
  const userId = newObjectId();

  it('returns the existing aiSessionId without creating a new session', async () => {
    const existing = stream({ ownerUserId: userId, aiSessionId: 'sess-existing' });
    const { service, orchestrator, streams } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    const res = await service.ensureKickoffContext(existing.id, userId);

    expect(res).toEqual({ aiSessionId: 'sess-existing', ownerUserId: userId });
    expect(orchestrator.createSession).not.toHaveBeenCalled();
    expect(streams.update).not.toHaveBeenCalled();
  });

  it('lazily creates and persists a session when aiSessionId is null', async () => {
    const existing = stream({ ownerUserId: userId });
    const { service, orchestrator, streams } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    const res = await service.ensureKickoffContext(existing.id, userId);

    expect(orchestrator.createSession).toHaveBeenCalledWith(userId);
    expect(streams.update).toHaveBeenCalledWith(existing.id, { aiSessionId: 'sess-new' });
    expect(res).toEqual({ aiSessionId: 'sess-new', ownerUserId: userId });
  });

  it('opens the session under the owner when a write share kicks off the turn', async () => {
    const collaborator = newObjectId();
    const existing = stream({ ownerUserId: userId, shares: [share({ userId: collaborator, permission: 'write' })] });
    const { service, orchestrator } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    const res = await service.ensureKickoffContext(existing.id, collaborator);

    expect(orchestrator.createSession).toHaveBeenCalledWith(userId);
    expect(res.ownerUserId).toBe(userId);
  });

  it('throws WORKY_STREAM_NOT_FOUND when the stream does not exist', async () => {
    const { service, orchestrator } = makeService();

    await expect(service.ensureKickoffContext(newObjectId(), userId)).rejects.toMatchObject({ code: 'ERR_3500' });
    expect(orchestrator.createSession).not.toHaveBeenCalled();
  });

  it('throws WORKY_STREAM_FORBIDDEN for a read-only share', async () => {
    const reader = newObjectId();
    const existing = stream({ ownerUserId: userId, shares: [share({ userId: reader, permission: 'read' })] });
    const { service, orchestrator } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    await expect(service.ensureKickoffContext(existing.id, reader)).rejects.toMatchObject({ code: 'ERR_3501' });
    expect(orchestrator.createSession).not.toHaveBeenCalled();
  });
});

describe('WorkyStreamService.findById', () => {
  const userId = newObjectId();

  it('returns the stream with the caller access level', async () => {
    const existing = stream({
      ownerUserId: newObjectId(),
      shares: [share({ userId, permission: 'write' })],
      startedAt: new Date('2026-03-01T00:00:00Z'),
    });
    const { service } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    const result = await service.findById(userId, existing.id);

    expect(result).toMatchObject({
      id: existing.id,
      access: 'write',
      startedAt: '2026-03-01T00:00:00.000Z',
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('rejects a user with no access', async () => {
    const existing = stream();
    const { service } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    await expect(service.findById(userId, existing.id)).rejects.toMatchObject({ code: 'ERR_3501' });
  });
});

describe('WorkyStreamService.patch', () => {
  const userId = newObjectId();

  const makePatchService = (existing: WorkyStreamRecord, repo: Record<string, jest.Mock> = {}) =>
    makeService({
      findById: jest.fn().mockResolvedValue(existing),
      update: jest.fn(async (_id: string, patch: Partial<WorkyStreamRecord>) => ({ ...existing, ...patch })),
      ...repo,
    });

  it('persists managerModelId and workerModelId and bumps lastActivityAt', async () => {
    const existing = stream({ ownerUserId: userId });
    const { service, streams } = makePatchService(existing);

    const result = await service.patch(userId, existing.id, {
      managerModelId: ' gpt-4o-mini ',
      workerModelId: 'claude-3-5-sonnet-20240620',
    });

    expect(streams.update).toHaveBeenCalledWith(existing.id, {
      managerModelId: 'gpt-4o-mini',
      workerModelId: 'claude-3-5-sonnet-20240620',
      lastActivityAt: expect.any(Date),
    });
    expect(result.managerModelId).toBe('gpt-4o-mini');
    expect(result.workerModelId).toBe('claude-3-5-sonnet-20240620');
  });

  it('clears a persistent selection when the DTO passes null', async () => {
    const existing = stream({ ownerUserId: userId, managerModelId: 'gpt-4o-mini', workerModelId: 'claude-3-5-sonnet-20240620' });
    const { service, streams } = makePatchService(existing);

    const result = await service.patch(userId, existing.id, { managerModelId: null });

    expect(streams.update).toHaveBeenCalledWith(existing.id, { managerModelId: null, lastActivityAt: expect.any(Date) });
    expect(result.managerModelId).toBeNull();
    expect(result.workerModelId).toBe('claude-3-5-sonnet-20240620');
  });

  it('does not write when nothing changed', async () => {
    const existing = stream({ ownerUserId: userId, title: 'Same', managerModelId: 'gpt-4o-mini', workerModelId: 'claude-3-5-sonnet-20240620' });
    const { service, streams } = makePatchService(existing);

    const result = await service.patch(userId, existing.id, { title: ' Same ', managerModelId: 'gpt-4o-mini' });

    expect(streams.update).not.toHaveBeenCalled();
    expect(streams.titleTaken).not.toHaveBeenCalled();
    expect(result.managerModelId).toBe('gpt-4o-mini');
    expect(result.lastActivityAt).toBe(existing.lastActivityAt.toISOString());
  });

  it('renames the stream when the title is free', async () => {
    const existing = stream({ ownerUserId: userId, title: 'Old' });
    const { service, streams } = makePatchService(existing);

    const result = await service.patch(userId, existing.id, { title: ' New ' });

    expect(streams.titleTaken).toHaveBeenCalledWith(userId, 'New', existing.id);
    expect(streams.update).toHaveBeenCalledWith(existing.id, { title: 'New', lastActivityAt: expect.any(Date) });
    expect(result.title).toBe('New');
  });

  it('rejects a title another stream of the owner already carries', async () => {
    const existing = stream({ ownerUserId: userId, title: 'Old' });
    const { service, streams } = makePatchService(existing, { titleTaken: jest.fn().mockResolvedValue(true) });

    await expect(service.patch(userId, existing.id, { title: 'Taken' })).rejects.toMatchObject({ code: 'ERR_1005' });
    expect(streams.update).not.toHaveBeenCalled();
  });

  it('rejects a read-only share', async () => {
    const reader = newObjectId();
    const existing = stream({ ownerUserId: userId, shares: [share({ userId: reader, permission: 'read' })] });
    const { service, streams } = makePatchService(existing);

    await expect(service.patch(reader, existing.id, { title: 'Nope' })).rejects.toMatchObject({ code: 'ERR_3501' });
    expect(streams.update).not.toHaveBeenCalled();
  });
});

describe('WorkyStreamService.findAllForUser', () => {
  const userId = newObjectId();

  it('returns a paginated envelope with meta (total, page, limit, totalPages)', async () => {
    const items = [stream({ ownerUserId: userId }), stream({ ownerUserId: userId })];
    const { service } = makeService({
      listForUser: jest.fn().mockResolvedValue(emptyList({ items, total: 25, statusCounts: { active: 5, paused: 2 }, attentionCount: 3 })),
    });

    const result = await service.findAllForUser(userId, { page: 2, limit: 12 });

    expect(result.meta).toEqual({ total: 25, page: 2, limit: 12, totalPages: 3, statusCounts: { active: 5, paused: 2 }, attentionCount: 3 });
    expect(result.data).toHaveLength(2);
  });

  it('passes pagination, default sort and the filters to the repository', async () => {
    const { service, streams } = makeService();

    await service.findAllForUser(userId, {
      page: 3,
      limit: 10,
      search: 'report',
      status: ['active'],
      attention: true,
      createdFrom: '2026-01-01T00:00:00.000Z',
      createdTo: '2026-02-01T00:00:00.000Z',
    });

    expect(streams.listForUser).toHaveBeenCalledWith(userId, {
      search: 'report',
      statuses: ['active'],
      attention: true,
      createdFrom: new Date('2026-01-01T00:00:00.000Z'),
      createdTo: new Date('2026-02-01T00:00:00.000Z'),
      sort: undefined,
      sortDir: undefined,
      page: 3,
      limit: 10,
    });
  });

  it('clamps page and limit and forwards the requested sort', async () => {
    const { service, streams } = makeService();

    const result = await service.findAllForUser(userId, { page: 0, limit: 500, sort: 'created', sortDir: 'asc' });

    expect(streams.listForUser).toHaveBeenCalledWith(userId, expect.objectContaining({ page: 1, limit: 100, sort: 'created', sortDir: 'asc' }));
    expect(result.meta.totalPages).toBe(0);
  });

  it('merges per-stream lane counts into stats with progress = done/total', async () => {
    const a = stream({ ownerUserId: userId });
    const b = stream({ ownerUserId: userId });
    const { service } = makeService({
      listForUser: jest.fn().mockResolvedValue(emptyList({
        items: [a, b],
        total: 2,
        laneCounts: new Map([[a.id, { done: 3, running: 2, blocked: 1, backlog: 2, failed: 1 }]]),
      })),
    });

    const result = await service.findAllForUser(userId, {});

    expect(result.data.find((item) => item.id === a.id)?.stats).toEqual({
      totalTasks: 9,
      running: 2,
      done: 3,
      blocked: 1,
      failed: 1,
      progress: 3 / 9,
    });
    // Streams with no tasks get a zeroed stats block.
    expect(result.data.find((item) => item.id === b.id)?.stats).toEqual({
      totalTasks: 0,
      running: 0,
      done: 0,
      blocked: 0,
      failed: 0,
      progress: 0,
    });
  });

  it('reports the access level of a shared stream', async () => {
    const shared = stream({ shares: [share({ userId, permission: 'read' })] });
    const { service } = makeService({ listForUser: jest.fn().mockResolvedValue(emptyList({ items: [shared], total: 1 })) });

    const result = await service.findAllForUser(userId, {});

    expect(result.data[0].access).toBe('read');
  });
});

describe('WorkyStreamService shares', () => {
  const ownerId = newObjectId();
  const sharedUser = { id: newObjectId(), email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' };

  it('lists the shares whose user still exists', async () => {
    const kept = share({ userId: sharedUser.id, permission: 'write' });
    const orphan = share();
    const existing = stream({ ownerUserId: ownerId, shares: [kept, orphan] });
    const { service, users } = makeService({ findById: jest.fn().mockResolvedValue(existing) });
    users.byIds.mockResolvedValue(new Map([[sharedUser.id, sharedUser]]));

    const result = await service.listShares(ownerId, existing.id);

    expect(users.byIds).toHaveBeenCalledWith([kept.userId, orphan.userId]);
    expect(result).toEqual([{ id: kept.id, permission: 'write', user: sharedUser, createdAt: '2026-02-01T00:00:00.000Z' }]);
  });

  it('only lets the owner manage shares', async () => {
    const existing = stream({ ownerUserId: ownerId, shares: [share({ userId: sharedUser.id, permission: 'write' })] });
    const { service } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    await expect(service.listShares(sharedUser.id, existing.id)).rejects.toMatchObject({ code: 'ERR_3501' });
  });

  it('shares with a user found by email (upserting the permission)', async () => {
    const existing = stream({ ownerUserId: ownerId });
    const created = share({ streamId: existing.id, userId: sharedUser.id, permission: 'write' });
    const { service, streams, users } = makeService({
      findById: jest.fn().mockResolvedValue(existing),
      upsertShare: jest.fn().mockResolvedValue(created),
    });
    users.byEmails.mockResolvedValue(new Map([[sharedUser.email, sharedUser]]));

    const result = await service.createShare(ownerId, existing.id, ' Ada@Example.com ', 'write');

    expect(users.byEmails).toHaveBeenCalledWith(['ada@example.com']);
    expect(streams.upsertShare).toHaveBeenCalledWith(existing.id, sharedUser.id, 'write');
    expect(result).toEqual({ id: created.id, permission: 'write', user: sharedUser, createdAt: '2026-02-01T00:00:00.000Z' });
  });

  it('rejects an unknown email and the owner themselves', async () => {
    const existing = stream({ ownerUserId: ownerId });
    const { service, streams, users } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    await expect(service.createShare(ownerId, existing.id, 'nobody@example.com', 'read')).rejects.toMatchObject({ code: 'ERR_3532' });

    users.byEmails.mockResolvedValue(new Map([['me@example.com', { ...sharedUser, id: ownerId, email: 'me@example.com' }]]));
    await expect(service.createShare(ownerId, existing.id, 'me@example.com', 'read')).rejects.toMatchObject({ code: 'ERR_1005' });
    expect(streams.upsertShare).not.toHaveBeenCalled();
  });

  it('updates the permission of an existing share', async () => {
    const existing = stream({ ownerUserId: ownerId });
    const updated = share({ userId: sharedUser.id, permission: 'write' });
    const { service, streams, users } = makeService({
      findById: jest.fn().mockResolvedValue(existing),
      updateSharePermission: jest.fn().mockResolvedValue(updated),
    });
    users.byId.mockResolvedValue(sharedUser);

    const result = await service.updateShare(ownerId, existing.id, updated.id, 'write');

    expect(streams.updateSharePermission).toHaveBeenCalledWith(existing.id, updated.id, 'write');
    expect(users.byId).toHaveBeenCalledWith(sharedUser.id);
    expect(result.permission).toBe('write');
  });

  it('answers share-not-found when the share is not on the stream', async () => {
    const existing = stream({ ownerUserId: ownerId });
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue(existing),
      updateSharePermission: jest.fn().mockResolvedValue(null),
      deleteShare: jest.fn().mockResolvedValue(null),
    });

    await expect(service.updateShare(ownerId, existing.id, newObjectId(), 'read')).rejects.toMatchObject({ code: 'ERR_3531' });
    await expect(service.revokeShare(ownerId, existing.id, newObjectId())).rejects.toMatchObject({ code: 'ERR_3531' });
  });

  it('revokes a share and disconnects the revoked user from the stream SSE', async () => {
    const existing = stream({ ownerUserId: ownerId });
    const removed = share({ streamId: existing.id, userId: sharedUser.id });
    const { service, streams, events } = makeService({
      findById: jest.fn().mockResolvedValue(existing),
      deleteShare: jest.fn().mockResolvedValue(removed),
    });

    await service.revokeShare(ownerId, existing.id, removed.id);

    expect(streams.deleteShare).toHaveBeenCalledWith(existing.id, removed.id);
    expect(events.disconnectUserFromStream).toHaveBeenCalledWith(sharedUser.id, existing.id);
  });
});

describe('WorkyStreamService.delete', () => {
  const userId = newObjectId();

  it('deletes the manager agent, the artifact workspace, then the stream (the database cascades the rest)', async () => {
    const existing = stream({ ownerUserId: userId, artifactWorkspaceId: newObjectId(), managerAgentId: newObjectId() });
    const { service, streams, agentRepository, workspaceService, workspaceDocuments } = makeService({
      findById: jest.fn().mockResolvedValue(existing),
    });

    const result = await service.delete(userId, existing.id);

    expect(result).toEqual({ ok: true, deletedWorkspaceId: existing.artifactWorkspaceId });
    expect(workspaceDocuments.deleteAllByWorkspace).toHaveBeenCalledWith(existing.artifactWorkspaceId);
    expect(workspaceService.delete).toHaveBeenCalledWith(existing.artifactWorkspaceId, userId);
    expect(agentRepository.deleteByIdAndOwner).toHaveBeenCalledWith(existing.managerAgentId, userId);
    expect(streams.delete).toHaveBeenCalledWith(existing.id);
    expect(workspaceService.delete.mock.invocationCallOrder[0]).toBeLessThan(streams.delete.mock.invocationCallOrder[0]);
  });

  it('skips the legacy cleanup for a stream without workspace or agent', async () => {
    const existing = stream({ ownerUserId: userId });
    const { service, streams, agentRepository, workspaceService } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    const result = await service.delete(userId, existing.id);

    expect(result).toEqual({ ok: true, deletedWorkspaceId: null });
    expect(workspaceService.delete).not.toHaveBeenCalled();
    expect(agentRepository.deleteByIdAndOwner).not.toHaveBeenCalled();
    expect(streams.delete).toHaveBeenCalledWith(existing.id);
  });

  it('rejects deletion by a non-owner, even with a write share', async () => {
    const existing = stream({ shares: [share({ userId, permission: 'write' })] });
    const { service, streams } = makeService({ findById: jest.fn().mockResolvedValue(existing) });

    await expect(service.delete(userId, existing.id)).rejects.toMatchObject({ code: 'ERR_3501' });
    expect(streams.delete).not.toHaveBeenCalled();
  });

  it('answers not found for a missing stream', async () => {
    const { service, streams } = makeService();

    await expect(service.delete(userId, newObjectId())).rejects.toMatchObject({ code: 'ERR_3500' });
    expect(streams.delete).not.toHaveBeenCalled();
  });
});
