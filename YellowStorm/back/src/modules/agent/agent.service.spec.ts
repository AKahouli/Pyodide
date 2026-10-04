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
      findIdsByCategoryName: jest.fn().mockResolvedValue([]),
      findBySlug: jest.fn().mockResolvedValue(null),
    };
    const connectorAuthService = {
      resolveRuntimeAuth: jest.fn(),
      resolveDynamicHeaders: jest.fn().mockResolvedValue({}),
    };
    const connectedAppTokenService = {
      getValidToken: jest.fn(),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: string) => (
        key === 'PLAYBOOK_MCP_SERVER_URL' ? 'http://localhost:8025/mcp' : fallback ?? ''
      )),
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
      [],
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
      configService,
      logger,
      connectorAuthService,
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

  it('maps reasoning effort through create, update, and response contracts', () => {
    const { service } = createService();
    const record = makeRecord({ reasoningEffort: 'high' });
    const createInput = (service as any).dtoToCreateInput('user-1', {
      name: 'Agent', slug: 'agent', agentType: record.agentType, role: 'Role', reasoning_effort: 'high',
    }, { id: record._id, isDefault: false, slug: 'agent', agentTypeSlug: 'worker' });
    const updateInput = (service as any).dtoToUpdateInput(
      { reasoning_effort: '' },
      record,
      {},
    );
    const response = (service as any).toResponse({
      ...record,
      agentType: { _id: record.agentType, name: 'Worker' },
    });

    expect(createInput.reasoningEffort).toBe('high');
    expect(updateInput.reasoningEffort).toBeNull();
    expect(response.reasoning_effort).toBe('high');
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

    connectorService.findIdsByCategoryName.mockResolvedValue(['connector-1']);
    const restricted = await service.buildAgentsForStream(
      userId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );

    expect(restricted[0].tools).toEqual([]);
    expect(JSON.parse(restricted[0].agent_params?.params.connector_bindings_json as string)).toEqual([]);
    expect(restricted[0].skills?.map((skill) => skill.id as string)).toEqual(['type-skill', 'agent-skill']);
  });

  it('excludes legacy Playbook orchestration actions from Platform Copilot', async () => {
    const { service, connectorService, modelsService } = createService();
    const enabledActions = [
      'search_playbooks',
      'open_playbook_context',
      'get_playbook_summary',
      'get_task_details',
      'get_task_dependencies',
      'validate_playbook',
      'start_playbook_generation',
      'modify_playbook',
      'get_playbook_construction',
      'start_playbook_execution',
      'list_recent_executions',
      'get_playbook_execution',
      'get_execution_diagnostics',
      'assess_playbook_request',
      'continue_playbook_clarification',
      'start_playbook_construction',
    ];
    const streamAgent: IAgentForStream = {
      id: 'yellowmind', name: 'Yellowmind', agentTypeName: 'Platform Copilot',
      agentTypeSlug: 'platform_copilot', agentTypeId: 'type-1', role: 'Platform Copilot',
      description: '', temperature: 0, model: 'model-1', instruction: 'Use start_playbook_generation',
      ignorePrePrompt: false, knowledgeBases: [], toolIds: [], guardrails: defaultGuardrails,
      connectorIds: ['playbook-connector'], connectorActionSelections: [], skillIds: [],
      disabledSkillIds: [], agentTypeSkillIds: [], enable_temporary_child_agents: false,
      max_temporary_child_agents: 4, isDefault: true, isDefaultForType: true,
    };
    const getAgentsForUser = jest.spyOn(service as any, 'getAgentsForUser');
    jest.spyOn(service as any, 'resolveManager').mockReturnValue(undefined);
    connectorService.findByIds.mockResolvedValue([{
      id: 'playbook-connector', name: 'Playbook MCP', slug: 'playbook-mcp', mcpServerUrl: 'http://localhost:8025/mcp',
      actions: [
        ...enabledActions.map((key) => ({ key, label: key, isEnabled: true })),
        { key: 'disabled_action', label: 'disabled_action', isEnabled: false },
      ],
      referencedSkillIds: [],
    }]);
    modelsService.getGuardrailsClassifierModel.mockResolvedValue(null);

    for (const connectorActionSelections of [
      [],
      [{ connectorId: 'playbook-connector', actionKeys: ['search_playbooks', 'disabled_action'] }],
    ]) {
      getAgentsForUser.mockResolvedValue([{ ...streamAgent, connectorActionSelections }]);
      const result = await service.buildAgentsForStream(
        userId,
        undefined,
        ['yellowmind'],
        undefined,
        undefined,
        undefined,
        undefined,
        { conversationId: 'conversation-1', correlationId: 'message-1', playbookHandoffAttached: true },
      );

      const expectedActions = enabledActions.filter((action) => ![
        'assess_playbook_request',
        'continue_playbook_clarification',
        'start_playbook_construction',
      ].includes(action));
      expect(result[0].tools.map((tool) => tool.name)).toEqual(
        expectedActions.map((action) => `playbook-mcp_${action}`),
      );
      const bindings = JSON.parse(result[0].agent_params?.params.connector_bindings_json as string);
      expect(bindings[0].actions.map((action: { action_key: string }) => action.action_key)).toEqual(expectedActions);
      expect(result[0].tools.map((tool) => tool.name)).not.toEqual(
        expect.arrayContaining(['playbook-mcp_disabled_action']),
      );
      expect(result[0].prompt).toContain('[Trusted conversation handoff]');
      expect(result[0].prompt).toContain('Call start_playbook_generation now');
      expect(result[0].prompt).not.toContain('conversation-1');
      expect(result[0].prompt).not.toContain('message-1');
    }
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
    expect(result[0].prompt).not.toContain('[Trusted conversation handoff]');
  });

  it('gives the acting user identity to an admin-created connector only when it points at a trusted internal MCP server', async () => {
    const { service, skillService, connectorService, configService } = createService();
    configService.get.mockImplementation((key: string, fallback?: string) => key === 'SEMANTIC_MODEL_MCP_SERVER_URL' ? 'http://localhost:8027/mcp' : fallback ?? '');
    const agent: IAgentForStream = {
      id: 'designer-agent', name: 'Designer', agentTypeName: 'Worker', agentTypeSlug: 'worker', agentTypeId: 'type-worker', role: 'Assistant',
      description: '', temperature: 0, model: 'model-1', instruction: '', ignorePrePrompt: false, knowledgeBases: [], toolIds: [],
      guardrails: defaultGuardrails, connectorIds: ['semantic-connector', 'other-connector'], connectorActionSelections: [], skillIds: [],
      disabledSkillIds: [], agentTypeSkillIds: [], enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: false, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([agent]);
    connectorService.findByIds.mockResolvedValue([
      { id: 'semantic-connector', name: 'Semantic models', slug: 'semantic-models', mcpServerUrl: 'http://LOCALHOST:8027/mcp/', actions: [{ key: 'get_semantic_model', label: 'Get', isEnabled: true }] },
      { id: 'other-connector', name: 'Elsewhere', slug: 'elsewhere', mcpServerUrl: 'https://example.com/mcp', actions: [{ key: 'search', label: 'Search', isEnabled: true }] },
    ]);
    skillService.findByIds.mockResolvedValue([]);

    const result = await service.buildAgentsForStream(userId, undefined, ['designer-agent'], undefined, undefined, undefined, undefined,
      { conversationId: 'conversation-1', correlationId: 'message-1' });

    const bindings = JSON.parse(result[0].agent_params?.params.connector_bindings_json as string) as Array<{ connector_slug: string; auth_headers?: Record<string, string> }>;
    expect(bindings.find((binding) => binding.connector_slug === 'semantic-models')?.auth_headers).toEqual(expect.objectContaining({
      'X-YellowStorm-User-Id': userId, 'X-YellowStorm-Agent-Id': 'designer-agent', 'X-Correlation-Id': 'message-1',
    }));
    expect(bindings.find((binding) => binding.connector_slug === 'elsewhere')?.auth_headers ?? {}).not.toHaveProperty('X-YellowStorm-User-Id');
  });

  describe('chat on a semantic model', () => {
    const semanticModel = { id: 'model-1', name: 'Contracts' };
    const searchConnector = {
      id: 'semantic-search-connector', name: 'Semantic Search', slug: 'mcp-semantic-search',
      authSourceType: 'credential', connectedAppKey: '',
      runtimeAuthConfig: { strategy: 'http_header_bearer', headerName: 'Authorization', headerPrefix: 'Bearer' },
      mcpTransportType: 'streamable_http', mcpServerUrl: 'http://localhost:8027/mcp', mcpServerConfig: {},
      dynamicHeaders: [{ headerName: 'X-YellowStorm-User-Id', source: 'user_id', enabled: true }],
      actions: [
        ...['find_records', 'get_related_records', 'describe_model', 'query_records'].map((key) => ({ key, safety: 'read', isEnabled: true })),
        { key: 'search_records', safety: 'read', isEnabled: false },
        { key: 'apply_model_changes', safety: 'write', isEnabled: true },
        { key: 'publish_semantic_model', safety: 'delete', isEnabled: true },
      ].map(({ key, safety, isEnabled }) => ({
        key, label: key, isEnabled, safety,
        parameterSchema: {
          type: 'object',
          properties: { model_id: { type: 'string' }, data: { type: 'string' }, query: { type: 'string' } },
          required: ['model_id', 'query'],
        },
      })),
      referencedSkillIds: [],
    };
    const workerAgent = (connectorIds: string[] = []): IAgentForStream => ({
      id: 'worker-agent', name: 'Worker', agentTypeName: 'Worker', agentTypeSlug: 'worker', agentTypeId: 'type-worker', role: 'Assistant',
      description: '', temperature: 0, model: 'model-1', instruction: 'Be helpful.', ignorePrePrompt: false, knowledgeBases: [], toolIds: [],
      guardrails: defaultGuardrails, connectorIds,
      connectorActionSelections: connectorIds.map((connectorId) => ({ connectorId, actionKeys: ['search'] })), skillIds: [],
      disabledSkillIds: [], agentTypeSkillIds: [], enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: false, isDefaultForType: false,
    });

    const withSearchConfig = (configService: { get: jest.Mock }, slug = 'mcp-semantic-search') =>
      configService.get.mockImplementation((key: string, fallback?: string) => ({
        'semanticModel.searchConnectorSlug': slug,
        SEMANTIC_MODEL_MCP_SERVER_URL: 'http://localhost:8027/mcp',
      } as Record<string, string>)[key] ?? fallback ?? '');

    it('binds the enabled read tools of the configured connector, pinned to the published model, with identity headers and the model named', async () => {
      const { service, skillService, connectorService, connectorAuthService, configService } = createService();
      withSearchConfig(configService);
      jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([workerAgent(['other-connector'])]);
      connectorService.findByIds.mockResolvedValue([
        { id: 'other-connector', name: 'Elsewhere', slug: 'elsewhere', mcpServerUrl: 'https://example.com/mcp',
          actions: [{ key: 'search', label: 'Search', isEnabled: true }, { key: 'write', label: 'Write', isEnabled: true }] },
      ]);
      connectorService.findBySlug.mockResolvedValue(searchConnector);
      connectorAuthService.resolveRuntimeAuth.mockResolvedValue({ headers: { Authorization: 'Bearer ingress' }, env: {} });
      connectorAuthService.resolveDynamicHeaders.mockResolvedValue({ 'X-YellowStorm-User-Id': userId });
      skillService.findByIds.mockResolvedValue([]);

      const result = await service.buildAgentsForStream(userId, undefined, ['worker-agent'], undefined, undefined, undefined, semanticModel,
        { conversationId: 'conversation-1', correlationId: 'message-1' });

      expect(connectorService.findBySlug).toHaveBeenCalledWith('mcp-semantic-search');
      const params = result[0].agent_params?.params ?? {};
      expect(params.semantic_model_id).toBe('model-1');
      expect(params).not.toHaveProperty('semantic_model_schema_name');
      const bindings = JSON.parse(params.connector_bindings_json as string) as Array<Record<string, any>>;
      const search = bindings.find((binding) => binding.connector_slug === 'mcp-semantic-search');
      expect(search).toBeDefined();
      // No selection for the connector: its enabled read tools; never a tool that changes or publishes the model.
      expect(search!.actions.map((action: { action_key: string }) => action.action_key))
        .toEqual(['find_records', 'get_related_records', 'describe_model', 'query_records']);
      expect(search!.fixed_params).toEqual({ model_id: 'model-1', data: 'published' });
      for (const action of search!.actions) {
        const schema = JSON.parse(action.parameter_schema_json);
        expect(Object.keys(schema.properties)).toEqual(['query']);
        expect(schema.required).toEqual(['query']);
      }
      expect(search!.auth_headers).toEqual(expect.objectContaining({
        Authorization: 'Bearer ingress',
        'X-YellowStorm-User-Id': userId,
        'X-YellowStorm-Agent-Id': 'worker-agent',
        'X-YellowStorm-Conversation-Id': 'conversation-1',
        'X-Correlation-Id': 'message-1',
      }));
      // The agent's own connector keeps its own action selection.
      expect(bindings.find((binding) => binding.connector_slug === 'elsewhere')!.actions.map((action: { action_key: string }) => action.action_key))
        .toEqual(['search']);
      expect(result[0].connectorIds).toEqual(['other-connector', 'semantic-search-connector']);
      expect(result[0].prompt).toContain('Be helpful.');
      // How to answer from records is in the agent's own instruction (Yellowmind's, in the database), not added here.
      expect(result[0].prompt).toContain('This conversation is about the semantic model "Contracts".');
      expect(result[0].prompt).not.toContain('model-1');
      expect(result[0].prompt).not.toContain('find_records');
    });

    it("keeps to the read tools the agent selected for the semantic connector", async () => {
      const { service, skillService, connectorService, connectorAuthService, configService } = createService();
      withSearchConfig(configService);
      jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([{
        ...workerAgent(['semantic-search-connector']),
        connectorActionSelections: [{ connectorId: 'semantic-search-connector', actionKeys: ['query_records', 'find_records', 'publish_semantic_model'] }],
      }]);
      connectorService.findByIds.mockResolvedValue([searchConnector]);
      connectorService.findBySlug.mockResolvedValue(searchConnector);
      connectorAuthService.resolveRuntimeAuth.mockResolvedValue({ headers: { Authorization: 'Bearer ingress' }, env: {} });
      connectorAuthService.resolveDynamicHeaders.mockResolvedValue({ 'X-YellowStorm-User-Id': userId });
      skillService.findByIds.mockResolvedValue([]);

      const result = await service.buildAgentsForStream(userId, undefined, ['worker-agent'], undefined, undefined, undefined, semanticModel,
        { conversationId: 'conversation-1', correlationId: 'message-1' });

      const bindings = JSON.parse(result[0].agent_params?.params.connector_bindings_json as string) as Array<Record<string, any>>;
      const search = bindings.find((binding) => binding.connector_slug === 'mcp-semantic-search');
      expect(search!.actions.map((action: { action_key: string }) => action.action_key)).toEqual(['find_records', 'query_records']);
      expect(search!.fixed_params).toEqual({ model_id: 'model-1', data: 'published' });
    });

    it('still adds the prompt block, without tools, when the configured search connector is missing', async () => {
      const { service, skillService, connectorService, logger, configService } = createService();
      withSearchConfig(configService);
      jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([workerAgent()]);
      connectorService.findByIds.mockResolvedValue([]);
      skillService.findByIds.mockResolvedValue([]);

      const result = await service.buildAgentsForStream(userId, undefined, ['worker-agent'], undefined, undefined, undefined, semanticModel,
        { conversationId: 'conversation-1', correlationId: 'message-1' });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Semantic model search connector is not available'), expect.anything());
      const params = result[0].agent_params?.params ?? {};
      expect(JSON.parse(params.connector_bindings_json as string)).toEqual([]);
      expect(params.semantic_model_id).toBe('model-1');
      expect(result[0].prompt).toContain('This conversation is about the semantic model "Contracts".');
      expect(result[0].prompt).toContain('not available');
    });

    it('binds no search tools when no search connector is configured', async () => {
      const { service, skillService, connectorService, logger } = createService();
      jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([workerAgent()]);
      connectorService.findByIds.mockResolvedValue([]);
      skillService.findByIds.mockResolvedValue([]);

      const result = await service.buildAgentsForStream(userId, undefined, ['worker-agent'], undefined, undefined, undefined, semanticModel,
        { conversationId: 'conversation-1', correlationId: 'message-1' });

      expect(connectorService.findBySlug).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SEMANTIC_MODEL_SEARCH_CONNECTOR_SLUG is not set'), expect.anything());
      expect(JSON.parse(result[0].agent_params?.params?.connector_bindings_json as string)).toEqual([]);
    });

    it('does not look up or bind the search connector without a semantic model', async () => {
      const { service, skillService, connectorService } = createService();
      jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([workerAgent()]);
      connectorService.findByIds.mockResolvedValue([]);
      skillService.findByIds.mockResolvedValue([]);

      const result = await service.buildAgentsForStream(userId, undefined, ['worker-agent']);

      expect(connectorService.findBySlug).not.toHaveBeenCalled();
      expect(result[0].agent_params?.params).not.toHaveProperty('semantic_model_id');
      expect(result[0].prompt).not.toContain('[Semantic model]');
    });
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
    expect(result[0].agent_type).toBe('mono-agent');
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

  it('prefers a supported request reasoning effort for an untagged agent', async () => {
    const { service, modelsService } = createService();
    const monoAgent: IAgentForStream = {
      id: 'mono-agent', name: 'Mono Agent', agentTypeName: 'Mono Agent', agentTypeSlug: 'mono-agent',
      agentTypeId: 'type-mono', role: 'Role', description: '', temperature: 0, model: 'native-model',
      reasoningEffort: 'low', instruction: '', ignorePrePrompt: false, knowledgeBases: [], toolIds: [],
      guardrails: defaultGuardrails, connectorIds: [], connectorActionSelections: [], skillIds: [],
      disabledSkillIds: [], agentTypeSkillIds: [], enable_temporary_child_agents: false,
      max_temporary_child_agents: 4, isDefault: true, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([]);
    jest.spyOn(service as any, 'resolveDefaultMonoAgent').mockResolvedValue(monoAgent);
    modelsService.findById.mockResolvedValue({
      id: 'selected-model', omitTemperature: false, inputModalities: ['text'], maxInputTokens: null,
      supportsReasoning: true,
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
    });

    const result = await service.buildAgentsForStream(
      userId,
      'selected-model',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'high',
    );

    expect(result[0].chatbot.reasoning_effort).toBe('high');
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

  it('uses the admin default model for a tagged agent with no model override', async () => {
    const { service, modelsService } = createService();
    const taggedAgent: IAgentForStream = {
      id: 'tagged-agent', name: 'Tagged Agent', agentTypeName: 'Worker', agentTypeSlug: 'worker',
      agentTypeId: 'type-worker', role: 'Role', description: '', temperature: 0, model: '',
      instruction: '', ignorePrePrompt: false, knowledgeBases: [], toolIds: [], guardrails: defaultGuardrails,
      connectorIds: [], connectorActionSelections: [], skillIds: [], disabledSkillIds: [], agentTypeSkillIds: [],
      enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: false, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([taggedAgent]);
    modelsService.getDefaultModel.mockResolvedValue({ id: 'admin-default' } as any);
    modelsService.findById.mockImplementation(async (id: string) => ({ id, omitTemperature: false }));

    const result = await service.buildAgentsForStream(userId, 'request-model', ['tagged-agent']);

    expect(modelsService.getDefaultModel).toHaveBeenCalled();
    expect(result[0].chatbot.model).toBe('admin-default');
  });

  it('uses a tagged agent reasoning effort only when its model supports the value', async () => {
    const { service, modelsService } = createService();
    const taggedAgent: IAgentForStream = {
      id: 'tagged-agent', name: 'Tagged Agent', agentTypeName: 'Worker', agentTypeSlug: 'worker',
      agentTypeId: 'type-worker', role: 'Role', description: '', temperature: 0, model: 'native-model',
      reasoningEffort: 'high', instruction: '', ignorePrePrompt: false, knowledgeBases: [], toolIds: [],
      guardrails: defaultGuardrails, connectorIds: [], connectorActionSelections: [], skillIds: [],
      disabledSkillIds: [], agentTypeSkillIds: [], enable_temporary_child_agents: false,
      max_temporary_child_agents: 4, isDefault: false, isDefaultForType: false,
    };
    jest.spyOn(service as any, 'getAgentsForUser').mockResolvedValue([taggedAgent]);
    modelsService.findById.mockResolvedValue({
      id: 'native-model', omitTemperature: false, inputModalities: ['text'], maxInputTokens: null,
      supportsReasoning: true, reasoning: { efforts: [{ id: 'high', name: 'High' }] },
    });

    const supported = await service.buildAgentsForStream(userId, undefined, ['tagged-agent']);
    expect(supported[0].chatbot.reasoning_effort).toBe('high');

    modelsService.findById.mockResolvedValue({
      id: 'native-model', omitTemperature: false, inputModalities: ['text'], maxInputTokens: null,
      supportsReasoning: true, reasoning: { efforts: [{ id: 'low', name: 'Low' }] },
    });
    const unsupported = await service.buildAgentsForStream(userId, undefined, ['tagged-agent']);
    expect(unsupported[0].chatbot).not.toHaveProperty('reasoning_effort');
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
    expect(result[0].agent_type).toBe('worker');
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

  describe('sandbox scope injection', () => {
    const CI_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const PB_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const scope = {
      userId,
      scopeType: 'playbook' as const,
      scopeId: 'playbook:exec-42',
      laneId: 'main',
    };

    const setup = () => {
      const ctx = createService();
      const objectId = new Types.ObjectId();
      ctx.agentRepository.findByIds.mockResolvedValue([
        makeRecord({
          _id: objectId.toString(),
          name: 'Agent 1',
          instruction: 'Follow instructions',
          agentType: '333333333333333333333333',
          connectors: [CI_ID, PB_ID],
        }),
      ]);
      ctx.agentTypeService.getManyForHydration.mockResolvedValue(
        new Map([['333333333333333333333333', { id: '333333333333333333333333', name: 'Worker', slug: 'worker', skills: [] }]]),
      );
      ctx.connectorService.findByIds.mockResolvedValue([
        {
          id: CI_ID,
          name: 'Code Interpreter',
          slug: 'code-interpreter',
          actions: [{ key: 'run', label: 'Run', description: '', isEnabled: true }],
          referencedSkillIds: [],
        },
        {
          id: PB_ID,
          name: 'Playbook MCP',
          slug: 'playbook-mcp',
          mcpServerUrl: 'http://localhost:8025/mcp',
          actions: [{ key: 'start', label: 'Start', description: '', isEnabled: true }],
          referencedSkillIds: [],
        },
      ]);
      return { ...ctx, agentId: objectId.toString() };
    };

    it('stamps playbook scope onto the code-interpreter binding', async () => {
      const { service, agentId } = setup();

      const agents = await service.buildGrpcAgentsForPlaybook(userId, [agentId], undefined, 'exec-42', scope);

      const ci: any = agents[0].connector_bindings?.find(
        (b: any) => b.connector_slug === 'code-interpreter',
      );
      expect(ci.auth_headers['x-sandbox-scope-id']).toBe('playbook:exec-42');
      expect(ci.auth_headers['x-sandbox-scope-type']).toBe('playbook');
      expect(ci.auth_headers['x-user-id']).toBe(userId);
    });

    it('leaves the existing playbook-mcp X-YellowStorm-* headers intact and unscoped', async () => {
      const { service, agentId } = setup();

      const agents = await service.buildGrpcAgentsForPlaybook(userId, [agentId], undefined, 'exec-42', scope);

      const pb: any = agents[0].connector_bindings?.find(
        (b: any) => b.connector_slug === 'playbook-mcp',
      );
      expect(pb.auth_headers['X-YellowStorm-Agent-Id']).toBeDefined();
      expect(pb.auth_headers['x-sandbox-scope-id']).toBeUndefined();
    });
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
          parameter_schema: {},
          parameter_schema_json: JSON.stringify({
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'number' } },
            additionalProperties: false,
          }),
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

  it('resolves an explicitly selected active default agent as the playbook planner', async () => {
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
    agentTypeService.getManyForHydration.mockResolvedValue(new Map([[
      agentTypeId,
      { id: agentTypeId, name: 'General Assistant', slug: 'general_assistant', skills: [] },
    ]]));

    await expect(service.findPlaybookPlannerById(agentId)).resolves.toEqual({
      agentTypeId,
      agentTypeSlug: 'general_assistant',
      agentId,
      agentRevision: '2026-08-06T00:00:00.000Z',
      model: 'planner-model',
      temperature: 0.2,
      instruction: 'Plan safely',
    });
  });

  it('lists active default agents regardless of agent type or model configuration', async () => {
    const { service, agentRepository } = createService();
    const plannerTypeId = new Types.ObjectId().toString();
    agentRepository.findActiveDefaults.mockResolvedValue([
      makeRecord({ name: 'Planner', description: 'Plans generated tasks', llmModel: ' planner-model ', agentType: plannerTypeId, isDefault: true }),
      makeRecord({ name: 'Other', llmModel: 'other-model', agentType: new Types.ObjectId().toString(), isDefault: true }),
      makeRecord({ name: 'No Model', llmModel: ' ', agentType: plannerTypeId, isDefault: true }),
    ]);

    await expect(service.listPlaybookPlannerAgentOptions()).resolves.toEqual([
      expect.objectContaining({ name: 'Planner', model: 'planner-model' }),
      expect.objectContaining({ name: 'Other', model: 'other-model' }),
      expect.objectContaining({ name: 'No Model', model: null }),
    ]);
  });

  it('resolves a model-less active default agent for inference fallback', async () => {
    const { service, agentRepository, agentTypeService } = createService();
    const agentId = new Types.ObjectId().toString();
    const agentTypeId = new Types.ObjectId().toString();
    agentRepository.findById.mockResolvedValue(makeRecord({
      _id: agentId,
      agentType: agentTypeId,
      isDefault: true,
      isActive: true,
      llmModel: ' ',
    }));
    agentTypeService.getManyForHydration.mockResolvedValue(new Map([[
      agentTypeId,
      { id: agentTypeId, name: 'Planner', slug: 'general_assistant', skills: [] },
    ]]));

    await expect(service.findPlaybookPlannerById(agentId)).resolves.toEqual(
      expect.objectContaining({ agentId, model: null }),
    );
  });

  it('rejects an invalid explicit playbook planner id', async () => {
    const { service, agentRepository } = createService();

    await expect(service.findPlaybookPlannerById('invalid')).rejects.toThrow('selected Playbook Planner agent is invalid');
    expect(agentRepository.findById).not.toHaveBeenCalled();
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
