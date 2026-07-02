import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { AgentService } from './agent.service';
import { IAgentForStream } from './interfaces/agent.interface';
import { ISkillResponse } from '../skill/interfaces/skill.interface';

describe('AgentService connector skill inheritance', () => {
  const userId = 'user-1';

  const createSkill = (id: string): ISkillResponse => ({
    id,
    name: id,
    description: `${id} description`,
    icon: '',
    color: '',
    iconColor: 'light',
    categoryId: null,
    license: 'internal',
    compatibility: 'all',
    metadata: {},
    allowedTools: [],
    instructions: `${id} instructions`,
    files: [],
    isActive: true,
    createdBy: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const createService = () => {
    const agentModel = {
      find: jest.fn(),
      findById: jest.fn(),
    };
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };
    const toolService = {
      findByIds: jest.fn().mockResolvedValue([]),
    };
    const agentTypeService = {
      resolvePromptsInBatch: jest.fn().mockResolvedValue(new Map()),
      findAllActive: jest.fn().mockResolvedValue([]),
    };
    const modelsService = {
      findById: jest.fn(),
      getDefaultModel: jest.fn().mockResolvedValue(null),
      getModelIdentifier: jest.fn((model: { id?: string; litellmModel?: string } | null | undefined) =>
        model?.litellmModel || model?.id || ''),
    };
    const skillService = {
      findByIds: jest.fn(),
    };
    const connectorService = {
      findByIds: jest.fn(),
    };
    const connectorAuthService = {
      resolveRuntimeAuth: jest.fn(),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const connectedAppTokenService = {
      getValidToken: jest.fn(),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: string) => fallback ?? ''),
    };
    const teamService = {
      removeAgentFromAllTeams: jest.fn().mockResolvedValue(undefined),
    };
    const agentShareService = {
      getShareInfoMapForUser: jest.fn().mockResolvedValue(new Map()),
      getShareInfo: jest.fn().mockResolvedValue(null),
      getSharePermission: jest.fn().mockResolvedValue(null),
      removeAllSharesForAgent: jest.fn().mockResolvedValue(undefined),
    };

    const service = new AgentService(
      agentModel as any,
      logger as any,
      toolService as any,
      agentTypeService as any,
      modelsService as any,
      skillService as any,
      connectorService as any,
      connectorAuthService as any,
      connectedAppTokenService as any,
      configService as unknown as ConfigService,
      teamService as any,
      agentShareService as any,
    );

    jest.spyOn(service as any, 'buildToolsWithTokens').mockResolvedValue([]);

    return {
      service,
      agentModel,
      skillService,
      connectorService,
      agentTypeService,
      modelsService,
      agentShareService,
    };
  };

  const mockFindById = (agentModel: { findById: jest.Mock }, doc: unknown) => {
    agentModel.findById.mockReturnValue({
      select: () => ({ lean: () => ({ exec: () => Promise.resolve(doc) }) }),
    });
  };

  it('injects connector skills into stream agent runtime', async () => {
    const { service, skillService, connectorService, agentTypeService } = createService();
    const streamAgent: IAgentForStream = {
      id: 'agent-1',
      name: 'Agent 1',
      agentTypeName: 'Worker',
      agentTypeSlug: 'worker',
      agentTypeId: 'type-1',
      role: 'Role',
      description: '',
      temperature: 0,
      model: 'model-1',
      instruction: 'Follow instructions',
      ignorePrePrompt: false,
      knowledgeBases: [],
      toolIds: [],
      connectorIds: ['connector-1'],
      connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: ['run_code'] }],
      skillIds: ['agent-skill'],
      disabledSkillIds: ['disabled-skill'],
      agentTypeSkillIds: ['type-skill'],
      isDefault: true,
      isDefaultForType: false,
    };

    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([streamAgent]);
    jest.spyOn(service as any, 'resolveManager').mockReturnValue(undefined);

    connectorService.findByIds.mockResolvedValue([
      {
        id: 'connector-1',
        name: 'Connector 1',
        actions: [
          { key: 'run_code', label: 'Run code', description: '', isEnabled: true },
          { key: 'upload_file', label: 'Upload file', description: '', isEnabled: true },
        ],
        referencedSkillIds: ['connector-skill', 'disabled-skill'],
      },
    ]);
    skillService.findByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => createSkill(id)),
    );

    const result = await service.buildAgentsForStream(userId, undefined, undefined, undefined, undefined, undefined);

    expect(agentTypeService.resolvePromptsInBatch).toHaveBeenCalled();
    expect(skillService.findByIds).toHaveBeenCalledWith([
      'type-skill',
      'agent-skill',
      'connector-skill',
      'disabled-skill',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].tools.map((tool) => tool.name)).toEqual(['connector_connector-1_run_code']);
    expect(result[0].skills?.map((skill) => skill.id as string)).toEqual([
      'type-skill',
      'agent-skill',
      'connector-skill',
    ]);
  });

  it('injects connector skills into playbook agent runtime', async () => {
    const { service, agentModel, skillService, connectorService } = createService();
    const objectId = new Types.ObjectId();
    agentModel.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: objectId,
              name: 'Agent 1',
              role: 'Role',
              description: '',
              temperature: 0,
              llmModel: 'model-1',
              instruction: 'Follow instructions',
              ignorePrePrompt: false,
              knowledgeBases: [],
              tools: [],
              skills: [new Types.ObjectId('111111111111111111111111')],
              disabledSkills: [],
              connectors: [new Types.ObjectId('222222222222222222222222')],
              isDefault: false,
              isDefaultForType: false,
              agentType: {
                _id: new Types.ObjectId('333333333333333333333333'),
                name: 'Worker',
                slug: 'worker',
                skills: [new Types.ObjectId('444444444444444444444444')],
              },
            },
          ]),
        }),
      }),
    });

    connectorService.findByIds.mockResolvedValue([
      {
        id: '222222222222222222222222',
        name: 'Connector 1',
        actions: [
          { key: 'run_code', label: 'Run code', description: '', isEnabled: true },
          { key: 'upload_file', label: 'Upload file', description: '', isEnabled: true },
        ],
        referencedSkillIds: ['connector-skill'],
      },
    ]);
    skillService.findByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => createSkill(id)),
    );

    const result = await service.buildGrpcAgentsForPlaybook(userId, [objectId.toString()]);

    expect(skillService.findByIds).toHaveBeenCalledWith([
      '444444444444444444444444',
      '111111111111111111111111',
      'connector-skill',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].tools.map((tool) => tool.name)).toEqual([
      'connector_222222222222222222222222_run_code',
      'connector_222222222222222222222222_upload_file',
    ]);
    expect(result[0].skills?.map((skill) => skill.id as string)).toEqual([
      '444444444444444444444444',
      '111111111111111111111111',
      'connector-skill',
    ]);
  });

  it('falls back to the admin default model when the agent has no model set', async () => {
    const { service, agentModel, modelsService } = createService();
    modelsService.getDefaultModel.mockResolvedValue({ id: 'admin-default-id' } as any);
    modelsService.findById.mockResolvedValue({ id: 'admin-default-id' } as any);

    const objectId = new Types.ObjectId();
    agentModel.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: objectId,
              name: 'Agent NoModel',
              role: 'Role',
              description: '',
              temperature: 0,
              instruction: 'Follow instructions',
              ignorePrePrompt: true,
              knowledgeBases: [],
              tools: [],
              skills: [],
              disabledSkills: [],
              connectors: [],
              isDefault: false,
              isDefaultForType: false,
              agentType: {
                _id: new Types.ObjectId('333333333333333222222222'),
                name: 'Worker',
                slug: 'worker',
                skills: [],
              },
            },
          ]),
        }),
      }),
    });

    const result = await service.buildGrpcAgentsForPlaybook(userId, [objectId.toString()]);

    expect(modelsService.getDefaultModel).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].chatbot.model).toBe('admin-default-id');
  });

  it('prefers fallbackModelId over the admin default when the agent has no model set', async () => {
    const { service, agentModel, modelsService } = createService();
    modelsService.getDefaultModel.mockResolvedValue({ id: 'admin-default-id' } as any);
    modelsService.findById.mockResolvedValue({ id: 'explicit-fallback' } as any);

    const objectId = new Types.ObjectId();
    agentModel.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: objectId,
              name: 'Agent NoModel',
              role: 'Role',
              description: '',
              temperature: 0,
              instruction: 'Follow instructions',
              ignorePrePrompt: true,
              knowledgeBases: [],
              tools: [],
              skills: [],
              disabledSkills: [],
              connectors: [],
              isDefault: false,
              isDefaultForType: false,
              agentType: {
                _id: new Types.ObjectId('333333333333333222222222'),
                name: 'Worker',
                slug: 'worker',
                skills: [],
              },
            },
          ]),
        }),
      }),
    });

    const result = await service.buildGrpcAgentsForPlaybook(
      userId,
      [objectId.toString()],
      'explicit-fallback',
    );

    expect(modelsService.getDefaultModel).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].chatbot.model).toBe('explicit-fallback');
  });

  describe('canWriteAgent', () => {
    it('allows the owner of a custom agent', async () => {
      const { service, agentModel } = createService();
      mockFindById(agentModel, { createdBy: userId, isDefault: false });
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(true);
    });

    it('denies a default agent', async () => {
      const { service, agentModel } = createService();
      mockFindById(agentModel, { createdBy: 'someone', isDefault: true });
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(false);
    });

    it('denies a non-owner shared at read level', async () => {
      const { service, agentModel, agentShareService } = createService();
      mockFindById(agentModel, { createdBy: 'other-user', isDefault: false });
      agentShareService.getSharePermission.mockResolvedValue('read');
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(false);
    });

    it('allows a non-owner shared at write level', async () => {
      const { service, agentModel, agentShareService } = createService();
      mockFindById(agentModel, { createdBy: 'other-user', isDefault: false });
      agentShareService.getSharePermission.mockResolvedValue('write');
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(true);
    });

    it('denies when the agent does not exist', async () => {
      const { service, agentModel } = createService();
      mockFindById(agentModel, null);
      await expect(service.canWriteAgent(userId, 'missing')).resolves.toBe(false);
    });
  });

  describe('applySmartMemoryFlag', () => {
    it('flags only agents that reference a smart-memory connector', async () => {
      const { service, connectorService } = createService();
      connectorService.findByIds.mockResolvedValue([
        { id: 'c1', slug: 'smart-memory' },
        { id: 'c2', slug: 'github' },
      ]);
      const responses = [
        { id: 'a1', connectors: ['c1', 'c2'], hasSmartMemory: false },
        { id: 'a2', connectors: ['c2'], hasSmartMemory: false },
        { id: 'a3', connectors: [], hasSmartMemory: false },
      ];

      await (service as any).applySmartMemoryFlag(responses);

      expect(responses[0].hasSmartMemory).toBe(true);
      expect(responses[1].hasSmartMemory).toBe(false);
      expect(responses[2].hasSmartMemory).toBe(false);
    });

    it('does nothing when no connector is referenced', async () => {
      const { service, connectorService } = createService();
      const responses = [{ id: 'a1', connectors: [], hasSmartMemory: false }];

      await (service as any).applySmartMemoryFlag(responses);

      expect(connectorService.findByIds).not.toHaveBeenCalled();
      expect(responses[0].hasSmartMemory).toBe(false);
    });
  });
});
