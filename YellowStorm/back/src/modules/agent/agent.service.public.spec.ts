import { Types } from 'mongoose';
import { AgentService } from './agent.service';

describe('AgentService.findHumainAgentsPublic', () => {
  const humainTypeId = new Types.ObjectId().toString();

  const createHarness = (opts: {
    humainType?: { id: string; name: string } | null;
    agents?: Record<string, unknown>[];
    total?: number;
  }) => {
    const findChain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(opts.agents ?? []),
    };
    const agentModel = {
      find: jest.fn().mockReturnValue(findChain),
      countDocuments: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(opts.total ?? 0) }),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), warn: jest.fn() };
    const agentTypeService = {
      findBySlug: jest.fn().mockResolvedValue(opts.humainType ?? null),
    };
    const service = new AgentService(
      agentModel as never,
      logger as never,
      {} as never,
      agentTypeService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, agentModel, agentTypeService, findChain };
  };

  it('returns an empty page and skips the query when the humain type does not exist', async () => {
    const { service, agentModel, agentTypeService } = createHarness({ humainType: null });

    const result = await service.findHumainAgentsPublic({});

    expect(agentTypeService.findBySlug).toHaveBeenCalledWith('humain');
    expect(agentModel.find).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('constrains the query to the humain agent type and paginates the results', async () => {
    const agentDoc = {
      _id: new Types.ObjectId(),
      name: 'Alice',
      role: 'Support',
      description: 'Human support agent',
      agentType: { _id: new Types.ObjectId(humainTypeId), name: 'Humain' },
    };
    const { service, agentModel } = createHarness({
      humainType: { id: humainTypeId, name: 'Humain' },
      agents: [agentDoc],
      total: 1,
    });

    const result = await service.findHumainAgentsPublic({ page: 1, limit: 10 });

    const filterArg = agentModel.find.mock.calls[0][0];
    expect(filterArg.agentType.toString()).toBe(humainTypeId);
    expect(result.meta.total).toBe(1);
    expect(result.data[0].name).toBe('Alice');
    expect(result.data[0].agentType).toEqual({ id: humainTypeId, name: 'Humain' });
  });

  it('applies case-insensitive substring filters on role, name and description', async () => {
    const { service, agentModel } = createHarness({
      humainType: { id: humainTypeId, name: 'Humain' },
      agents: [],
      total: 0,
    });

    await service.findHumainAgentsPublic({ role: 'sup', name: 'ali', description: 'help' });

    const filterArg = agentModel.find.mock.calls[0][0];
    expect(filterArg.role).toEqual({ $regex: 'sup', $options: 'i' });
    expect(filterArg.name).toEqual({ $regex: 'ali', $options: 'i' });
    expect(filterArg.description).toEqual({ $regex: 'help', $options: 'i' });
  });
});
