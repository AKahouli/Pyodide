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
    const agentFindOne = overrides.agentFindOne ?? jest.fn(() => chainableQuery(null));
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
    const agentModel = { create: agentCreate, findOne: agentFindOne };
    const agentTypeService = { findBySlug: agentTypeFindBySlug };
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
      workspaceModel as any,
      agentModel as any,
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

  it('provisions a dedicated artifact workspace and a per-stream Manager agent', async () => {
    const { service, streamCreate, workspaceCreate, agentCreate } = makeService();

    const result = await service.create(userId, { title: 'Benchmark analysis' });

    expect(workspaceCreate).toHaveBeenCalledTimes(1);
    const workspaceInput = workspaceCreate.mock.calls[0][0];
    const workspaceResolved = await workspaceCreate.mock.results[0].value;
    expect(workspaceInput.createdBy.toString()).toBe(userId);
    expect(workspaceInput.alias.startsWith('worky-benchmark-analysis')).toBe(true);
    expect(workspaceInput.isSystem).toBe(false);
    expect(workspaceInput.isPersonal).toBe(false);
    expect(workspaceInput.storagePrefix).toBe(workspaceInput.alias);

    expect(agentCreate).toHaveBeenCalledTimes(1);
    const agentInput = agentCreate.mock.calls[0][0];
    const agentResolved = await agentCreate.mock.results[0].value;
    expect(agentInput.createdBy.toString()).toBe(userId);
    expect(agentInput.name.startsWith('Worky Manager')).toBe(true);
    expect(agentInput.isDefault).toBe(false);
    expect(agentInput.isActive).toBe(true);

    expect(streamCreate).toHaveBeenCalledTimes(1);
    const streamInput = streamCreate.mock.calls[0][0];
    expect(streamInput.ownerUserId.toString()).toBe(userId);
    expect(streamInput.title).toBe('Benchmark analysis');
    expect(streamInput.artifactWorkspaceId.toString()).toBe(workspaceResolved._id.toString());
    expect(streamInput.managerAgentId.toString()).toBe(agentResolved._id.toString());
    expect(streamInput.status).toBe('created');
    expect(streamInput.controlState).toBe('active');
    expect(streamInput.budget.enforcement).toBe('hard_stop');

    expect(result.artifactWorkspaceId).toBe(workspaceResolved._id.toString());
    expect(result.managerAgentId).toBe(agentResolved._id.toString());
    expect(result.title).toBe('Benchmark analysis');
    expect(result.status).toBe('created');
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

  it('rejects when the Worky Manager agent type is missing', async () => {
    const { service } = makeService({
      agentTypeFindBySlug: jest.fn().mockResolvedValue(null),
    });

    let caught: unknown;
    try {
      await service.create(userId, { title: 'No agent type' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe('ERR_2300');
  });

  it('disambiguates duplicate workspace aliases', async () => {
    const workspaceCreate = jest.fn((doc) => Promise.resolve({ _id: new Types.ObjectId(), ...doc }));
    const existingChain = (alias: string | null) => {
      const chain: { lean: jest.Mock; exec: jest.Mock } = { lean: jest.fn(), exec: jest.fn() };
      chain.lean.mockReturnValue(chain);
      chain.exec.mockResolvedValue(alias ? { alias } : null);
      return chain;
    };
    const findOne = jest
      .fn()
      .mockReturnValueOnce(existingChain('worky-dup'))
      .mockReturnValueOnce(existingChain('worky-dup-1'))
      .mockReturnValueOnce(existingChain(null));
    const { service } = makeService({
      workspaceCreate,
      workspaceFindOne: findOne,
    });

    await service.create(userId, { title: 'dup' });

    expect(workspaceCreate.mock.calls[0][0].alias).toBe('worky-dup-2');
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
    const updateOne = jest.fn(() => writeQuery({ acknowledged: true }));
    const streamModel = {
      create: jest.fn(),
      findById: jest.fn().mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(findByIdResolved) }),
      }),
      find: jest.fn(),
      findOne: jest.fn(),
      updateOne,
    };
    const workspaceModel = { create: jest.fn(), findOne: jest.fn() };
    const agentModel = { create: jest.fn(), findOne: jest.fn() };
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
      workspaceModel as any,
      agentModel as any,
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
      managerModelId: 'anthropic/claude-3-5-sonnet',
    });

    const res = await service.ensureKickoffContext(streamId, userId);

    expect(res).toEqual({ aiSessionId: 'sess-existing', managerModelId: 'anthropic/claude-3-5-sonnet' });
    expect(grpcClient.createSession).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('lazily creates and persists a session when aiSessionId is null', async () => {
    const { service, grpcClient, updateOne } = makeEnsureService({
      aiSessionId: null,
      managerModelId: null,
    });

    const res = await service.ensureKickoffContext(streamId, userId);

    expect(grpcClient.createSession).toHaveBeenCalledWith(userId);
    expect(updateOne).toHaveBeenCalledWith({ _id: streamId }, { $set: { aiSessionId: 'sess-new' } });
    expect(res).toEqual({ aiSessionId: 'sess-new', managerModelId: null });
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
    const agentModel = { create: jest.fn(), findOne: jest.fn() };
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
      workspaceModel as any,
      agentModel as any,
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
    const agentModel = { create: jest.fn(), findOne: jest.fn(), deleteOne: jest.fn(() => writeQuery()) };
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
      workspaceModel as any,
      agentModel as any,
      connection as any,
      agentTypeService as any,
      workspaceService as any,
      workspaceDocuments as any,
      config,
      logger as any,
      grpcClient as any,
    );
    return { service, streamModel, agentModel, connection, workspaceService, workspaceDocuments };
  };

  it('deletes the stream, manager agent, stream records, and artifact workspace', async () => {
    const streamDoc = {
      _id: streamObjectId,
      ownerUserId: userObjectId,
      artifactWorkspaceId,
      managerAgentId,
    };
    const { service, streamModel, agentModel, connection, workspaceService, workspaceDocuments } = makeDeleteService(streamDoc);

    const result = await service.delete(userId, streamObjectId.toString());

    expect(result).toEqual({ ok: true, deletedWorkspaceId: artifactWorkspaceId.toString() });
    expect(streamModel.deleteOne).toHaveBeenCalledWith({ _id: streamObjectId });
    expect(agentModel.deleteOne).toHaveBeenCalledWith({ _id: managerAgentId, createdBy: userObjectId });
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
