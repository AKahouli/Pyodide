import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PlaybookDesignService } from './playbook-design.service';
import { PlaybookService } from './playbook.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { PlaybookContextService } from './playbook-context.service';
import { PlaybookDesignMessage } from '../schemas/playbook-design-message.schema';
import { LoggerService } from '../../logger';
import { ServiceUnavailableException, BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { AgentService } from '../../agent/agent.service';
import { ModelsService } from '../../models/models.service';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { UsageService } from '../../usage/usage.service';
import { ConfigService } from '@nestjs/config';
import { PlaybookPromptService } from './playbook-prompt.service';

describe('PlaybookDesignService', () => {
  let service: PlaybookDesignService;

  // Use Record<string, jest.Mock> for all mocked dependencies to avoid TS conflicts
  let playbookService: Record<string, jest.Mock>;
  let grpcService: Record<string, any>;
  let contextService: Record<string, jest.Mock>;
  let agentService: Record<string, jest.Mock>;
  let modelsService: Record<string, jest.Mock>;
  let usageService: Record<string, jest.Mock>;
  let promptService: Record<string, jest.Mock>;
  let loggerService: Record<string, jest.Mock>;
  let designMessageModel: Record<string, jest.Mock>;

  const userId = new Types.ObjectId().toHexString();
  const playbookId = new Types.ObjectId().toHexString();
  const agentId1 = new Types.ObjectId().toHexString();
  const agentId2 = new Types.ObjectId().toHexString();

  const mockGrpcAgents = [
    { id: agentId1, name: 'Agent 1' },
    { id: agentId2, name: 'Agent 2' },
  ];

  const mockDefaultModel = {
    id: new Types.ObjectId().toHexString(),
    litellmModel: 'gpt-4o',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockDesignMessageModel = {
      create: jest.fn(),
    };

    const mockPlaybookService = {
      findById: jest.fn(),
      findRawById: jest.fn(),
      createWithTasksAndEdges: jest.fn(),
      update: jest.fn(),
    };

    const mockGrpcService = {
      isAvailable: true,
      generatePlaybook: jest.fn(),
      designPlaybook: jest.fn(),
    };

    const mockContextService = {
      buildWorkspaceContexts: jest.fn().mockResolvedValue([]),
      resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined),
    };

    const mockAgentService = {
      getAgentsForUser: jest.fn().mockResolvedValue([
        { id: agentId1, name: 'Agent 1' },
        { id: agentId2, name: 'Agent 2' },
      ]),
      buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue(mockGrpcAgents),
    };

    const mockModelsService = {
      getDefaultModel: jest.fn().mockResolvedValue(mockDefaultModel),
    };

    const mockLiteLLMConnectionService = {
      getHttpClient: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const mockUsageService = {
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };

    const mockPromptService = {
      getPromptOverridesPayload: jest.fn().mockResolvedValue({
        'playbook.generate': JSON.stringify({
          key: 'playbook.generate',
          systemTemplate: 'Custom preprompt',
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookDesignService,
        { provide: getModelToken(PlaybookDesignMessage.name), useValue: mockDesignMessageModel },
        { provide: PlaybookService, useValue: mockPlaybookService },
        { provide: PlaybookGrpcService, useValue: mockGrpcService },
        { provide: PlaybookContextService, useValue: mockContextService },
        { provide: AgentService, useValue: mockAgentService },
        { provide: ModelsService, useValue: mockModelsService },
        { provide: LiteLLMConnectionService, useValue: mockLiteLLMConnectionService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UsageService, useValue: mockUsageService },
        { provide: PlaybookPromptService, useValue: mockPromptService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compile();

    service = module.get<PlaybookDesignService>(PlaybookDesignService);
    playbookService = module.get(PlaybookService);
    grpcService = module.get(PlaybookGrpcService);
    contextService = module.get(PlaybookContextService);
    agentService = module.get(AgentService);
    modelsService = module.get(ModelsService);
    usageService = module.get(UsageService);
    promptService = module.get(PlaybookPromptService);
    loggerService = module.get(LoggerService);
    designMessageModel = module.get(getModelToken(PlaybookDesignMessage.name));
  });

  describe('constructor', () => {
    it('should set logger context to PlaybookDesignService', () => {
      expect(loggerService.setContext).toHaveBeenCalledWith('PlaybookDesignService');
    });
  });

  describe('generatePlaybook', () => {
    const dto = {
      name: 'Test Playbook',
      prompt: 'Create a playbook that handles customer onboarding workflow',
      workspaces: [new Types.ObjectId().toHexString()],
    };

    const grpcResponse = {
      nodes: [
        {
          id: 'task-0',
          title: 'Gather Info',
          description: 'Collect customer information',
          assigned_agent_id: agentId1,
          execution_order: 0,
          x: 100,
          y: 200,
          interrupt_before: false,
          interrupt_after: true,
          allow_clarification: true,
          clarification_prompt: 'Need more details?',
          max_clarifications: 5,
          input_keys: ['customer_name'],
          output_key: 'customer_info',
        },
        {
          id: 'task-1',
          title: 'Setup Account',
          description: 'Create the customer account',
          assigned_agent_id: agentId2,
          execution_order: 1,
          x: 100,
          y: 400,
          interrupt_before: true,
          interrupt_after: false,
          allow_clarification: false,
          clarification_prompt: '',
          max_clarifications: 3,
          input_keys: ['customer_info'],
          output_key: 'account_details',
        },
      ],
      edges: [{ source_id: 'task-0', target_id: 'task-1' }],
      usage: {
        input_tokens: 150,
        output_tokens: 300,
        model: 'gpt-4o',
      },
    };

    beforeEach(() => {
      grpcService.generatePlaybook.mockResolvedValue(grpcResponse);
      playbookService.createWithTasksAndEdges.mockResolvedValue({ id: playbookId });
    });

    it('should throw ServiceUnavailableException when gRPC is unavailable', async () => {
      grpcService.isAvailable = false;

      await expect(service.generatePlaybook(userId, dto)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should resolve agents and build gRPC agents for the user', async () => {
      await service.generatePlaybook(userId, dto);

      expect(agentService.getAgentsForUser).toHaveBeenCalledWith(userId);
      expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith(
        userId,
        [agentId1, agentId2],
        mockDefaultModel.id,
      );
      expect(contextService.resolveAgentBrainContexts).toHaveBeenCalledWith(mockGrpcAgents);
    });

    it('should build workspace contexts from dto.workspaces', async () => {
      await service.generatePlaybook(userId, dto);

      expect(contextService.buildWorkspaceContexts).toHaveBeenCalledWith(dto.workspaces);
    });

    it('should pass empty array to buildWorkspaceContexts when workspaces not provided', async () => {
      const dtoNoWorkspaces = { name: 'Test', prompt: 'Create something useful for testing' };

      await service.generatePlaybook(userId, dtoNoWorkspaces);

      expect(contextService.buildWorkspaceContexts).toHaveBeenCalledWith([]);
    });

    it('should build correct gRPC request and call generatePlaybook', async () => {
      contextService.buildWorkspaceContexts.mockResolvedValue([
        { id: 'ws1', content: 'workspace data' },
      ]);

      await service.generatePlaybook(userId, dto);

      expect(promptService.getPromptOverridesPayload).toHaveBeenCalledTimes(1);

      expect(grpcService.generatePlaybook).toHaveBeenCalledWith(
        expect.objectContaining({
          query: dto.prompt,
          available_agents: mockGrpcAgents,
          workspace_context: [{ id: 'ws1', content: 'workspace data' }],
          existing_playbook: null,
          model: mockDefaultModel.id,
          prompt_overrides: {
            'playbook.generate': JSON.stringify({
              key: 'playbook.generate',
              systemTemplate: 'Custom preprompt',
            }),
          },
        }),
      );
    });

    it('should use model id as fallback when litellmModel is not available', async () => {
      const modelWithoutLitellm = { id: 'model-123', litellmModel: undefined };
      modelsService.getDefaultModel.mockResolvedValue(modelWithoutLitellm);

      await service.generatePlaybook(userId, dto);

      expect(grpcService.generatePlaybook).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'model-123' }),
      );
    });

    it('should use empty string for model when no default model exists', async () => {
      modelsService.getDefaultModel.mockResolvedValue(null);

      await service.generatePlaybook(userId, dto);

      expect(grpcService.generatePlaybook).toHaveBeenCalledWith(
        expect.objectContaining({ model: '' }),
      );
    });

    it('should use empty string for fallback model id when no default model exists', async () => {
      modelsService.getDefaultModel.mockResolvedValue(null);
      agentService.buildGrpcAgentsForPlaybook.mockResolvedValue([]);

      await service.generatePlaybook(userId, dto);

      expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith(
        userId,
        [agentId1, agentId2],
        '',
      );
    });

    it('should map gRPC response nodes to tasks correctly', async () => {
      await service.generatePlaybook(userId, dto);

      const createCall = playbookService.createWithTasksAndEdges.mock.calls[0];
      const tasks = createCall[3];

      expect(tasks).toHaveLength(2);

      expect(tasks[0]).toEqual(
        expect.objectContaining({
          id: 'task-0',
          title: 'Gather Info',
          description: 'Collect customer information',
          assignedAgentId: new Types.ObjectId(agentId1),
          executionOrder: 0,
          positionX: 100,
          positionY: 200,
          interruptBefore: false,
          interruptAfter: true,
          allowClarification: true,
          clarificationPrompt: 'Need more details?',
          maxClarifications: 5,
          inputKeys: ['customer_name'],
          outputKey: 'customer_info',
        }),
      );

      expect(tasks[1]).toEqual(
        expect.objectContaining({
          id: 'task-1',
          title: 'Setup Account',
          description: 'Create the customer account',
          assignedAgentId: new Types.ObjectId(agentId2),
          executionOrder: 1,
          positionX: 100,
          positionY: 400,
          interruptBefore: true,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: ['customer_info'],
          outputKey: 'account_details',
        }),
      );
    });

    it('should map gRPC response edges correctly', async () => {
      await service.generatePlaybook(userId, dto);

      const createCall = playbookService.createWithTasksAndEdges.mock.calls[0];
      const edges = createCall[4];

      expect(edges).toHaveLength(1);
      expect(edges[0]).toEqual({
        id: 'edge-0',
        sourceId: 'task-0',
        sourceOutputPortId: 'default',
        targetId: 'task-1',
        targetInputPortId: 'default',
      });
    });

    it('should call createWithTasksAndEdges with correct arguments', async () => {
      await service.generatePlaybook(userId, dto);

      expect(playbookService.createWithTasksAndEdges).toHaveBeenCalledWith(
        userId,
        dto.name,
        dto.prompt,
        expect.any(Array),
        expect.any(Array),
        dto.workspaces,
      );
    });

    it('should return the created playbook id', async () => {
      const result = await service.generatePlaybook(userId, dto);

      expect(result).toEqual({ id: playbookId });
    });

    it('should record usage when usage data is present in response', async () => {
      await service.generatePlaybook(userId, dto);

      expect(usageService.recordUsage).toHaveBeenCalledWith({
        userId,
        inputTokens: 150,
        outputTokens: 300,
        usageType: 'playbook',
        modelName: 'gpt-4o',
        endpoint: 'playbook.generate',
      });
    });

    it('should not throw when usage recording fails (fire-and-forget)', async () => {
      usageService.recordUsage.mockRejectedValue(new Error('Usage DB error'));

      const result = await service.generatePlaybook(userId, dto);

      expect(result).toEqual({ id: playbookId });
    });

    it('should not record usage when usage data is absent from response', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step 1' }],
        edges: [],
        usage: null,
      });

      await service.generatePlaybook(userId, dto);

      expect(usageService.recordUsage).not.toHaveBeenCalled();
    });

    it('should throw ServiceUnavailableException when gRPC returns empty nodes', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [],
        edges: [],
        usage: null,
      });

      await expect(service.generatePlaybook(userId, dto)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw ServiceUnavailableException when gRPC call fails with generic error', async () => {
      grpcService.generatePlaybook.mockRejectedValue(new Error('Connection refused'));

      await expect(service.generatePlaybook(userId, dto)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(loggerService.error).toHaveBeenCalled();
    });

    it('should re-throw application exceptions with errorCode', async () => {
      const appError = new BadRequestException(ErrorCode.PLAYBOOK_GENERATE_FAILED);
      grpcService.generatePlaybook.mockRejectedValue(appError);

      await expect(service.generatePlaybook(userId, dto)).rejects.toThrow(appError);
    });

    it('should use default values for missing node fields', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: undefined, title: undefined }],
        edges: [],
        usage: null,
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0]).toEqual(
        expect.objectContaining({
          id: 'task-0',
          title: 'Step 1',
          description: '',
          assignedAgentId: null,
          executionOrder: 0,
          positionX: 0,
          positionY: 0,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: [],
          outputKey: '',
        }),
      );
    });

    it('should handle node with empty assigned_agent_id', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step', assigned_agent_id: '' }],
        edges: [],
        usage: null,
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].assignedAgentId).toBeNull();
    });

    it('should handle response with no edges array', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step 1' }],
        usage: null,
      });

      await service.generatePlaybook(userId, dto);

      const edges = playbookService.createWithTasksAndEdges.mock.calls[0][4];
      expect(edges).toEqual([]);
    });

    it('should handle usage with missing optional fields', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step 1' }],
        edges: [],
        usage: { input_tokens: undefined, output_tokens: undefined, model: undefined },
      });

      await service.generatePlaybook(userId, dto);

      expect(usageService.recordUsage).toHaveBeenCalledWith({
        userId,
        inputTokens: 0,
        outputTokens: 0,
        usageType: 'playbook',
        modelName: undefined,
        endpoint: 'playbook.generate',
      });
    });
  });

  describe('designPlaybook', () => {
    const dto = { query: 'Add a notification step after account setup' };

    const existingPlaybook = {
      id: playbookId,
      tasks: [
        {
          id: 'task-0',
          title: 'Gather Info',
          description: 'Collect info',
          assignedAgentId: agentId1,
          executionOrder: 0,
          positionX: 100,
          positionY: 200,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: [],
          outputKey: 'info',
        },
        {
          id: 'task-1',
          title: 'Setup Account',
          description: 'Create account',
          assignedAgentId: agentId2,
          executionOrder: 1,
          positionX: 100,
          positionY: 400,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: ['info'],
          outputKey: 'account',
        },
      ],
      edges: [{ id: 'edge-0', sourceId: 'task-0', targetId: 'task-1' }],
      workspaces: [new Types.ObjectId().toHexString()],
    };

    const grpcDesignResponse = {
      nodes: [
        {
          id: 'task-0',
          title: 'Gather Info',
          description: 'Collect info',
          assigned_agent_id: agentId1,
          execution_order: 0,
          x: 100,
          y: 200,
          interrupt_before: false,
          interrupt_after: false,
          allow_clarification: false,
          clarification_prompt: '',
          max_clarifications: 3,
          input_keys: [],
          output_key: 'info',
        },
        {
          id: 'task-1',
          title: 'Setup Account',
          description: 'Create account',
          assigned_agent_id: agentId2,
          execution_order: 1,
          x: 100,
          y: 400,
          interrupt_before: false,
          interrupt_after: false,
          allow_clarification: false,
          clarification_prompt: '',
          max_clarifications: 3,
          input_keys: ['info'],
          output_key: 'account',
        },
        {
          id: 'task-2',
          title: 'Send Notification',
          description: 'Notify team',
          assigned_agent_id: agentId1,
          execution_order: 2,
          x: 100,
          y: 600,
          interrupt_before: false,
          interrupt_after: false,
          allow_clarification: false,
          clarification_prompt: '',
          max_clarifications: 3,
          input_keys: ['account'],
          output_key: 'notification_result',
        },
      ],
      edges: [
        { source_id: 'task-0', target_id: 'task-1' },
        { source_id: 'task-1', target_id: 'task-2' },
      ],
      usage: {
        input_tokens: 200,
        output_tokens: 400,
        model: 'gpt-4o',
      },
    };

    const createdMessageDoc = {
      _id: new Types.ObjectId(),
      playbookId: new Types.ObjectId(playbookId),
      createdBy: new Types.ObjectId(userId),
      userQuery: dto.query,
      aiSummary: 'Added 1 step, Added 1 connection',
      snapshotBefore: { tasks: existingPlaybook.tasks, edges: existingPlaybook.edges },
      status: 'completed',
      revertedFromMessageId: null,
      error: null,
      createdAt: new Date('2026-03-17T10:00:00Z'),
      updatedAt: new Date('2026-03-17T10:00:00Z'),
    };

    const updatedPlaybook = {
      id: playbookId,
      tasks: [],
      edges: [],
    };

    beforeEach(() => {
      playbookService.findById.mockResolvedValue(existingPlaybook);
      grpcService.generatePlaybook.mockResolvedValue(grpcDesignResponse);
      playbookService.update.mockResolvedValue(updatedPlaybook);
      designMessageModel.create.mockResolvedValue(createdMessageDoc);
    });

    it('should throw ServiceUnavailableException when gRPC is unavailable', async () => {
      grpcService.isAvailable = false;

      await expect(service.designPlaybook(userId, playbookId, dto)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should load the current playbook by id', async () => {
      await service.designPlaybook(userId, playbookId, dto);

      expect(playbookService.findById).toHaveBeenCalledWith(playbookId);
    });

    it('should propagate error when playbook is not found', async () => {
      playbookService.findById.mockRejectedValue(new Error('Not found'));

      await expect(service.designPlaybook(userId, playbookId, dto)).rejects.toThrow();
    });

    it('should resolve agents and build gRPC agents', async () => {
      await service.designPlaybook(userId, playbookId, dto);

      expect(agentService.getAgentsForUser).toHaveBeenCalledWith(userId);
      expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith(
        userId,
        [agentId1, agentId2],
        mockDefaultModel.id,
      );
      expect(contextService.resolveAgentBrainContexts).toHaveBeenCalledWith(mockGrpcAgents);
    });

    it('should build workspace contexts from playbook workspaces', async () => {
      await service.designPlaybook(userId, playbookId, dto);

      expect(contextService.buildWorkspaceContexts).toHaveBeenCalledWith(
        existingPlaybook.workspaces,
      );
    });

    it('should handle playbook with no workspaces', async () => {
      playbookService.findById.mockResolvedValue({
        ...existingPlaybook,
        workspaces: undefined,
      });

      await service.designPlaybook(userId, playbookId, dto);

      expect(contextService.buildWorkspaceContexts).toHaveBeenCalledWith([]);
    });

    it('should build correct gRPC request with existing playbook data', async () => {
      await service.designPlaybook(userId, playbookId, dto);

      expect(grpcService.generatePlaybook).toHaveBeenCalledWith(
        expect.objectContaining({
          query: dto.query,
          available_agents: mockGrpcAgents,
          model: mockDefaultModel.id,
          prompt_overrides: expect.any(Object),
          existing_playbook: {
            nodes: existingPlaybook.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              assigned_agent_id: t.assignedAgentId || '',
              execution_order: t.executionOrder,
              x: t.positionX,
              y: t.positionY,
              interrupt_before: t.interruptBefore,
              interrupt_after: t.interruptAfter,
              allow_clarification: t.allowClarification,
              clarification_prompt: t.clarificationPrompt,
              max_clarifications: t.maxClarifications,
              input_keys: t.inputKeys,
              output_key: t.outputKey,
            })),
            edges: existingPlaybook.edges.map((e) => ({
              source_id: e.sourceId,
              source_output_port_id: 'default',
              target_id: e.targetId,
              target_input_port_id: 'default',
            })),
          },
        }),
      );
    });

    it('should update the playbook with mapped tasks and edges', async () => {
      await service.designPlaybook(userId, playbookId, dto);

      expect(playbookService.update).toHaveBeenCalledWith(playbookId, {
        tasks: expect.arrayContaining([
          expect.objectContaining({ id: 'task-0', title: 'Gather Info' }),
          expect.objectContaining({ id: 'task-1', title: 'Setup Account' }),
          expect.objectContaining({ id: 'task-2', title: 'Send Notification' }),
        ]),
        edges: expect.arrayContaining([
          expect.objectContaining({ sourceId: 'task-0', targetId: 'task-1' }),
          expect.objectContaining({ sourceId: 'task-1', targetId: 'task-2' }),
        ]),
      });
    });

    it('should create a design message with correct fields', async () => {
      await service.designPlaybook(userId, playbookId, dto);

      expect(designMessageModel.create).toHaveBeenCalledWith({
        playbookId: new Types.ObjectId(playbookId),
        createdBy: new Types.ObjectId(userId),
        userQuery: dto.query,
        aiSummary: expect.any(String),
        snapshotBefore: {
          tasks: existingPlaybook.tasks.map((t) => ({ ...t })),
          edges: existingPlaybook.edges.map((e) => ({ ...e })),
        },
        status: 'completed',
        error: null,
      });
    });

    it('should return the updated playbook and mapped design message', async () => {
      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.playbook).toEqual(updatedPlaybook);
      expect(result.message).toEqual({
        id: createdMessageDoc._id.toString(),
        playbookId: createdMessageDoc.playbookId.toString(),
        userQuery: dto.query,
        aiSummary: createdMessageDoc.aiSummary,
        snapshotBefore: createdMessageDoc.snapshotBefore,
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: createdMessageDoc.createdAt.toISOString(),
        updatedAt: createdMessageDoc.updatedAt.toISOString(),
      });
    });

    it('should record usage when usage data is present', async () => {
      await service.designPlaybook(userId, playbookId, dto);

      expect(usageService.recordUsage).toHaveBeenCalledWith({
        userId,
        inputTokens: 200,
        outputTokens: 400,
        usageType: 'playbook',
        modelName: 'gpt-4o',
        endpoint: 'playbook.design',
      });
    });

    it('should not record usage when usage data is absent', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step 1' }],
        edges: [],
        usage: null,
      });

      await service.designPlaybook(userId, playbookId, dto);

      expect(usageService.recordUsage).not.toHaveBeenCalled();
    });

    it('should not throw when usage recording fails', async () => {
      usageService.recordUsage.mockRejectedValue(new Error('Usage DB error'));

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.playbook).toBeDefined();
    });

    describe('gRPC failure handling', () => {
      it('should create a failed design message on gRPC error', async () => {
        const failedMessageDoc = {
          ...createdMessageDoc,
          aiSummary: '',
          status: 'failed',
          error: 'gRPC timeout',
        };
        designMessageModel.create.mockResolvedValue(failedMessageDoc);
        grpcService.generatePlaybook.mockRejectedValue(new Error('gRPC timeout'));

        const result = await service.designPlaybook(userId, playbookId, dto);

        expect(designMessageModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            playbookId: new Types.ObjectId(playbookId),
            createdBy: new Types.ObjectId(userId),
            userQuery: dto.query,
            aiSummary: '',
            status: 'failed',
            error: 'gRPC timeout',
          }),
        );
        expect(result.playbook).toBeNull();
        expect(result.message.status).toBe('failed');
      });

      it('should not re-throw application exceptions without errorCode property', async () => {
        const appError = new ServiceUnavailableException(ErrorCode.PLAYBOOK_GENERATE_FAILED);
        const failedMessageDoc = {
          ...createdMessageDoc,
          aiSummary: '',
          status: 'failed',
          error: appError.message,
        };
        designMessageModel.create.mockResolvedValue(failedMessageDoc);
        grpcService.generatePlaybook.mockRejectedValue(appError);

        // AppException uses "code", not "errorCode", so it is caught and a failed message is created
        const result = await service.designPlaybook(userId, playbookId, dto);

        expect(result.playbook).toBeNull();
        expect(result.message.status).toBe('failed');
      });

      it('should log error details on gRPC failure', async () => {
        const error = new Error('Connection lost');
        grpcService.generatePlaybook.mockRejectedValue(error);

        await service.designPlaybook(userId, playbookId, dto);

        expect(loggerService.error).toHaveBeenCalledWith('Design gRPC call failed', {
          error: 'Connection lost',
          stack: error.stack,
        });
      });

      it('should use fallback error message when error has no message', async () => {
        const failedMessageDoc = {
          ...createdMessageDoc,
          aiSummary: '',
          status: 'failed',
          error: 'Design failed',
        };
        designMessageModel.create.mockResolvedValue(failedMessageDoc);

        grpcService.generatePlaybook.mockRejectedValue({});

        const result = await service.designPlaybook(userId, playbookId, dto);

        expect(designMessageModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Design failed',
          }),
        );
        expect(result.playbook).toBeNull();
      });
    });

    describe('snapshotBefore', () => {
      it('should capture snapshot of tasks and edges before changes', async () => {
        await service.designPlaybook(userId, playbookId, dto);

        const createCall = designMessageModel.create.mock.calls[0][0];
        expect(createCall.snapshotBefore.tasks).toHaveLength(2);
        expect(createCall.snapshotBefore.edges).toHaveLength(1);
        expect(createCall.snapshotBefore.tasks[0].id).toBe('task-0');
        expect(createCall.snapshotBefore.tasks[1].id).toBe('task-1');
        expect(createCall.snapshotBefore.edges[0].sourceId).toBe('task-0');
      });

      it('should capture a copy of tasks, not a reference', async () => {
        await service.designPlaybook(userId, playbookId, dto);

        const createCall = designMessageModel.create.mock.calls[0][0];
        // The snapshot tasks should be separate objects from the original
        expect(createCall.snapshotBefore.tasks[0]).toEqual(existingPlaybook.tasks[0]);
        expect(createCall.snapshotBefore.tasks[0]).not.toBe(existingPlaybook.tasks[0]);
      });
    });
  });

  describe('mapGrpcResponseToTasksAndEdges (via generatePlaybook)', () => {
    const dto = {
      name: 'Test',
      prompt: 'Create a simple playbook with one step',
    };

    beforeEach(() => {
      playbookService.createWithTasksAndEdges.mockResolvedValue({ id: playbookId });
    });

    it('should use index-based fallback id when node id is missing', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ title: 'Step' }],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].id).toBe('task-0');
    });

    it('should use index-based fallback title when node title is missing', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'node-1' }],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].title).toBe('Step 1');
    });

    it('should default positionX and positionY to 0 when x and y are missing', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step 1' }],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].positionX).toBe(0);
      expect(tasks[0].positionY).toBe(0);
    });

    it('should use execution_order from node or fallback to index', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [
          { id: 'task-0', title: 'A', execution_order: 5 },
          { id: 'task-1', title: 'B' },
        ],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].executionOrder).toBe(5);
      expect(tasks[1].executionOrder).toBe(1);
    });

    it('should set assignedAgentId to null when assigned_agent_id is falsy', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [
          { id: 'task-0', title: 'Step', assigned_agent_id: '' },
          { id: 'task-1', title: 'Step 2', assigned_agent_id: null },
          { id: 'task-2', title: 'Step 3' },
        ],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].assignedAgentId).toBeNull();
      expect(tasks[1].assignedAgentId).toBeNull();
      expect(tasks[2].assignedAgentId).toBeNull();
    });

    it('should convert valid assigned_agent_id to ObjectId', async () => {
      const validObjectId = new Types.ObjectId().toHexString();
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step', assigned_agent_id: validObjectId }],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].assignedAgentId).toEqual(new Types.ObjectId(validObjectId));
    });

    it('should map multiple edges with sequential ids', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [
          { id: 'task-0', title: 'A' },
          { id: 'task-1', title: 'B' },
          { id: 'task-2', title: 'C' },
        ],
        edges: [
          { source_id: 'task-0', target_id: 'task-1' },
          { source_id: 'task-1', target_id: 'task-2' },
          { source_id: 'task-0', target_id: 'task-2' },
        ],
      });

      await service.generatePlaybook(userId, dto);

      const edges = playbookService.createWithTasksAndEdges.mock.calls[0][4];
      expect(edges).toEqual([
        { id: 'edge-0', sourceId: 'task-0', sourceOutputPortId: 'default', targetId: 'task-1', targetInputPortId: 'default' },
        { id: 'edge-1', sourceId: 'task-1', sourceOutputPortId: 'default', targetId: 'task-2', targetInputPortId: 'default' },
        { id: 'edge-2', sourceId: 'task-0', sourceOutputPortId: 'default', targetId: 'task-2', targetInputPortId: 'default' },
      ]);
    });

    it('should default interrupt and clarification flags to false', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step' }],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].interruptBefore).toBe(false);
      expect(tasks[0].interruptAfter).toBe(false);
      expect(tasks[0].allowClarification).toBe(false);
    });

    it('should default maxClarifications to 3', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step' }],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].maxClarifications).toBe(3);
    });

    it('should default inputKeys to empty array and outputKey to empty string', async () => {
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step' }],
        edges: [],
      });

      await service.generatePlaybook(userId, dto);

      const tasks = playbookService.createWithTasksAndEdges.mock.calls[0][3];
      expect(tasks[0].inputKeys).toEqual([]);
      expect(tasks[0].outputKey).toBe('');
    });
  });

  describe('generateDesignSummary (via designPlaybook response)', () => {
    const dto = { query: 'Make changes to the playbook' };

    const existingPlaybook = {
      id: playbookId,
      tasks: [
        {
          id: 'task-0',
          title: 'Step A',
          description: 'Do A',
          assignedAgentId: agentId1,
          executionOrder: 0,
          positionX: 0,
          positionY: 0,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: [],
          outputKey: '',
        },
        {
          id: 'task-1',
          title: 'Step B',
          description: 'Do B',
          assignedAgentId: agentId2,
          executionOrder: 1,
          positionX: 0,
          positionY: 200,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: [],
          outputKey: '',
        },
      ],
      edges: [{ id: 'edge-0', sourceId: 'task-0', targetId: 'task-1' }],
      workspaces: [],
    };

    beforeEach(() => {
      playbookService.findById.mockResolvedValue(existingPlaybook);
      playbookService.update.mockResolvedValue({});
    });

    function setupDesignResponse(nodes: any[], edges: any[]) {
      grpcService.generatePlaybook.mockResolvedValue({ nodes, edges, usage: null });
      designMessageModel.create.mockImplementation((data: any) => ({
        _id: new Types.ObjectId(),
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    }

    it('should report "Added 1 step" when one new task is added', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
          { id: 'task-2', title: 'Step C', description: 'Do C' },
        ],
        [
          { source_id: 'task-0', target_id: 'task-1' },
          { source_id: 'task-1', target_id: 'task-2' },
        ],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Added 1 step');
    });

    it('should report "Added 2 steps" with plural when multiple tasks added', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
          { id: 'task-2', title: 'Step C', description: 'Do C' },
          { id: 'task-3', title: 'Step D', description: 'Do D' },
        ],
        [{ source_id: 'task-0', target_id: 'task-1' }],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Added 2 steps');
    });

    it('should report "Removed 1 step" when a task is removed', async () => {
      setupDesignResponse(
        [{ id: 'task-0', title: 'Step A', description: 'Do A' }],
        [],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Removed 1 step');
    });

    it('should report "Removed 2 steps" with plural when multiple tasks removed', async () => {
      setupDesignResponse([], []);

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Removed 2 steps');
    });

    it('should report "Modified 1 step" when a task title changes', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A Updated', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
        ],
        [{ source_id: 'task-0', target_id: 'task-1' }],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Modified 1 step');
    });

    it('should report "Modified 1 step" when a task description changes', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A differently' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
        ],
        [{ source_id: 'task-0', target_id: 'task-1' }],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Modified 1 step');
    });

    it('should report "Modified 2 steps" with plural when multiple tasks changed', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A v2', description: 'Do A' },
          { id: 'task-1', title: 'Step B v2', description: 'Do B' },
        ],
        [{ source_id: 'task-0', target_id: 'task-1' }],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Modified 2 steps');
    });

    it('should report added connections when new edges appear', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
        ],
        [
          { source_id: 'task-0', target_id: 'task-1' },
          { source_id: 'task-1', target_id: 'task-0' },
        ],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Added 1 connection');
    });

    it('should report "Added 2 connections" with plural', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
        ],
        [
          { source_id: 'task-0', target_id: 'task-1' },
          { source_id: 'task-1', target_id: 'task-0' },
          { source_id: 'task-0', target_id: 'task-0' },
        ],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Added 2 connections');
    });

    it('counts same-node connections separately when their ports differ', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
        ],
        [
          { source_id: 'task-0', target_id: 'task-1' },
          {
            source_id: 'task-0',
            target_id: 'task-1',
            source_output_port_id: 'summary',
            target_input_port_id: 'secondary',
          },
        ],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Added 1 connection');
    });

    it('should report removed connections when edges disappear', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
        ],
        [],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toContain('Removed 1 connection');
    });

    it('should report "No structural changes" when nothing changes', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A', description: 'Do A' },
          { id: 'task-1', title: 'Step B', description: 'Do B' },
        ],
        [{ source_id: 'task-0', target_id: 'task-1' }],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toBe('No structural changes');
    });

    it('should combine multiple change types with commas', async () => {
      setupDesignResponse(
        [
          { id: 'task-0', title: 'Step A Modified', description: 'Do A' },
          { id: 'task-2', title: 'New Step', description: 'New' },
        ],
        [{ source_id: 'task-0', target_id: 'task-2' }],
      );

      const result = await service.designPlaybook(userId, playbookId, dto);

      // Added 1 step (task-2), Removed 1 step (task-1), Modified 1 step (task-0 title changed),
      // Removed 1 connection (task-0->task-1), Added 1 connection (task-0->task-2)
      const summary = result.message.aiSummary;
      expect(summary).toContain('Added 1 step');
      expect(summary).toContain('Removed 1 step');
      expect(summary).toContain('Modified 1 step');
      expect(summary).toContain(',');
    });
  });

  describe('mapDesignMessageToResponse (via designPlaybook return value)', () => {
    const dto = { query: 'Make a small change to the playbook design' };

    const existingPlaybook = {
      id: playbookId,
      tasks: [
        {
          id: 'task-0',
          title: 'Step',
          description: 'Desc',
          assignedAgentId: null,
          executionOrder: 0,
          positionX: 0,
          positionY: 0,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: [],
          outputKey: '',
        },
      ],
      edges: [],
      workspaces: [],
    };

    beforeEach(() => {
      playbookService.findById.mockResolvedValue(existingPlaybook);
      grpcService.generatePlaybook.mockResolvedValue({
        nodes: [{ id: 'task-0', title: 'Step', description: 'Desc' }],
        edges: [],
        usage: null,
      });
      playbookService.update.mockResolvedValue({});
    });

    it('should map _id to id as string', async () => {
      const docId = new Types.ObjectId();
      designMessageModel.create.mockResolvedValue({
        _id: docId,
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: 'No structural changes',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: new Date('2026-03-17T12:00:00Z'),
        updatedAt: new Date('2026-03-17T12:00:00Z'),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.id).toBe(docId.toString());
    });

    it('should map playbookId to string', async () => {
      const pbOid = new Types.ObjectId(playbookId);
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: pbOid,
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.playbookId).toBe(playbookId);
    });

    it('should use "id" field when _id is absent', async () => {
      const msgId = new Types.ObjectId();
      designMessageModel.create.mockResolvedValue({
        id: msgId,
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.id).toBe(msgId.toString());
    });

    it('should default aiSummary to empty string when falsy', async () => {
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: null,
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.aiSummary).toBe('');
    });

    it('should default snapshotBefore to empty tasks and edges when missing', async () => {
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: null,
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.snapshotBefore).toEqual({ tasks: [], edges: [] });
    });

    it('should map revertedFromMessageId to string when present', async () => {
      const revertId = new Types.ObjectId();
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: revertId,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.revertedFromMessageId).toBe(revertId.toString());
    });

    it('should map revertedFromMessageId to null when absent', async () => {
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.revertedFromMessageId).toBeNull();
    });

    it('should default error to null when falsy', async () => {
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.error).toBeNull();
    });

    it('should handle createdAt as ISO string when toISOString is not available', async () => {
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: '2026-03-17T12:00:00.000Z',
        updatedAt: '2026-03-17T12:00:00.000Z',
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.createdAt).toBe('2026-03-17T12:00:00.000Z');
      expect(result.message.updatedAt).toBe('2026-03-17T12:00:00.000Z');
    });

    it('should convert Date objects to ISO strings via toISOString', async () => {
      const date = new Date('2026-03-17T15:30:00Z');
      designMessageModel.create.mockResolvedValue({
        _id: new Types.ObjectId(),
        playbookId: new Types.ObjectId(playbookId),
        userQuery: dto.query,
        aiSummary: '',
        snapshotBefore: { tasks: [], edges: [] },
        status: 'completed',
        revertedFromMessageId: null,
        error: null,
        createdAt: date,
        updatedAt: date,
      });

      const result = await service.designPlaybook(userId, playbookId, dto);

      expect(result.message.createdAt).toBe('2026-03-17T15:30:00.000Z');
      expect(result.message.updatedAt).toBe('2026-03-17T15:30:00.000Z');
    });
  });
});
