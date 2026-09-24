import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { WorkyStreamService } from './worky-stream.service';

const chainableQuery = (resolved: unknown) => {
  const chain: { lean: jest.Mock; exec: jest.Mock } = {
    lean: jest.fn(),
    exec: jest.fn(),
  };
  chain.lean.mockReturnValue(chain);
  chain.exec.mockResolvedValue(resolved);
  return chain;
};

const writeQuery = (resolved: unknown = { deletedCount: 1 }) => ({
  exec: jest.fn().mockResolvedValue(resolved),
});

const makeConnection = (taskIds: Types.ObjectId[] = [new Types.ObjectId()]) => {
  const models = new Map<string, { deleteMany: jest.Mock; find?: jest.Mock }>();
  return {
    models,
    model: jest.fn((name: string) => {
      if (!models.has(name)) {
        models.set(name, {
          deleteMany: jest.fn(() => writeQuery()),
          find: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            lean: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(taskIds.map((_id) => ({ _id }))),
          })),
        });
      }
      return models.get(name);
    }),
  };
};

describe('WorkyStreamService.create', () => {
  const userId = new Types.ObjectId().toString();

  const makeService = (overrides: {
    streamCreate?: jest.Mock;
    workspaceCreate?: jest.Mock;
    agentCreate?: jest.Mock;
    workspaceFindOne?: jest.Mock;
    agentFindOne?: jest.Mock;
    agentTypeFindBySlug?: jest.Mock;
    streamFindOne?: jest.Mock;
    grpcClient?: { createSession: jest.Mock };
  } = {}) => {
    const streamCreate =
      overrides.streamCreate ?? jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
    const workspaceCreate =
      overrides.workspaceCreate ?? jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
    const agentCreate =
      overrides.agentCreate ?? jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
    const workspaceFindOne = overrides.workspaceFindOne ?? jest.fn(() => chainableQuery(null));
    const agentFindOne = overrides.agentFindOne ?? jest.fn().mockResolvedValue(null);
    const agentTypeFindBySlug =
      overrides.agentTypeFindBySlug ??
      jest.fn().mockResolvedValue({ id: new Types.ObjectId().toString(), name: 'Manager' });

    const streamModel = {
      create: streamCreate,
      findById: jest.fn(),
      find: jest.fn(),
      findOne: overrides.streamFindOne ?? jest.fn(),
    };
    const workspaceModel = { create: workspaceCreate, findOne: workspaceFindOne };
    const agentRepository = { create: agentCreate, findByNameAndOwner: agentFindOne, deleteByIdAndOwner: jest.fn().mockResolvedValue(undefined) };
    const agentTypeService = { findBySlug: agentTypeFindBySlug, getManyForHydration: jest.fn().mockResolvedValue(new Map()) };
    const connection = makeConnection();
    const workspaceService = { delete: jest.fn() };
    const workspaceDocuments = { deleteAllByWorkspace: jest.fn() };
    const config = { get: jest.fn((key: string, fallback?: number) => fallback ?? 0) } as unknown as ConfigService;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const grpcClient = overrides.grpcClient ?? { createSession: jest.fn().mockResolvedValue('sess-xyz') };

    const service = new WorkyStreamService(
      streamModel as any,
      agentRepository as any,
      connection as any,
      agentTypeService as any,
      workspaceService as any,
      workspaceDocuments as any,
      config,
      logger as any,
      grpcClient as any,
    );
    return { service, streamCreate, workspaceCreate, agentCreate, workspaceFindOne, agentFindOne, streamModel, grpcClient };
  };

  it('persists the stream without provisioning a workspace or Manager agent', async () => {
    const { service, streamCreate, workspaceCreate, agentCreate } = makeService();

    const result = await service.create(userId, { title: 'Benchmark analysis' });

    // No per-stream artifact workspace or Manager agent is created anymore.
    expect(workspaceCreate).not.toHaveBeenCalled();
    expect(agentCreate).not.toHaveBeenCalled();

    expect(streamCreate).toHaveBeenCalledTimes(1);
    const streamInput = streamCreate.mock.calls[0][0];
    expect(streamInput.ownerUserId.toString()).toBe(userId);
    expect(streamInput.title).toBe('Benchmark analysis');
    // workspaceId falls back to the owner id (governance scope) when no
    // explicit parent workspace is supplied.
    expect(streamInput.workspaceId.toString()).toBe(userId);
    expect(streamInput.artifactWorkspaceId).toBeUndefined();
    expect(streamInput.managerAgentId).toBeUndefined();
    expect(streamInput.status).toBe('created');
    expect(streamInput.controlState).toBe('active');
    expect(streamInput.budget.enforcement).toBe('hard_stop');

    expect(result.artifactWorkspaceId).toBeNull();
    expect(result.managerAgentId).toBeNull();
    expect(result.title).toBe('Benchmark analysis');
    expect(result.status).toBe('created');
  });

  it('uses an explicit parent workspaceId when provided', async () => {
    const { service, streamCreate } = makeService();
    const workspaceId = new Types.ObjectId().toString();

    await service.create(userId, { title: 'Scoped', workspaceId } as any);

    expect(streamCreate.mock.calls[0][0].workspaceId.toString()).toBe(workspaceId);
  });

  it('seeds per-stream model selection to null on create', async () => {
    const { service, streamCreate } = makeService();
    const result = await service.create(userId, { title: 'with-models' });
    const streamInput = streamCreate.mock.calls[0][0];
    expect(streamInput.managerModelId).toBeNull();
    expect(streamInput.workerModelId).toBeNull();
    expect(result.managerModelId).toBeNull();
    expect(result.workerModelId).toBeNull();
  });

  it('does not eagerly create an orchestrator session on create()', async () => {
    const { service, streamCreate, grpcClient } = makeService();

    await service.create(userId, { title: 'My stream' } as any);

    expect(grpcClient.createSession).not.toHaveBeenCalled();
    const createdArg = streamCreate.mock.calls[0][0];
    expect(createdArg.aiSessionId).toBeUndefined();
  });

  it('findByAiSessionId returns streamId + ownerUserId', async () => {
    const { service, streamModel } = makeService();
    streamModel.findOne.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: 'stream-1', ownerUserId: 'owner-1' }) }),
    } as any);

    const res = await service.findByAiSessionId('sess-xyz');

    expect(res).toEqual({ streamId: 'stream-1', ownerUserId: 'owner-1' });
  });

});

