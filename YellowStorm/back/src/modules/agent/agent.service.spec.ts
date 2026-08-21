import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { AgentService } from './agent.service';
import { AgentConnectorRuntimeService } from './services/agent-connector-runtime.service';
import { IAgentForStream } from './interfaces/agent.interface';
import { ISkillResponse } from '../skill/interfaces/skill.interface';
import { AgentRecord } from './repositories/agent-record.mapper';

describe('AgentService connector skill inheritance', () => {
  const userId = 'user-1';

  const createSkill = (id: string): ISkillResponse => ({
    id,
    slug: id,
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

  const defaultGuardrails = {
    promptInjection: {
      inputEnabled: false,
      outputEnabled: false,
      mode: 'balanced' as const,
      inputClassifierPrompt: 'input policy',
      outputClassifierPrompt: 'output policy',
      blockMessage: 'I cannot follow this instruction.',
    },
    toolActionReview: {
      enabled: false,
      mode: 'balanced' as const,
      classifierPrompt: 'tool policy',
      blockMessage: 'I cannot perform this action.',
    },
  };

  /** Build a full Mongo-lean-doc-shaped AgentRecord (agentType is a bare id). */
  const makeRecord = (over: Partial<AgentRecord> = {}): AgentRecord => ({
    _id: new Types.ObjectId().toString(),
    name: 'Agent',
    slug: 'agent',
    agentType: '333333333333333333333333',
    agentTypeSlug: 'worker',
    role: 'Role',
    description: '',
    temperature: 0,
    llmModel: undefined,
    email: undefined,
    instruction: '',
    ignorePrePrompt: false,
    knowledgeBases: [],
    tools: [],
    skills: [],
    disabledSkills: [],
    connectors: [],
    connectorActionSelections: [],
    guardrails: {},
    deploymentSettings: {},
    enable_temporary_child_agents: false,
    max_temporary_child_agents: 4,
    isDefault: false,
    isActive: true,
    isDefaultForType: false,
    createdBy: 'admin',
    a2aPublished: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const createService = () => {
    const agentRepository = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
      findByIdDefault: jest.fn().mockResolvedValue(null),
      listUserAgents: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listDefaultAgents: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listHumainPublic: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findForUser: jest.fn().mockResolvedValue([]),
      findByIds: jest.fn().mockResolvedValue([]),
      findByIdsForUser: jest.fn().mockResolvedValue([]),
      findDefaultByType: jest.fn().mockResolvedValue(null),
      findDefaultByNameActive: jest.fn().mockResolvedValue(null),
      findActiveDefaults: jest.fn().mockResolvedValue([]),
      findActiveDefaultsByTypeSlug: jest.fn().mockResolvedValue([]),
      existsActiveDefault: jest.fn().mockResolvedValue(false),
      existsActiveDefaultByTypeSlug: jest.fn().mockResolvedValue(false),
      findActiveDefaultIdBySlug: jest.fn().mockResolvedValue(null),
      countByAgentType: jest.fn().mockResolvedValue(0),
      findByNameAndOwner: jest.fn().mockResolvedValue(null),
      findByNameDefault: jest.fn().mockResolvedValue(null),
      findBySlug: jest.fn().mockResolvedValue(null),
      findByOwnerAndType: jest.fn().mockResolvedValue(null),
      updateById: jest.fn(),
      deleteById: jest.fn().mockResolvedValue(undefined),
      clearDefaultForType: jest.fn().mockResolvedValue(undefined),
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
      findBySlug: jest.fn().mockResolvedValue(null),
      getManyForHydration: jest.fn().mockResolvedValue(new Map()),
    };
    const modelsService = {
      findById: jest.fn(),
      getDefaultModel: jest.fn().mockResolvedValue(null),
      getGuardrailsClassifierModel: jest.fn().mockResolvedValue(null),
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
    const guardrailsSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        forceActivation: false,
        promptInjection: {
          inputEnabled: false,
          outputEnabled: false,
          mode: 'balanced',
          inputClassifierPrompt: 'input policy',
          outputClassifierPrompt: 'output policy',
          blockMessage: 'I cannot follow this instruction.',
        },
        toolActionReview: {
          enabled: false,
          mode: 'balanced',
          classifierPrompt: 'tool policy',
          blockMessage: 'I cannot perform this action.',
        },
      }),
    };

    const agentRoleEmbedding = { reindexHumainRole: jest.fn() };

    const service = new AgentService(
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
      guardrailsSettingsService as any,
      agentRepository as any,
      agentRoleEmbedding as any,
      new AgentConnectorRuntimeService(
        logger as any,
        skillService as any,
        connectorService as any,
        connectorAuthService as any,
        configService as unknown as ConfigService,
      ),
    );

    jest.spyOn(service as any, 'buildToolsWithTokens').mockResolvedValue([]);

    return {
      service,
      agentRepository,
      skillService,
      connectorService,
      agentTypeService,
      modelsService,
      agentShareService,
    };
  };

  it('preserves deployment modes for widget-only updates', () => {
    const { service } = createService();

    const settings = (service as any).normalizeDeploymentSettings(
      { widget: { layout: { desktopWidth: 480, desktopHeight: 720 } } },
      { embedEnabled: true, restEnabled: true, widget: {} },
    );

    expect(settings.embedEnabled).toBe(true);
    expect(settings.restEnabled).toBe(true);
    expect(settings.widget.layout).toEqual({ desktopWidth: 480, desktopHeight: 720 });
  });

  it('injects connector skills into stream agent runtime', async () => {
    const { service, skillService, connectorService, agentTypeService, modelsService } = createService();
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
      guardrails: defaultGuardrails,
      connectorIds: ['connector-1'],
      connectorActionSelections: [{ connectorId: 'connector-1', actionKeys: ['run_code'] }],
      skillIds: ['agent-skill'],
      disabledSkillIds: ['disabled-skill'],
      agentTypeSkillIds: ['type-skill'],
      enable_temporary_child_agents: true,
      max_temporary_child_agents: 6,
      isDefault: true,
      isDefaultForType: false,
    };

    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([streamAgent]);
    jest.spyOn(service as any, 'resolveManager').mockReturnValue(undefined);

    connectorService.findByIds.mockResolvedValue([
      {
        id: 'connector-1',
        name: 'Connector 1',
        slug: 'workspace',
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
    modelsService.getGuardrailsClassifierModel.mockResolvedValue({ id: 'guardrails-classifier', omitTemperature: true });

    const result = await service.buildAgentsForStream(userId, undefined, undefined, undefined, undefined, undefined);

    expect(agentTypeService.resolvePromptsInBatch).toHaveBeenCalled();
    expect(skillService.findByIds).toHaveBeenCalledWith([
      'type-skill',
      'agent-skill',
      'connector-skill',
      'disabled-skill',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].tools.map((tool) => tool.name)).toEqual(['workspace_run_code']);
    expect(JSON.parse(result[0].agent_params?.params.connector_bindings_json as string)[0])
      .toEqual(expect.objectContaining({ connector_slug: 'workspace' }));
    expect(result[0].skills?.map((skill) => skill.id as string)).toEqual([
      'type-skill',
      'agent-skill',
      'connector-skill',
    ]);
    expect(result[0].agent_params?.params).toEqual(expect.objectContaining({
      connector_bindings_json: expect.any(String),
      enable_temporary_child_agents: 'true',
      max_temporary_child_agents: '6',
    }));
    expect(JSON.parse(result[0].agent_params?.params.guardrails_json as string).classifier)
      .toEqual({ omitTemperature: true });
    expect(result[0].agent_params?.params.temperature).toBe('0');
  });

  it('injects trusted actor headers into platform copilot connector bindings', async () => {
    const { service, skillService, connectorService } = createService();
    const platformAgent: IAgentForStream = {
      id: 'platform-agent', name: 'Yellowmind', agentTypeName: 'Platform Copilot',
      agentTypeSlug: 'platform_copilot', agentTypeId: 'type-platform', role: 'Assistant',
      description: '', temperature: 0, model: 'model-1', instruction: '', ignorePrePrompt: false,
      knowledgeBases: [], toolIds: [], guardrails: defaultGuardrails, connectorIds: ['playbook-connector'],
      connectorActionSelections: [], skillIds: [], disabledSkillIds: [], agentTypeSkillIds: [],
      enable_temporary_child_agents: false, max_temporary_child_agents: 4,
      isDefault: true, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([platformAgent]);
    connectorService.findByIds.mockResolvedValue([{
      id: 'playbook-connector', name: 'Playbook', slug: 'playbook',
      actions: [{ key: 'get_playbook', label: 'Get playbook', isEnabled: true }],
    }]);
    skillService.findByIds.mockResolvedValue([]);

    const result = await service.buildAgentsForStream(
      userId,
      undefined,
      ['platform-agent'],
      undefined,
      undefined,
      undefined,
      { conversationId: 'conversation-1', correlationId: 'message-1' },
    );

    const [binding] = JSON.parse(result[0].agent_params?.params.connector_bindings_json as string);
    expect(binding.auth_headers).toEqual(expect.objectContaining({
      'X-YellowStorm-User-Id': userId,
      'X-YellowStorm-Agent-Id': 'platform-agent',
      'X-YellowStorm-Conversation-Id': 'conversation-1',
      'X-Correlation-Id': 'message-1',
    }));
    expect(binding.auth_headers).not.toHaveProperty('X-YellowStorm-Tenant-Id');
  });

  it('resolves the mono-agent directly from the DB even though it is not part of the user\'s roster', async () => {
    const { service, agentRepository, agentTypeService } = createService();

    const workerAgent: IAgentForStream = {
      id: 'agent-worker',
      name: 'Worker',
      agentTypeName: 'Worker',
      agentTypeSlug: 'worker',
      agentTypeId: 'type-worker',
      role: 'Role',
      description: '',
      temperature: 0,
      model: 'model-1',
      instruction: '',
      ignorePrePrompt: false,
      knowledgeBases: [],
      toolIds: [],
      guardrails: defaultGuardrails,
      connectorIds: [],
      connectorActionSelections: [],
      skillIds: [],
      disabledSkillIds: [],
      agentTypeSkillIds: [],
      enable_temporary_child_agents: false,
      max_temporary_child_agents: 4,
      isDefault: true,
      isDefaultForType: false,
    };

    // The user's roster never includes the mono-agent — it's a hidden system default.
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([workerAgent]);
    agentTypeService.findAllActive.mockResolvedValue([
      { id: '555555555555555555555555', slug: 'mono-agent', name: 'Mono Agent' },
    ]);
    agentTypeService.getManyForHydration.mockResolvedValue(
      new Map([['555555555555555555555555', { id: '555555555555555555555555', name: 'Mono Agent', slug: 'mono-agent', skills: [] }]]),
    );
    agentRepository.findDefaultByType.mockResolvedValue(makeRecord({
      name: 'Mono Agent Instance',
      llmModel: 'model-1',
      agentType: '555555555555555555555555',
      agentTypeSlug: 'mono-agent',
      isDefault: true,
    }));

    const result = await service.buildAgentsForStream(userId, undefined, undefined, undefined, undefined, undefined);

    expect(agentRepository.findDefaultByType).toHaveBeenCalledWith('555555555555555555555555');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Mono Agent Instance');
  });

  it('uses the selected model for an untagged mono-agent request', async () => {
    const { service, modelsService, agentTypeService } = createService();
    const monoAgent: IAgentForStream = {
      id: 'mono-agent', name: 'Mono Agent', agentTypeName: 'Mono Agent', agentTypeSlug: 'mono-agent',
      agentTypeId: 'type-mono', role: 'Role', description: '', temperature: 0, model: 'native-model',
      instruction: '', ignorePrePrompt: false, knowledgeBases: [], toolIds: [], guardrails: defaultGuardrails,
      connectorIds: [], connectorActionSelections: [], skillIds: [], disabledSkillIds: [], agentTypeSkillIds: [],
      enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: true, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([]);
    jest.spyOn(service as any, 'resolveDefaultMonoAgent').mockResolvedValue(monoAgent);
    modelsService.findById.mockImplementation(async (id: string) => ({ id, omitTemperature: false }));

    const result = await service.buildAgentsForStream(userId, 'selected-model');

    expect(agentTypeService.resolvePromptsInBatch).toHaveBeenCalledWith([
      { agentTypeId: 'type-mono', modelId: 'selected-model' },
    ]);
    expect(result[0].chatbot.model).toBe('selected-model');
  });

  it('preserves a tagged agent\'s native model over the selected model', async () => {
    const { service, modelsService, agentTypeService } = createService();
    const taggedAgent: IAgentForStream = {
      id: 'tagged-agent', name: 'Tagged Agent', agentTypeName: 'Worker', agentTypeSlug: 'worker',
      agentTypeId: 'type-worker', role: 'Role', description: '', temperature: 0, model: 'native-model',
      instruction: '', ignorePrePrompt: false, knowledgeBases: [], toolIds: [], guardrails: defaultGuardrails,
      connectorIds: [], connectorActionSelections: [], skillIds: [], disabledSkillIds: [], agentTypeSkillIds: [],
      enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: false, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([taggedAgent]);
    modelsService.findById.mockImplementation(async (id: string) => ({ id, omitTemperature: false }));

    const result = await service.buildAgentsForStream(userId, 'selected-model', ['tagged-agent']);

    expect(agentTypeService.resolvePromptsInBatch).toHaveBeenCalledWith([
      { agentTypeId: 'type-worker', modelId: 'native-model' },
    ]);
    expect(result[0].chatbot.model).toBe('native-model');
  });

  it('routes through a single agent when no agent is tagged, even if no "mono-agent" type is configured', async () => {
    const { service, agentTypeService } = createService();

    const agentA: IAgentForStream = {
      id: 'agent-a',
      name: 'Agent A',
      agentTypeName: 'Manager',
      agentTypeSlug: 'manager',
      agentTypeId: 'type-manager',
      role: 'Role',
      description: '',
      temperature: 0,
      model: 'model-1',
      instruction: '',
      ignorePrePrompt: false,
      knowledgeBases: [],
      toolIds: [],
      guardrails: defaultGuardrails,
      connectorIds: [],
      connectorActionSelections: [],
      skillIds: [],
      disabledSkillIds: [],
      agentTypeSkillIds: [],
      enable_temporary_child_agents: false,
      max_temporary_child_agents: 4,
      isDefault: true,
      isDefaultForType: false,
    };
    const agentB: IAgentForStream = {
      ...agentA,
      id: 'agent-b',
      name: 'Agent B',
      agentTypeName: 'Worker',
      agentTypeSlug: 'worker',
      agentTypeId: 'type-worker',
    };

    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([agentA, agentB]);
    // No "mono-agent" agent type configured anywhere.
    agentTypeService.findAllActive.mockResolvedValue([]);

    const result = await service.buildAgentsForStream(userId, undefined, undefined, undefined, undefined, undefined);

    // 0 agents tagged must always resolve to exactly one agent so the caller
    // routes through RunSingleAgent instead of RunAgentTeam.
    expect(result).toHaveLength(1);
    // The manager is an orchestrator, not a standalone chat agent — it must
    // never be the fallback pick when a real mono-agent isn't configured.
    expect(result[0].agent_type).toBe('worker');
  });

  it('resolves an agent shared *with* the user when it is the one tagged', async () => {
    const { service, agentRepository, agentShareService, agentTypeService } = createService();

    // The user's own roster: one owned/default agent. The shared agent is NOT
    // here — getAgentsForUser only returns owned + default agents.
    const ownedAgent: IAgentForStream = {
      id: 'agent-owned', name: 'Owned Agent', agentTypeName: 'Worker', agentTypeSlug: 'worker',
      agentTypeId: 'type-worker', role: 'Role', description: '', temperature: 0, model: '',
      instruction: '', ignorePrePrompt: false, knowledgeBases: [], toolIds: [], guardrails: defaultGuardrails,
      connectorIds: [], connectorActionSelections: [], skillIds: [], disabledSkillIds: [], agentTypeSkillIds: [],
      enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: true, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([ownedAgent]);

    const sharedAgentId = '666666666666666666666666';

    // The user has a share grant for the tagged agent.
    agentShareService.getShareInfoMapForUser.mockResolvedValue(
      new Map([[sharedAgentId, { shareId: 'share-1', permission: 'read', sharedBy: { id: 'owner-1', email: 'owner@x.io' } }]]),
    );
    agentTypeService.getManyForHydration.mockResolvedValue(
      new Map([['333333333333333333333333', { id: '333333333333333333333333', name: 'Worker', slug: 'worker', skills: [] }]]),
    );

    // The agent record is fetched by id from the shared-with-user grant.
    agentRepository.findByIds.mockResolvedValue([
      makeRecord({ _id: sharedAgentId, name: 'Shared Agent', agentType: '333333333333333333333333' }),
    ]);

    const result = await service.buildAgentsForStream(userId, undefined, [sharedAgentId], undefined, undefined, undefined);

    // The tagged shared agent must be the one that runs — not a silent fallback
    // to the owned/default mono-agent.
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Shared Agent');
  });

  it('injects connector skills into playbook agent runtime', async () => {
    const { service, agentRepository, skillService, connectorService, agentTypeService, modelsService } = createService();
    const objectId = new Types.ObjectId();
    agentRepository.findByIds.mockResolvedValue([
      makeRecord({
        _id: objectId.toString(),
        name: 'Agent 1',
        llmModel: 'model-1',
        instruction: 'Follow instructions',
        skills: ['111111111111111111111111'],
        connectors: ['222222222222222222222222'],
        agentType: '333333333333333333333333',
        enable_temporary_child_agents: true,
        max_temporary_child_agents: 5,
      }),
    ]);
    agentTypeService.getManyForHydration.mockResolvedValue(
      new Map([['333333333333333333333333', { id: '333333333333333333333333', name: 'Worker', slug: 'worker', skills: ['444444444444444444444444'] }]]),
    );

    connectorService.findByIds.mockResolvedValue([
      {
        id: '222222222222222222222222',
        name: 'Connector 1',
        slug: 'workspace',
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
    modelsService.getGuardrailsClassifierModel.mockResolvedValue({ id: 'guardrails-classifier', omitTemperature: true });

    const result = await service.buildGrpcAgentsForPlaybook(userId, [objectId.toString()]);

    expect(skillService.findByIds).toHaveBeenCalledWith([
      '444444444444444444444444',
      '111111111111111111111111',
      'connector-skill',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].tools.map((tool) => tool.name)).toEqual([
      'workspace_run_code',
      'workspace_upload_file',
    ]);
    expect(result[0].skills?.map((skill) => skill.id as string)).toEqual([
      '444444444444444444444444',
      '111111111111111111111111',
      'connector-skill',
    ]);
    expect(result[0].agent_params?.params).toEqual(expect.objectContaining({
      connector_bindings_json: expect.any(String),
      enable_temporary_child_agents: 'true',
      max_temporary_child_agents: '5',
    }));
    expect(JSON.parse(result[0].agent_params?.params.guardrails_json as string).classifier)
      .toEqual({ omitTemperature: true });
  });

  it('falls back to the admin default model when the agent has no model set', async () => {
    const { service, agentRepository, modelsService, agentTypeService } = createService();
    modelsService.getDefaultModel.mockResolvedValue({ id: 'admin-default-id' } as any);
    modelsService.getGuardrailsClassifierModel.mockResolvedValue({ id: 'guardrails-classifier', omitTemperature: false });
    modelsService.findById.mockResolvedValue({ id: 'admin-default-id', omitTemperature: false } as any);

    const objectId = new Types.ObjectId();
    agentRepository.findByIds.mockResolvedValue([
      makeRecord({
        _id: objectId.toString(),
        name: 'Agent NoModel',
        instruction: 'Follow instructions',
        ignorePrePrompt: true,
        agentType: '333333333333333222222222',
      }),
    ]);
    agentTypeService.getManyForHydration.mockResolvedValue(
      new Map([['333333333333333222222222', { id: '333333333333333222222222', name: 'Worker', slug: 'worker', skills: [] }]]),
    );

    const result = await service.buildGrpcAgentsForPlaybook(userId, [objectId.toString()]);

    expect(modelsService.getDefaultModel).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].chatbot.model).toBe('admin-default-id');
    expect(result[0].agent_params?.params.temperature).toBe('0');
    expect(JSON.parse(result[0].agent_params?.params.guardrails_json as string).classifier)
      .toEqual({ omitTemperature: false });
  });

  it('prefers fallbackModelId over the admin default when the agent has no model set', async () => {
    const { service, agentRepository, modelsService, agentTypeService } = createService();
    modelsService.getDefaultModel.mockResolvedValue({ id: 'admin-default-id' } as any);
    modelsService.findById.mockResolvedValue({ id: 'explicit-fallback', omitTemperature: true } as any);

    const objectId = new Types.ObjectId();
    agentRepository.findByIds.mockResolvedValue([
      makeRecord({
        _id: objectId.toString(),
        name: 'Agent NoModel',
        instruction: 'Follow instructions',
        ignorePrePrompt: true,
        agentType: '333333333333333222222222',
      }),
    ]);
    agentTypeService.getManyForHydration.mockResolvedValue(
      new Map([['333333333333333222222222', { id: '333333333333333222222222', name: 'Worker', slug: 'worker', skills: [] }]]),
    );

    const result = await service.buildGrpcAgentsForPlaybook(
      userId,
      [objectId.toString()],
      'explicit-fallback',
    );

    expect(modelsService.getDefaultModel).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].chatbot.model).toBe('explicit-fallback');
    expect(result[0].agent_params?.params).toEqual(expect.objectContaining({ omit_temperature: 'true' }));
    expect(result[0].agent_params?.params.temperature).toBeUndefined();
  });

  describe('canWriteAgent', () => {
    it('allows the owner of a custom agent', async () => {
      const { service, agentRepository } = createService();
      agentRepository.findById.mockResolvedValue(makeRecord({ createdBy: userId, isDefault: false }));
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(true);
    });

    it('denies a default agent', async () => {
      const { service, agentRepository } = createService();
      agentRepository.findById.mockResolvedValue(makeRecord({ createdBy: 'someone', isDefault: true }));
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(false);
    });

    it('denies a non-owner shared at read level', async () => {
      const { service, agentRepository, agentShareService } = createService();
      agentRepository.findById.mockResolvedValue(makeRecord({ createdBy: 'other-user', isDefault: false }));
      agentShareService.getSharePermission.mockResolvedValue('read');
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(false);
    });

    it('allows a non-owner shared at write level', async () => {
      const { service, agentRepository, agentShareService } = createService();
      agentRepository.findById.mockResolvedValue(makeRecord({ createdBy: 'other-user', isDefault: false }));
      agentShareService.getSharePermission.mockResolvedValue('write');
      await expect(service.canWriteAgent(userId, 'agent-1')).resolves.toBe(true);
    });

    it('denies when the agent does not exist', async () => {
      const { service, agentRepository } = createService();
      agentRepository.findById.mockResolvedValue(null);
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

  it('uses current connector schemas and removes stale fixed parameters for playbook runtime', async () => {
    const { service, connectorService, skillService } = createService();
    connectorService.findByIds.mockResolvedValue([{
      id: 'connector-1',
      name: 'Search',
      slug: 'search',
      authSourceType: 'none',
      mcpTransportType: 'streamable_http',
      mcpServerUrl: 'https://example.com/mcp',
      mcpServerConfig: {},
      referencedSkillIds: [],
      actions: [{
        key: 'search',
        label: 'Search',
        description: '',
        parameterSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
          additionalProperties: false,
        },
        isEnabled: true,
      }],
    }]);
    skillService.findByIds.mockResolvedValue([]);

    const result = await service.buildGrpcConnectorRuntimeForPlaybook(userId, [{
      connectorId: 'connector-1',
      isEnabled: true,
      actions: [{ actionKey: 'search', isEnabled: true }],
      fixedParams: { limit: 10, removedArg: 'stale' },
    }]);

    expect(result.connector_bindings).toEqual([
      expect.objectContaining({
        connector_slug: 'search',
        fixed_params: { limit: 10 },
        actions: [expect.objectContaining({
          action_key: 'search',
          parameter_schema: {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'number' } },
            additionalProperties: false,
          },
        })],
      }),
    ]);
  });

  it('builds OpenAI-safe connector tool names from slugs', () => {
    const { service } = createService();
    const buildDefs = (service as any).buildConnectorToolDefs.bind(service);

    const invalidCharacterName = buildDefs([{
      connector_id: 'connector-1',
      connector_name: 'Salesforce',
      connector_slug: 'sales@force',
      actions: [{ action_key: 'search/files:v2' }],
    }])[0].name;
    const longName = buildDefs([{
      connector_id: 'connector-2',
      connector_name: 'Enterprise Knowledge',
      connector_slug: 'enterprise-knowledge-connector-with-a-very-long-stable-slug',
      actions: [{ action_key: 'search_documents_with_extended_metadata_and_permissions' }],
    }])[0].name;

    expect(invalidCharacterName).toBe('sales_force_search_files_v2_76fa7386062c04a3');
    expect(longName).toBe('enterprise-knowledge-connector-with-a-very-long_0bb708607e97c779');
    expect(longName).toHaveLength(64);

    const collidingNames = buildDefs([{
      connector_id: 'connector-3',
      connector_name: 'Workspace',
      connector_slug: 'workspace',
      actions: [{ action_key: 'search/files' }, { action_key: 'search:files' }],
    }]).map((tool: { name: string }) => tool.name);
    const controlWhitespaceName = buildDefs([{
      connector_id: 'connector-4',
      connector_name: 'Workspace',
      connector_slug: 'workspace',
      actions: [{ action_key: 'search' }],
    }])[0].name;

    expect(new Set(collidingNames).size).toBe(2);
    expect(controlWhitespaceName).toBe('workspace_search__9e54e0e3d98b6a49');
  });

  it('resolves the explicitly selected active playbook planner', async () => {
    const { service, agentRepository, agentTypeService } = createService();
    const agentId = new Types.ObjectId().toString();
    const agentTypeId = new Types.ObjectId().toString();
    agentRepository.findById.mockResolvedValue(makeRecord({
      _id: agentId,
      agentType: agentTypeId,
      isDefault: true,
      llmModel: 'planner-model',
      temperature: 0.2,
      instruction: 'Plan safely',
      updatedAt: new Date('2026-08-06T00:00:00.000Z'),
    }));
    agentTypeService.findBySlug.mockResolvedValue({ id: agentTypeId, slug: 'playbook_planner' });

    await expect(service.findPlaybookPlannerById(agentId)).resolves.toEqual({
      agentTypeId,
      agentTypeSlug: 'playbook_planner',
      agentId,
      agentRevision: '2026-08-06T00:00:00.000Z',
      model: 'planner-model',
      temperature: 0.2,
      instruction: 'Plan safely',
    });
  });

  it('lists only active playbook planner agents with a configured model', async () => {
    const { service, agentRepository, agentTypeService } = createService();
    const plannerTypeId = new Types.ObjectId().toString();
    agentTypeService.findBySlug.mockResolvedValue({ id: plannerTypeId, slug: 'playbook_planner' });
    agentRepository.findActiveDefaults.mockResolvedValue([
      makeRecord({ name: 'Planner', description: 'Plans generated tasks', llmModel: ' planner-model ', agentType: plannerTypeId, isDefault: true }),
      makeRecord({ name: 'Other', llmModel: 'other-model', agentType: new Types.ObjectId().toString(), isDefault: true }),
    ]);

    await expect(service.listPlaybookPlannerAgentOptions()).resolves.toEqual([
      expect.objectContaining({ name: 'Planner', model: 'planner-model' }),
    ]);
  });

  it('rejects an invalid explicit playbook planner id', async () => {
    const { service, agentRepository } = createService();

    await expect(service.findPlaybookPlannerById('invalid')).rejects.toThrow('selected Playbook Planner agent is invalid');
    expect(agentRepository.findById).not.toHaveBeenCalled();
  });

  it('resolves the explicitly selected active playbook suggestor', async () => {
    const { service, agentRepository, agentTypeService } = createService();
    const agentId = new Types.ObjectId().toString();
    const agentTypeId = new Types.ObjectId().toString();
    agentRepository.findById.mockResolvedValue(makeRecord({
      _id: agentId,
      agentType: agentTypeId,
      isDefault: true,
      llmModel: 'suggestor-model',
      temperature: 0.1,
      instruction: 'Find the workflow use case',
      updatedAt: new Date('2026-08-06T00:00:00.000Z'),
    }));
    agentTypeService.getManyForHydration.mockResolvedValue(new Map([[
      agentTypeId,
      { id: agentTypeId, name: 'General Assistant', slug: 'general_assistant', skills: [] },
    ]]));

    await expect(service.findPlaybookSuggestorById(agentId)).resolves.toEqual({
      agentTypeId,
      agentTypeSlug: 'general_assistant',
      agentId,
      agentRevision: '2026-08-06T00:00:00.000Z',
      model: 'suggestor-model',
      temperature: 0.1,
      instruction: 'Find the workflow use case',
    });
  });

  it('lists active default agents with a configured model regardless of agent type', async () => {
    const { service, agentRepository, agentTypeService } = createService();
    const generalTypeId = new Types.ObjectId().toString();
    const plannerTypeId = new Types.ObjectId().toString();
    agentRepository.findActiveDefaults.mockResolvedValue([
      makeRecord({ name: 'General Assistant', llmModel: ' general-model ', agentType: generalTypeId, isDefault: true }),
      makeRecord({ name: 'Planner', llmModel: 'planner-model', agentType: plannerTypeId, isDefault: true }),
      makeRecord({ name: 'No Model', agentType: generalTypeId, isDefault: true }),
    ]);
    agentTypeService.getManyForHydration.mockResolvedValue(new Map([
      [generalTypeId, { id: generalTypeId, name: 'General', slug: 'general', skills: [] }],
      [plannerTypeId, { id: plannerTypeId, name: 'Planner', slug: 'playbook_planner', skills: [] }],
    ]));

    await expect(service.listPlaybookSuggestorAgentOptions()).resolves.toEqual([
      expect.objectContaining({ name: 'General Assistant', model: 'general-model' }),
      expect.objectContaining({ name: 'Planner', model: 'planner-model' }),
    ]);
  });

  it('rejects technical identity changes for the reserved Platform Copilot Agent', async () => {
    const { service, agentRepository } = createService();
    const reserved = makeRecord({
      slug: 'platform-copilot',
      agentTypeSlug: 'platform_copilot',
      isDefault: true,
      isDefaultForType: true,
    });
    agentRepository.findByIdDefault.mockResolvedValue(reserved);

    await expect(service.updateDefault(reserved._id, { isActive: false }))
      .rejects.toThrow('technical identity is system-reserved');
    await expect(service.updateDefault(reserved._id, { slug: 'renamed' }))
      .rejects.toThrow('technical identity is system-reserved');
    expect(agentRepository.updateById).not.toHaveBeenCalled();
  });

  it('rejects deletion of the reserved Platform Copilot Agent', async () => {
    const { service, agentRepository } = createService();
    const reserved = makeRecord({
      slug: 'platform-copilot',
      agentTypeSlug: 'platform_copilot',
      isDefault: true,
      isDefaultForType: true,
    });
    agentRepository.findByIdDefault.mockResolvedValue(reserved);

    await expect(service.deleteDefault(reserved._id))
      .rejects.toThrow('technical identity is system-reserved');
    expect(agentRepository.deleteById).not.toHaveBeenCalled();
  });

  it('allows capability edits on the reserved Platform Copilot Agent', async () => {
    const { service, agentRepository, agentTypeService, skillService, connectorService } = createService();
    const reserved = makeRecord({
      slug: 'platform-copilot',
      agentTypeSlug: 'platform_copilot',
      isDefault: true,
      isDefaultForType: true,
    });
    const updated = { ...reserved, instruction: 'Admin-managed instruction' };
    agentRepository.findByIdDefault.mockResolvedValue(reserved);
    agentRepository.updateById.mockResolvedValue(updated);
    agentTypeService.getManyForHydration.mockResolvedValue(new Map([[
      reserved.agentType,
      { id: reserved.agentType, name: 'Platform Copilot', slug: 'platform_copilot', skills: [] },
    ]]));
    skillService.findByIds.mockResolvedValue([]);
    connectorService.findByIds.mockResolvedValue([]);

    await expect(service.updateDefault(reserved._id, { instruction: 'Admin-managed instruction' }))
      .resolves.toEqual(expect.objectContaining({ instruction: 'Admin-managed instruction' }));
    expect(agentRepository.updateById).toHaveBeenCalledWith(
      reserved._id,
      expect.objectContaining({ instruction: 'Admin-managed instruction' }),
    );
  });
});
