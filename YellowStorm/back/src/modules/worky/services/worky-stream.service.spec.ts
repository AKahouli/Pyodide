import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { WorkyStreamService } from './worky-stream.service';

describe('WorkyStreamService.create', () => {
  const userId = new Types.ObjectId().toString();

  const chainableQuery = (resolved: unknown) => {
    const chain: { lean: jest.Mock; exec: jest.Mock } = {
      lean: jest.fn(),
      exec: jest.fn(),
    };
    chain.lean.mockReturnValue(chain);
    chain.exec.mockResolvedValue(resolved);
    return chain;
  };

  const makeService = (overrides: {
    streamCreate?: jest.Mock;
    workspaceCreate?: jest.Mock;
    agentCreate?: jest.Mock;
    workspaceFindOne?: jest.Mock;
    agentFindOne?: jest.Mock;
    agentTypeFindBySlug?: jest.Mock;
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

    const streamModel = { create: streamCreate, findById: jest.fn(), find: jest.fn(), findOne: jest.fn() };
    const workspaceModel = { create: workspaceCreate, findOne: workspaceFindOne };
    const agentModel = { create: agentCreate, findOne: agentFindOne };
    const agentTypeService = { findBySlug: agentTypeFindBySlug };
    const config = { get: jest.fn((key: string, fallback?: number) => fallback ?? 0) } as unknown as ConfigService;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const service = new WorkyStreamService(
      streamModel as any,
      workspaceModel as any,
      agentModel as any,
      agentTypeService as any,
      config,
      logger as any,
    );
    return { service, streamCreate, workspaceCreate, agentCreate, workspaceFindOne, agentFindOne };
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
});