describe('WorkyStreamService.ensureKickoffContext', () => {
  const userId = new Types.ObjectId().toString();
  const streamId = new Types.ObjectId().toString();

  const makeEnsureService = (findByIdResolved: unknown) => {
    const streamDoc = findByIdResolved
      ? { ownerUserId: new Types.ObjectId(userId), shares: [], ...(findByIdResolved as object) }
      : null;
    const updateOne = jest.fn(() => writeQuery({ acknowledged: true }));
    const streamModel = {
      create: jest.fn(),
      findById: jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(streamDoc) }),
      }),
      find: jest.fn(),
      findOne: jest.fn(),
      updateOne,
    };
    const workspaceModel = { create: jest.fn(), findOne: jest.fn() };
    const agentRepository = { create: jest.fn(), findByNameAndOwner: jest.fn(), deleteByIdAndOwner: jest.fn() };
    const agentTypeService = { findBySlug: jest.fn() };
    const connection = makeConnection();
    const workspaceService = { delete: jest.fn() };
    const workspaceDocuments = { deleteAllByWorkspace: jest.fn() };
    const config = { get: jest.fn((_k: string, fb?: number) => fb ?? 0) } as unknown as ConfigService;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const grpcClient = { createSession: jest.fn().mockResolvedValue('sess-new') };
    const service = new WorkyStreamService(
      streamModel as any,
      agentRepository as any,
      connection as any,
      agentTypeService as any,
      workspaceService as any,
      workspaceDocuments as any,
      config,
      logger as any,
      grpcClient as any,
    );
    return { service, streamModel, grpcClient, updateOne };
  };

  it('returns the existing aiSessionId without creating a new session', async () => {
    const { service, grpcClient, updateOne } = makeEnsureService({
      aiSessionId: 'sess-existing',
    });

    const res = await service.ensureKickoffContext(streamId, userId);

    expect(res).toEqual({ aiSessionId: 'sess-existing', ownerUserId: userId });
    expect(grpcClient.createSession).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('lazily creates and persists a session when aiSessionId is null', async () => {
    const { service, grpcClient, updateOne } = makeEnsureService({
      aiSessionId: null,
    });

    const res = await service.ensureKickoffContext(streamId, userId);

    expect(grpcClient.createSession).toHaveBeenCalledWith(userId);
    expect(updateOne).toHaveBeenCalledWith({ _id: streamId }, { $set: { aiSessionId: 'sess-new' } });
    expect(res).toEqual({ aiSessionId: 'sess-new', ownerUserId: userId });
  });

  it('throws WORKY_STREAM_NOT_FOUND when the stream does not exist', async () => {
    const { service, grpcClient } = makeEnsureService(null);

    await expect(service.ensureKickoffContext(streamId, userId)).rejects.toMatchObject({
      code: 'ERR_3500',
    });
    expect(grpcClient.createSession).not.toHaveBeenCalled();
  });
});

