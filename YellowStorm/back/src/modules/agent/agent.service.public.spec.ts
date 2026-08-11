import { Types } from 'mongoose';
import { AgentService } from './agent.service';
import { AgentRecord } from './repositories/agent-record.mapper';

describe('AgentService.findHumainAgentsPublic', () => {
  const humainTypeId = new Types.ObjectId().toString();

  const makeRecord = (over: Partial<AgentRecord> = {}): AgentRecord => ({
    _id: new Types.ObjectId().toString(),
    name: 'Agent', slug: 'agent', agentType: humainTypeId, agentTypeSlug: 'humain',
    role: 'Role', description: '', temperature: 0, llmModel: undefined, email: undefined,
    instruction: '', ignorePrePrompt: false, knowledgeBases: [], tools: [], skills: [],
    disabledSkills: [], connectors: [], connectorActionSelections: [], guardrails: {}, deploymentSettings: {},
    enable_temporary_child_agents: false, max_temporary_child_agents: 4,
    isDefault: false, isActive: true, isDefaultForType: false, createdBy: 'admin',
    a2aPublished: false, createdAt: new Date(), updatedAt: new Date(), ...over,
  });

  const createHarness = (opts: {
    humainType?: { id: string; name: string } | null;
    agents?: AgentRecord[];
    total?: number;
  }) => {
    const agentRepository = {
      listHumainPublic: jest.fn().mockResolvedValue({ items: opts.agents ?? [], total: opts.total ?? 0 }),
      findByIds: jest.fn().mockResolvedValue([]),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), warn: jest.fn() };
    const agentTypeService = {
      findBySlug: jest.fn().mockResolvedValue(opts.humainType ?? null),
      getManyForHydration: jest.fn().mockResolvedValue(
        new Map([[humainTypeId, { id: humainTypeId, name: 'Humain', slug: 'humain', skills: [] }]]),
      ),
    };
    const service = new AgentService(
      logger as never,
      {} as never, // toolService
      agentTypeService as never,
      {} as never, // modelsService
      {} as never, // skillService
      {} as never, // connectorService
      {} as never, // connectorAuthService
      {} as never, // connectedAppTokenService
      {} as never, // configService
      {} as never, // teamService
      {} as never, // agentShareService
      {} as never, // guardrailsSettingsService
      agentRepository as never,
      { reindexHumainRole: jest.fn() } as never, // agentRoleEmbedding
    );
    return { service, agentRepository, agentTypeService };
  };

  it('returns an empty page and skips the query when the humain type does not exist', async () => {
    const { service, agentRepository, agentTypeService } = createHarness({ humainType: null });

    const result = await service.findHumainAgentsPublic({});

    expect(agentTypeService.findBySlug).toHaveBeenCalledWith('humain');
    expect(agentRepository.listHumainPublic).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('constrains the query to the humain agent type and paginates the results', async () => {
    const agentRecord = makeRecord({ name: 'Alice', role: 'Support', description: 'Human support agent', agentType: humainTypeId });
    const { service, agentRepository } = createHarness({
      humainType: { id: humainTypeId, name: 'Humain' },
      agents: [agentRecord],
      total: 1,
    });

    const result = await service.findHumainAgentsPublic({ page: 1, limit: 10 });

    const arg = agentRepository.listHumainPublic.mock.calls[0][0];
    expect(arg.agentTypeId).toBe(humainTypeId);
    expect(result.meta.total).toBe(1);
    expect(result.data[0].name).toBe('Alice');
    expect(result.data[0].agentType).toEqual({ id: humainTypeId, name: 'Humain' });
  });

  it('applies case-insensitive substring filters on role, name and description', async () => {
    const { service, agentRepository } = createHarness({
      humainType: { id: humainTypeId, name: 'Humain' },
      agents: [],
      total: 0,
    });

    await service.findHumainAgentsPublic({ role: 'sup', name: 'ali', description: 'help' });

    const arg = agentRepository.listHumainPublic.mock.calls[0][0];
    expect(arg.role).toBe('sup');
    expect(arg.name).toBe('ali');
    expect(arg.description).toBe('help');
  });
});

describe('AgentService.resolveHumainByIds', () => {
  const humainTypeId = new Types.ObjectId().toString();

  const makeRecord = (over: Partial<AgentRecord> = {}): AgentRecord => ({
    _id: new Types.ObjectId().toString(),
    name: 'Agent', slug: 'agent', agentType: humainTypeId, agentTypeSlug: 'humain',
    role: 'Role', description: '', temperature: 0, llmModel: undefined, email: undefined,
    instruction: '', ignorePrePrompt: false, knowledgeBases: [], tools: [], skills: [],
    disabledSkills: [], connectors: [], connectorActionSelections: [], guardrails: {}, deploymentSettings: {},
    enable_temporary_child_agents: false, max_temporary_child_agents: 4,
    isDefault: false, isActive: true, isDefaultForType: false, createdBy: 'someone-else',
    a2aPublished: false, createdAt: new Date(), updatedAt: new Date(), ...over,
  });

  const makeService = (records: AgentRecord[]) => {
    const agentRepository = { findByIds: jest.fn().mockResolvedValue(records) };
    const logger = { setContext: jest.fn(), log: jest.fn(), debug: jest.fn(), warn: jest.fn() };
    const service = new AgentService(
      logger as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      agentRepository as never, { reindexHumainRole: jest.fn() } as never,
    );
    return { service, agentRepository };
  };

  it('returns humain agents by id regardless of owner (no ownership filter)', async () => {
    const rec = makeRecord({ _id: 'a1', name: 'Oussama Knani', slug: 'oussama-knani', role: 'Engineer', createdBy: 'other-user' });
    const { service, agentRepository } = makeService([rec]);

    const result = await service.resolveHumainByIds(['a1']);

    expect(agentRepository.findByIds).toHaveBeenCalledWith(['a1'], { activeOnly: true });
    expect(result).toEqual([{ id: 'a1', name: 'Oussama Knani', slug: 'oussama-knani', role: 'Engineer' }]);
  });

  it('drops non-humain agents so no private agent is leaked', async () => {
    const humain = makeRecord({ _id: 'h1', name: 'Human', agentTypeSlug: 'humain' });
    const other = makeRecord({ _id: 'm1', name: 'Manager', agentTypeSlug: 'manager' });
    const { service } = makeService([humain, other]);

    const result = await service.resolveHumainByIds(['h1', 'm1']);

    expect(result).toEqual([{ id: 'h1', name: 'Human', slug: 'agent', role: 'Role' }]);
  });

  it('returns an empty array and skips the query for an empty id list', async () => {
    const { service, agentRepository } = makeService([]);

    const result = await service.resolveHumainByIds([]);

    expect(result).toEqual([]);
    expect(agentRepository.findByIds).not.toHaveBeenCalled();
  });
});