describe('WorkyStreamService.patch (per-stream model selection)', () => {
  const userObjectId = new Types.ObjectId();
  const streamObjectId = new Types.ObjectId();
  const userId = userObjectId.toString();

  const buildStreamDoc = (overrides: Record<string, unknown> = {}) => {
    const saved = { _id: streamObjectId };
    const doc: any = {
      _id: streamObjectId,
      ownerUserId: userObjectId,
      workspaceId: new Types.ObjectId(),
      artifactWorkspaceId: new Types.ObjectId(),
      managerAgentId: new Types.ObjectId(),
      title: 'Test stream',
      status: 'created',
      controlState: 'active',
      budget: {
        limitUsd: 0,
        limitTokens: 0,
        spendUsd: 0,
        tokensUsed: 0,
        enforcement: 'hard_stop',
      },
      schedulerEnabled: false,
      currentPlanVersion: 0,
      managerModelId: null,
      workerModelId: null,
      lastActivityAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    };
    doc.save = jest.fn().mockImplementation(async () => {
      Object.assign(saved, doc);
      return saved;
    });
    return doc;
  };

  const makePatchService = (streamDoc: any) => {
    const streamModel = {
      create: jest.fn(),
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(streamDoc) }),
      find: jest.fn(),
      findOne: jest.fn(() => chainableQuery(null)),
    };
    const workspaceModel = { create: jest.fn(), findOne: jest.fn() };
    const agentRepository = { create: jest.fn(), findByNameAndOwner: jest.fn(), deleteByIdAndOwner: jest.fn() };
    const agentTypeService = { findBySlug: jest.fn() };
    const connection = makeConnection();
    const workspaceService = { delete: jest.fn() };
    const workspaceDocuments = { deleteAllByWorkspace: jest.fn() };
    const config = { get: jest.fn((_k: string, fb?: number) => fb ?? 0) } as unknown as ConfigService;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const grpcClient = { createSession: jest.fn().mockResolvedValue('sess-xyz') };
    const service = new WorkyStreamService(
      streamModel as any,
      agentRepository as any,
      connection as any,
      agentTypeService as any,
      workspaceService as any,
      workspaceDocuments as any,
      config,
      logger as any,
      grpcClient as any,
    );
    return { service, streamDoc };
  };

  it('persists managerModelId and workerModelId from the PATCH DTO', async () => {
    const streamDoc = buildStreamDoc();
    const { service } = makePatchService(streamDoc);
    const result = await service.patch(userId, streamObjectId.toString(), {
      managerModelId: 'gpt-4o-mini',
      workerModelId: 'claude-3-5-sonnet-20240620',
    } as any);
    expect(result.managerModelId).toBe('gpt-4o-mini');
    expect(result.workerModelId).toBe('claude-3-5-sonnet-20240620');
    expect(streamDoc.save).toHaveBeenCalledTimes(1);
  });

  it('clears a persistent selection when the DTO passes null', async () => {
    const streamDoc = buildStreamDoc({
      managerModelId: 'gpt-4o-mini',
      workerModelId: 'claude-3-5-sonnet-20240620',
    });
    const { service } = makePatchService(streamDoc);
    const result = await service.patch(userId, streamObjectId.toString(), {
      managerModelId: null,
    } as any);
    expect(result.managerModelId).toBeNull();
    expect(result.workerModelId).toBe('claude-3-5-sonnet-20240620');
  });

  it('is a no-op when neither model field is in the DTO', async () => {
    const streamDoc = buildStreamDoc({
      managerModelId: 'gpt-4o-mini',
      workerModelId: 'claude-3-5-sonnet-20240620',
    });
    const before = streamDoc.lastActivityAt;
    const { service } = makePatchService(streamDoc);
    const result = await service.patch(userId, streamObjectId.toString(), {} as any);
    expect(result.managerModelId).toBe('gpt-4o-mini');
    expect(result.workerModelId).toBe('claude-3-5-sonnet-20240620');
    expect(streamDoc.lastActivityAt).toEqual(before);
  });

});

describe('WorkyStreamService.findAllForUser', () => {
  const userObjectId = new Types.ObjectId();
  const userId = userObjectId.toString();
  const streamAId = new Types.ObjectId();
  const streamBId = new Types.ObjectId();

  const buildStreamDoc = (id: Types.ObjectId, overrides: Record<string, unknown> = {}) => ({
    _id: id,
    ownerUserId: userObjectId,
    workspaceId: new Types.ObjectId(),
    artifactWorkspaceId: null,
    managerAgentId: null,
    managerModelId: null,
    workerModelId: null,
    governancePolicyRef: null,
    title: 'Stream',
    status: 'active',
    controlState: 'active',
    schedulerEnabled: false,
    currentPlanVersion: 1,
    executionPlanVersion: null,
    budget: { limitUsd: 10, limitTokens: 0, spendUsd: 4, tokensUsed: 0, enforcement: 'hard_stop' },
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: null,
    activeDurationMinutes: 134,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    lastActivityAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  });

  const makeService = (opts: {
    streams?: unknown[];
    total?: number;
      statusAgg?: unknown[];
      laneAgg?: unknown[];
      blockerAgg?: unknown[];
  } = {}) => {
    const streams = opts.streams ?? [buildStreamDoc(streamAId), buildStreamDoc(streamBId)];
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(streams),
    };
    const streamModel = {
      create: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(() => findChain),
      countDocuments: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(opts.total ?? streams.length) })),
      aggregate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(opts.statusAgg ?? []) })),
    };
      const taskAggregate = jest.fn((pipeline: Array<Record<string, any>>) => ({
        exec: jest.fn().mockResolvedValue(pipeline.some((stage) => stage.$group?._id === '$streamId') ? opts.blockerAgg ?? [] : opts.laneAgg ?? []),
      }));
    const connection = { model: jest.fn(() => ({ aggregate: taskAggregate })) };
    const workspaceModel = { create: jest.fn(), findOne: jest.fn() };
    const agentRepository = { create: jest.fn(), findByNameAndOwner: jest.fn(), deleteByIdAndOwner: jest.fn() };
    const agentTypeService = { findBySlug: jest.fn() };
    const workspaceService = { delete: jest.fn() };
    const workspaceDocuments = { deleteAllByWorkspace: jest.fn() };
    const config = { get: jest.fn((_k: string, fb?: number) => fb ?? 0) } as unknown as ConfigService;
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const grpcClient = { createSession: jest.fn() };
    const service = new WorkyStreamService(
      streamModel as any,
      agentRepository as any,
      connection as any,
      agentTypeService as any,
      workspaceService as any,
      workspaceDocuments as any,
      config,
      logger as any,
      grpcClient as any,
    );
    return { service, streamModel, findChain, connection, taskAggregate };
  };

  it('returns a paginated envelope with meta (total, page, limit, totalPages)', async () => {
    const { service } = makeService({ total: 25 });

    const result = await service.findAllForUser(userId, { page: 2, limit: 12 } as any);

    expect(result.meta).toMatchObject({ total: 25, page: 2, limit: 12, totalPages: 3 });
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  it('paginates with the correct skip/limit and default sort', async () => {
    const { service, findChain, streamModel } = makeService();

    await service.findAllForUser(userId, { page: 3, limit: 10 } as any);

    expect(findChain.skip).toHaveBeenCalledWith(20);
    expect(findChain.limit).toHaveBeenCalledWith(10);
    expect(findChain.sort).toHaveBeenCalledWith(expect.objectContaining({ lastActivityAt: -1 }));
    // Owner and direct stream shares are both visible.
    expect(streamModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ $or: expect.any(Array) }),
    );
  });

  it('merges per-stream lane counts into stats with progress = done/total', async () => {
    const laneAgg = [
      { _id: { streamId: streamAId, lane: 'done' }, count: 3 },
      { _id: { streamId: streamAId, lane: 'running' }, count: 2 },
      { _id: { streamId: streamAId, lane: 'blocked' }, count: 1 },
    ];
    const { service } = makeService({ laneAgg });

    const result = await service.findAllForUser(userId, {} as any);
    const a = result.data.find((s) => s.id === streamAId.toString());

    expect(a?.stats).toEqual({
      totalTasks: 6,
      running: 2,
      done: 3,
      blocked: 1,
      failed: 0,
      progress: 0.5,
    });
  });

  it('gives streams with no tasks a zeroed stats block', async () => {
    const { service } = makeService({ laneAgg: [] });

    const result = await service.findAllForUser(userId, {} as any);

    expect(result.data[0].stats).toEqual({
      totalTasks: 0,
      running: 0,
      done: 0,
      blocked: 0,
      failed: 0,
      progress: 0,
    });
  });

    it('applies the status filter to the list query but not to statusCounts', async () => {
    const { service, streamModel } = makeService({
      statusAgg: [
        { _id: 'active', count: 5 },
        { _id: 'paused', count: 2 },
      ],
    });

    const result = await service.findAllForUser(userId, { status: ['active'] } as any);

    // The data/count query is filtered by status...
    expect(streamModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: ['active'] } }),
    );
    // ...but statusCounts reflects the full (status-unfiltered) scope.
    expect(result.meta.statusCounts).toEqual({ active: 5, paused: 2 });
    const statusAggMatch = (streamModel.aggregate.mock.calls as any[])[0][0][0].$match;
      expect(statusAggMatch.status).toBeUndefined();
    });

    it('counts and filters attention from waiting statuses and task blockers within the visible scope', async () => {
      const { service, streamModel, taskAggregate } = makeService({
        statusAgg: [
          { _id: 'created', count: 1, ids: [streamAId] },
          { _id: 'waiting_for_human', count: 1, ids: [streamBId] },
        ],
        blockerAgg: [{ _id: streamAId }],
      });

      const result = await service.findAllForUser(userId, { attention: true } as any);

      expect(result.meta.attentionCount).toBe(2);
      expect(streamModel.find).toHaveBeenCalledWith(expect.objectContaining({
        _id: { $in: expect.arrayContaining([streamAId, streamBId]) },
      }));
      expect(taskAggregate).toHaveBeenCalledWith(expect.arrayContaining([
        { $match: { streamId: { $in: [streamAId, streamBId] }, lane: { $in: ['blocked', 'failed'] } } },
      ]));
    });

  it('applies search and created-date bounds to the filter', async () => {
    const { service, streamModel } = makeService();

    await service.findAllForUser(userId, {
      search: 'report',
      createdFrom: '2026-01-01T00:00:00.000Z',
      createdTo: '2026-02-01T00:00:00.000Z',
    } as any);

    const filter = (streamModel.find.mock.calls as any[])[0][0];
    expect(filter.title.$regex).toContain('report');
    expect(filter.createdAt.$gte).toBeInstanceOf(Date);
    expect(filter.createdAt.$lte).toBeInstanceOf(Date);
  });

  it('sorts by created ascending when requested', async () => {
    const { service, findChain } = makeService();

    await service.findAllForUser(userId, { sort: 'created', sortDir: 'asc' } as any);

    expect(findChain.sort).toHaveBeenCalledWith({ createdAt: 1 });
  });
});

describe('WorkyStreamService.delete', () => {
  const userObjectId = new Types.ObjectId();
  const streamObjectId = new Types.ObjectId();
  const artifactWorkspaceId = new Types.ObjectId();
  const managerAgentId = new Types.ObjectId();
  const userId = userObjectId.toString();

  const makeDeleteService = (streamDoc: any) => {
    const streamModel = {
      create: jest.fn(),
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(streamDoc) }),
      find: jest.fn(),
      findOne: jest.fn(),
      deleteOne: jest.fn(() => writeQuery()),
    };
    const workspaceModel = { create: jest.fn(), findOne: jest.fn() };
    const agentRepository = { create: jest.fn(), findByNameAndOwner: jest.fn(), deleteByIdAndOwner: jest.fn().mockResolvedValue(undefined) };
    const agentTypeService = { findBySlug: jest.fn() };
    const connection = makeConnection();
    const workspaceService = { delete: jest.fn() };
    const workspaceDocuments = { deleteAllByWorkspace: jest.fn() };
    const config = { get: jest.fn((_k: string, fb?: number) => fb ?? 0) } as unknown as ConfigService;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const grpcClient = { createSession: jest.fn().mockResolvedValue('sess-xyz') };
    const service = new WorkyStreamService(
      streamModel as any,
      agentRepository as any,
      connection as any,
      agentTypeService as any,
      workspaceService as any,
      workspaceDocuments as any,
      config,
      logger as any,
      grpcClient as any,
    );
    return { service, streamModel, agentRepository, connection, workspaceService, workspaceDocuments };
  };

  it('deletes the stream, manager agent, stream records, and artifact workspace', async () => {
    const streamDoc = {
      _id: streamObjectId,
      ownerUserId: userObjectId,
      artifactWorkspaceId,
      managerAgentId,
    };
    const { service, streamModel, agentRepository, connection, workspaceService, workspaceDocuments } = makeDeleteService(streamDoc);

    const result = await service.delete(userId, streamObjectId.toString());

    expect(result).toEqual({ ok: true, deletedWorkspaceId: artifactWorkspaceId.toString() });
    expect(streamModel.deleteOne).toHaveBeenCalledWith({ _id: streamObjectId });
    expect(agentRepository.deleteByIdAndOwner).toHaveBeenCalledWith(String(managerAgentId), String(userObjectId));
    expect(workspaceDocuments.deleteAllByWorkspace).toHaveBeenCalledWith(artifactWorkspaceId.toString());
    expect(workspaceService.delete).toHaveBeenCalledWith(artifactWorkspaceId.toString(), userId);
    expect(connection.models.has('WorkyGovernancePolicy')).toBe(false);
    expect(connection.models.get('WorkyMemoryProposal')?.deleteMany).toHaveBeenCalledWith({ sourceStreamId: streamObjectId });
    expect(connection.models.get('WorkyMemoryEntry')?.deleteMany).toHaveBeenCalledWith({ sourceStreamId: streamObjectId });
    expect(connection.models.get('WorkyTaskResult')?.deleteMany).toHaveBeenCalledWith({ taskId: { $in: expect.any(Array) } });
    expect(connection.models.get('WorkyTask')?.deleteMany).toHaveBeenCalledWith({ streamId: streamObjectId });
    expect(connection.models.get('WorkyMessage')?.deleteMany).toHaveBeenCalledWith({ streamId: streamObjectId });
  });

  it('rejects deletion by a non-owner', async () => {
    const { service, streamModel } = makeDeleteService({
      _id: streamObjectId,
      ownerUserId: new Types.ObjectId(),
      artifactWorkspaceId,
      managerAgentId,
    });

    await expect(service.delete(userId, streamObjectId.toString())).rejects.toMatchObject({ code: 'ERR_3501' });
    expect(streamModel.deleteOne).not.toHaveBeenCalled();
  });
});
