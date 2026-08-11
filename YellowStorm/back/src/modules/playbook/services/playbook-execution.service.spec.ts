import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { EventEmitter } from 'events';
import { PlaybookExecutionService } from './playbook-execution.service';
import { PlaybookExecutionGraphService } from './playbook-execution-graph.service';
import { PlaybookExecutionNotificationService } from './playbook-execution-notification.service';
import { PlaybookExecutionBufferService } from './playbook-execution-buffer.service';
import { PlaybookExecutionAdvisorService } from './playbook-execution-advisor.service';
import { PlaybookEvaluationService } from './playbook-evaluation.service';
import { PlaybookService } from './playbook.service';
import { PlaybookGrpcService } from './playbook-grpc.service';
import { PlaybookContextService } from './playbook-context.service';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { LoggerService } from '../../logger';
import { AgentService } from '../../agent/agent.service';
import { ModelsService } from '../../models/models.service';
import { UsageService } from '../../usage/usage.service';
import { EmailService } from '../../email/email.service';
import { UserService } from '../../user/user.service';
import { PlaybookReplayService } from './playbook-replay.service';
import { PlaybookOutputFormatService } from './playbook-output-format.service';
import { PlaybookPromptService } from './playbook-prompt.service';
import { PlaybookSemanticEnrichmentService } from './playbook-semantic-enrichment.service';
import { PlaybookJudgeEnrichmentService } from './playbook-judge-enrichment.service';
import { Connector } from '../../connector/schemas/connector.schema';
import {
  PlaybookExecution,
  ExecutionStatus,
  StepStatus,
  JudgeStatus,
} from '../schemas/playbook-execution.schema';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

// ===== Helpers =====

/** Create a valid ObjectId from a short alias — maps alias to a fixed hex string. */
const objectIdMap: Record<string, string> = {
  user1: '000000000000000000000001',
  pb1: '000000000000000000000002',
  exec1: '000000000000000000000003',
  agent1: '000000000000000000000004',
  ws1: '000000000000000000000005',
  ws2: '000000000000000000000006',
  'other-user': '000000000000000000000007',
  'active-exec': '000000000000000000000008',
};
const objectId = (id = 'user1') =>
  new Types.ObjectId(
    objectIdMap[id] ??
      id
        .padEnd(24, '0')
        .replace(/[^a-f0-9]/gi, 'a')
        .slice(0, 24),
  );

/** executePlaybook starts runFullWorkflow without awaiting; listeners attach after microtasks (no setImmediate — works with jest fake timers). */
async function waitForWorkflowStreamReady(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await Promise.resolve();
  }
}

function createMockExecution(overrides: Record<string, any> = {}) {
  return {
    _id: objectId('exec1'),
    playbookId: objectId('pb1'),
    executedBy: objectId('user1'),
    executionNumber: 1,
    status: ExecutionStatus.RUNNING,
    taskResults: [
      {
        taskId: 'task-1',
        nodeTitle: 'Task One',
        agentName: 'Agent A',
        order: 0,
        status: StepStatus.PENDING,
        output: null,
        error: null,
        durationMs: null,
        startedAt: null,
        completedAt: null,
        components: [],
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        modelName: null,
      },
      {
        taskId: 'task-2',
        nodeTitle: 'Task Two',
        agentName: 'Agent B',
        order: 1,
        status: StepStatus.PENDING,
        output: null,
        error: null,
        durationMs: null,
        startedAt: null,
        completedAt: null,
        components: [],
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        modelName: null,
      },
    ],
    threadId: null,
    interruptPayload: null,
    error: null,
    durationMs: null,
    startedAt: new Date('2026-03-10T10:00:00Z'),
    completedAt: null,
    singleStepTaskId: null,
    playbookSnapshot: { tasks: [], edges: [] },
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    createdAt: new Date('2026-03-10T10:00:00Z'),
    updatedAt: new Date('2026-03-10T10:00:00Z'),
    ...overrides,
  };
}

function createMockPlaybook(overrides: Record<string, any> = {}) {
  return {
    _id: objectId('pb1'),
    name: 'Test Playbook',
    tasks: [
      {
        id: 'task-1',
        title: 'Task One',
        description: 'First task',
        assignedAgentId: objectId('agent1'),
        executionOrder: 0,
        interruptBefore: false,
        interruptAfter: false,
        allowClarification: false,
        clarificationPrompt: '',
        maxClarifications: 3,
        inputKeys: [],
        outputKey: '',
        toObject: function () {
          return { ...this };
        },
      },
      {
        id: 'task-2',
        title: 'Task Two',
        description: 'Second task',
        assignedAgentId: objectId('agent1'),
        executionOrder: 1,
        interruptBefore: false,
        interruptAfter: false,
        allowClarification: false,
        clarificationPrompt: '',
        maxClarifications: 3,
        inputKeys: [],
        outputKey: '',
        toObject: function () {
          return { ...this };
        },
      },
    ],
    edges: [
      {
        sourceId: 'task-1',
        targetId: 'task-2',
        toObject: function () {
          return { sourceId: 'task-1', targetId: 'task-2' };
        },
      },
    ],
    workspaces: [objectId('ws1')],
    ...overrides,
  };
}

// ===== Mock Factories =====

function createChainMock(data: any = null) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(data),
      }),
    }),
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(data),
    }),
    exec: jest.fn().mockResolvedValue(data),
  };
}

// ===== Test Suite =====

describe('PlaybookExecutionService', () => {
  let service: PlaybookExecutionService;
  let mockExecutionModel: any;
  let mockPlaybookService: any;
  let mockGrpcService: any;
  let mockContextService: any;
  let mockStreamGateway: any;
  let mockAgentService: any;
  let mockModelsService: any;
  let mockUsageService: any;
  let mockEmailService: any;
  let mockUserService: any;
  let mockReplayService: any;
  let mockOutputFormatService: any;
  let mockPromptService: any;
  let mockSemanticEnrichmentService: any;
  let mockJudgeEnrichmentService: any;
  let mockConnectorModel: any;
  let mockLoggerService: any;
  let mockConfigService: any;
  let mockNotificationService: any;
  let mockBufferService: any;

  const defaultConfig: Record<string, any> = {
    'playbook.maxComponentsPerTask': 200,
    'playbook.maxConcurrentSteps': 5,
    'app.frontendUrl': 'http://localhost:5173',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLoggerService = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => defaultConfig[key] ?? defaultValue),
    };

    mockPlaybookService = {
      findRawById: jest.fn(),
      findByIntegrationToken: jest.fn(),
      getNextExecutionNumber: jest.fn().mockResolvedValue(1),
    };

    mockGrpcService = {
      isAvailable: true,
      runStep: jest.fn(),
      runStepStream: jest.fn(),
      // Default stream stub: executePlaybook fire-and-forgets runFullWorkflow. Without a
      // cancelable stream, consumePlaybookStream used to arm an idle timer then throw on
      // call.on, leaking a Timeout that later crashed CI with call.cancel on undefined.
      runPlaybookWorkflow: jest.fn(() => {
        const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
        stream.cancel = jest.fn();
        return stream;
      }),
      resumePlaybookWorkflow: jest.fn(() => {
        const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
        stream.cancel = jest.fn();
        return stream;
      }),
      resumeStep: jest.fn(),
      stopPlaybookWorkflow: jest.fn(),
      registerStream: jest.fn(),
      removeStream: jest.fn(),
      getStream: jest.fn(),
      markCancelled: jest.fn(),
      wasCancelled: jest.fn().mockReturnValue(false),
      workflowTimeoutMs: 600000,
    };

    mockContextService = {
      buildWorkspaceContexts: jest.fn().mockResolvedValue([]),
      resolveAgentBrainContexts: jest.fn().mockResolvedValue(undefined),
    };

    mockStreamGateway = {
      sendToUser: jest.fn(),
    };

    mockAgentService = {
      buildGrpcAgentsForPlaybook: jest
        .fn()
        .mockResolvedValue([{ id: objectId('agent1').toString(), name: 'Agent A' }]),
    };

    mockModelsService = {
      getDefaultModel: jest.fn().mockResolvedValue({ id: 'model-1' }),
    };

    mockUsageService = {
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };

    mockEmailService = {
      isAvailable: jest.fn().mockReturnValue(false),
      send: jest.fn().mockResolvedValue(undefined),
    };

    mockUserService = {
      findById: jest.fn().mockResolvedValue({ email: 'user@test.com' }),
    };

    mockReplayService = {
      getActiveReplays: jest.fn().mockResolvedValue(new Map()),
    };

    mockOutputFormatService = {
      getActiveTemplates: jest.fn().mockResolvedValue(new Map()),
      getActiveTemplatesByPlaybook: jest.fn().mockResolvedValue(new Map()),
      getActiveTemplate: jest.fn().mockResolvedValue(null),
      applyOutputFormatToTasks: jest.fn().mockResolvedValue(undefined),
    };

    mockPromptService = {
      getActivePromptTemplates: jest.fn().mockResolvedValue(new Map()),
      resolvePromptTemplate: jest.fn().mockReturnValue(null),
      getPromptOverridesPayload: jest.fn().mockResolvedValue(undefined),
    };

    mockSemanticEnrichmentService = {
      schedule: jest.fn(),
      evaluateNow: jest.fn(),
    };

    mockJudgeEnrichmentService = {
      schedule: jest.fn(),
      scheduleExecutionSweep: jest.fn(),
      evaluateNodeNow: jest.fn().mockResolvedValue(undefined),
      evaluateExecutionSummaryNowIfReady: jest.fn().mockResolvedValue(undefined),
    };

    mockConnectorModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    };

    mockNotificationService = {
      sendStepNotificationEmail: jest.fn(),
      notifyScheduledRunFinished: jest.fn(),
      buildExecutionDetailUrl: jest.fn((pbId: string, execId: string) => `http://localhost:5173/#/playbooks/${pbId}/executions/${execId}`),
      formatExecutionSummaryForEmail: jest.fn(),
    };

    mockBufferService = {
      activeStepBuffers: new Map<string, Map<string, any>>(),
      flushStepBuffer: jest.fn(async (_execId: string, _stepBuffer: any, postFlush?: (taskId: string, buffered: any) => Promise<void>) => {
        if (postFlush) {
          for (const [taskId, buffered] of _stepBuffer) {
            await postFlush(taskId, buffered);
          }
        }
      }),
      // These are async on the real service and the execution path chains
      // `.then()` off flushBufferedTaskResult, so a bare jest.fn() (undefined)
      // throws instead of resolving.
      flushBufferedTaskResult: jest.fn().mockResolvedValue(undefined),
      recordBufferedTaskUsage: jest.fn().mockResolvedValue(undefined),
      recordStreamUsage: jest.fn().mockResolvedValue(undefined),
      mergeTaskResultWithBuffer: jest.fn((dbTr: any, buffered: any) => {
        const STATUS_WEIGHT: Record<string, number> = {
          [StepStatus.PENDING]: 0,
          [StepStatus.RUNNING]: 1,
          [StepStatus.COMPLETED]: 2,
          [StepStatus.FAILED]: 2,
          [StepStatus.SKIPPED]: 2,
        };
        const dbWeight = STATUS_WEIGHT[dbTr.status] ?? 0;
        const bufWeight = STATUS_WEIGHT[buffered.status] ?? 0;
        if (bufWeight < dbWeight) return dbTr;
        return { ...dbTr, ...buffered };
      }),
      setBuffer: jest.fn(),
      getBuffer: jest.fn(),
      getOrCreateBuffer: jest.fn(),
      deleteBuffer: jest.fn(),
      deleteTaskFromBuffer: jest.fn(),
    };

    // Create a mock model that is both a constructor and has static methods
    mockExecutionModel = jest.fn().mockImplementation((data) => ({
      ...data,
      _id: objectId('exec1'),
      save: jest.fn().mockResolvedValue(data),
    }));
    mockExecutionModel.find = jest.fn().mockReturnValue(createChainMock([]));
    mockExecutionModel.findById = jest.fn().mockReturnValue(createChainMock(null));
    mockExecutionModel.findByIdAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    mockExecutionModel.findOne = jest.fn().mockReturnValue(createChainMock(null));
    mockExecutionModel.updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    });
    mockExecutionModel.create = jest.fn().mockResolvedValue({
      _id: objectId('exec1'),
      toString: () => objectId('exec1').toString(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybookExecutionService,
        { provide: getModelToken(PlaybookExecution.name), useValue: mockExecutionModel },
        { provide: getModelToken(Connector.name), useValue: mockConnectorModel },
        { provide: PlaybookService, useValue: mockPlaybookService },
        { provide: PlaybookGrpcService, useValue: mockGrpcService },
        { provide: PlaybookContextService, useValue: mockContextService },
        { provide: PlaybookStreamGatewayService, useValue: mockStreamGateway },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: AgentService, useValue: mockAgentService },
        { provide: ModelsService, useValue: mockModelsService },
        { provide: UsageService, useValue: mockUsageService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: UserService, useValue: mockUserService },
        { provide: PlaybookReplayService, useValue: mockReplayService },
        { provide: PlaybookOutputFormatService, useValue: mockOutputFormatService },
        { provide: PlaybookPromptService, useValue: mockPromptService },
        { provide: PlaybookSemanticEnrichmentService, useValue: mockSemanticEnrichmentService },
        { provide: PlaybookJudgeEnrichmentService, useValue: mockJudgeEnrichmentService },
        { provide: 'ConnectorAuthService', useValue: {} },
        PlaybookExecutionGraphService,
        { provide: PlaybookExecutionNotificationService, useValue: mockNotificationService },
        { provide: PlaybookExecutionBufferService, useValue: mockBufferService },
        PlaybookExecutionAdvisorService,
        // Fire-and-forget from the execution path; the spec only needs it to resolve.
        {
          provide: PlaybookEvaluationService,
          useValue: { persistEvaluationExecution: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<PlaybookExecutionService>(PlaybookExecutionService);
  });

  afterEach(async () => {
    // executePlaybook fire-and-forgets runFullWorkflow; idle timers may be armed only after
    // the test body returns. Drain microtasks first so clearAllTimers can catch them.
    for (let i = 0; i < 40; i++) {
      await Promise.resolve();
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // ===== Constructor =====

  describe('constructor', () => {
    it('should set logger context', () => {
      expect(mockLoggerService.setContext).toHaveBeenCalledWith('PlaybookExecutionService');
    });

    it('should read maxComponentsPerTask from config', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith('playbook.maxComponentsPerTask');
    });

    it('should read maxConcurrentSteps from config', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith('playbook.maxConcurrentSteps');
    });
  });

  describe('mapGrpcSemanticMatch', () => {
    it('should map evidence consistency and judge metadata from gRPC payload', () => {
      const result = (service as any).mapGrpcSemanticMatch({
        match_score: 91,
        semantic_similarity_score: 88,
        evidence_consistency_score: 93,
        judge_score: 90,
        reason: 'Outputs align with the validated baseline.',
        missing_points: ['One omitted detail'],
        changed_points: ['Minor wording update'],
        model: 'test-evaluation-model',
        judge_used: true,
      });

      expect(result).toEqual({
        matchScore: 91,
        semanticSimilarityScore: 88,
        evidenceConsistencyScore: 93,
        judgeScore: 90,
        reason: 'Outputs align with the validated baseline.',
        missingPoints: ['One omitted detail'],
        changedPoints: ['Minor wording update'],
        model: 'test-evaluation-model',
        judgeUsed: true,
      });
    });

    it('should return null when gRPC payload has no semantic match signal', () => {
      expect((service as any).mapGrpcSemanticMatch({})).toBeNull();
      expect((service as any).mapGrpcSemanticMatch(null)).toBeNull();
    });
  });

  // ===== executePlaybook =====

  describe('executePlaybookByIntegrationToken', () => {
    it('should resolve the playbook owner and delegate to executePlaybook', async () => {
      const playbook = {
        _id: objectId('pb1'),
        createdBy: objectId('user1'),
      };
      mockPlaybookService.findByIntegrationToken.mockResolvedValue(playbook);
      mockUserService.findById.mockResolvedValue({ email: 'owner@example.com' });

      const executeSpy = jest
        .spyOn(service, 'executePlaybook')
        .mockResolvedValue({ executionId: 'exec-public-1' });

      const result = await service.executePlaybookByIntegrationToken('public-token', {} as any);

      expect(mockPlaybookService.findByIntegrationToken).toHaveBeenCalledWith('public-token');
      expect(mockUserService.findById).toHaveBeenCalledWith(objectId('user1').toString());
      expect(executeSpy).toHaveBeenCalledWith(
        objectId('user1').toString(),
        objectId('pb1').toString(),
        {},
        'owner@example.com',
        // The owner's appearance language is resolved and forwarded, default 'en'.
        { executionTrigger: 'manual', userLanguage: 'en' },
      );
      expect(result).toEqual({ executionId: 'exec-public-1' });
    });
  });

  describe('executePlaybook', () => {
    const userId = objectId('user1').toString();
    const playbookId = objectId('pb1').toString();
    const dto = {};
    const userEmail = 'test@example.com';

    it('should throw ServiceUnavailableException when gRPC is not available', async () => {
      mockGrpcService.isAvailable = false;

      await expect(service.executePlaybook(userId, playbookId, dto, userEmail)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw NotFoundException when playbook is not found', async () => {
      mockPlaybookService.findRawById.mockResolvedValue(null);

      await expect(service.executePlaybook(userId, playbookId, dto, userEmail)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when active execution exists', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);

      // findOne returns an active execution
      mockExecutionModel.findOne.mockReturnValue(
        createChainMock({ _id: objectId('active-exec'), status: ExecutionStatus.RUNNING }),
      );

      await expect(service.executePlaybook(userId, playbookId, dto, userEmail)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should create execution record with correct task results', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockPlaybookService.getNextExecutionNumber.mockResolvedValue(5);

      // No active execution
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));

      // Mock create
      const createdExec = { _id: objectId('exec1'), toString: () => objectId('exec1').toString() };
      mockExecutionModel.create.mockResolvedValue(createdExec);

      // For the fire-and-forget methods: mock findById for runFullWorkflow/runExecutionLoop
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      const result = await service.executePlaybook(userId, playbookId, dto, userEmail);

      expect(result).toEqual({ executionId: objectId('exec1').toString() });
      expect(mockExecutionModel.create).toHaveBeenCalledTimes(1);

      const createArg = mockExecutionModel.create.mock.calls[0][0];
      expect(createArg.executionNumber).toBe(5);
      expect(createArg.status).toBe(ExecutionStatus.RUNNING);
      expect(createArg.executionTrigger).toBe('manual');
      expect(createArg.taskResults).toHaveLength(2);

      // Both tasks should be PENDING in full workflow mode
      expect(createArg.taskResults[0].status).toBe(StepStatus.PENDING);
      expect(createArg.taskResults[1].status).toBe(StepStatus.PENDING);

      // Verify task results have correct metadata
      expect(createArg.taskResults[0].taskId).toBe('task-1');
      expect(createArg.taskResults[0].nodeTitle).toBe('Task One');
      expect(createArg.taskResults[0].output).toBeNull();
      expect(createArg.taskResults[0].error).toBeNull();
    });

    it('should set executionTrigger to scheduled when options request scheduled', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockPlaybookService.getNextExecutionNumber.mockResolvedValue(1);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, dto, userEmail, {
        executionTrigger: 'scheduled',
      });

      const createArg = mockExecutionModel.create.mock.calls[0][0];
      expect(createArg.executionTrigger).toBe('scheduled');
    });

    it('should persist triggerContext when options request mail execution', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockPlaybookService.getNextExecutionNumber.mockResolvedValue(1);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, dto, userEmail, {
        executionTrigger: 'mail',
        triggerContext: {
          type: 'mail',
          occurredAt: '2026-04-17T12:00:00Z',
          payload: { message: { providerMessageId: 'msg-123' } },
        },
      });

      const createArg = mockExecutionModel.create.mock.calls[0][0];
      expect(createArg.executionTrigger).toBe('mail');
      expect(createArg.triggerContext).toEqual({
        type: 'mail',
        occurredAt: '2026-04-17T12:00:00Z',
        payload: { message: { providerMessageId: 'msg-123' } },
      });
    });

    it('should mark non-target tasks as SKIPPED in single-step mode', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));

      const createdExec = { _id: objectId('exec1'), toString: () => objectId('exec1').toString() };
      mockExecutionModel.create.mockResolvedValue(createdExec);
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, { singleStepTaskId: 'task-1' }, userEmail);

      const createArg = mockExecutionModel.create.mock.calls[0][0];
      // task-1 should be PENDING (the target)
      const task1 = createArg.taskResults.find((tr: any) => tr.taskId === 'task-1');
      expect(task1.status).toBe(StepStatus.PENDING);

      // task-2 should be SKIPPED (not the target)
      const task2 = createArg.taskResults.find((tr: any) => tr.taskId === 'task-2');
      expect(task2.status).toBe(StepStatus.SKIPPED);
    });

    it('should send SSE playbook_execution_start event', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, dto, userEmail);

      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_execution_start',
          data: expect.objectContaining({
            executionId: objectId('exec1').toString(),
            playbookId,
            status: ExecutionStatus.RUNNING,
            executionTrigger: 'manual',
          }),
        }),
      );
    });

    it('should return { executionId }', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      const result = await service.executePlaybook(userId, playbookId, dto, userEmail);
      expect(result).toEqual({ executionId: objectId('exec1').toString() });
    });

    it('should resolve agents referenced by playbook tasks', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, dto, userEmail);

      expect(mockModelsService.getDefaultModel).toHaveBeenCalled();
      expect(mockAgentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith(
        userId,
        [objectId('agent1').toString()],
        'model-1',
        'playbook:000000000000000000000002:execution:1',
      );
      expect(mockContextService.resolveAgentBrainContexts).toHaveBeenCalled();
    });

    it('should handle agent loading failure gracefully', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      // Agent loading fails
      mockAgentService.buildGrpcAgentsForPlaybook.mockRejectedValue(new Error('Agent load failed'));

      // Should not throw — still creates execution
      const result = await service.executePlaybook(userId, playbookId, dto, userEmail);
      expect(result).toEqual({ executionId: objectId('exec1').toString() });
      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        'Failed to load agents for playbook execution',
        expect.any(Object),
      );
    });

    it('should build workspace contexts from playbook workspaces', async () => {
      const playbook = createMockPlaybook({
        workspaces: [objectId('ws1'), objectId('ws2')],
      });
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, dto, userEmail);

      expect(mockContextService.buildWorkspaceContexts).toHaveBeenCalledWith([
        objectId('ws1').toString(),
        objectId('ws2').toString(),
      ]);
    });

    it('should store singleStepTaskId on execution record', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, { singleStepTaskId: 'task-1' }, userEmail);

      const createArg = mockExecutionModel.create.mock.calls[0][0];
      expect(createArg.singleStepTaskId).toBe('task-1');
    });

    it('should store playbookSnapshot on execution record', async () => {
      const playbook = createMockPlaybook();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, dto, userEmail);

      const createArg = mockExecutionModel.create.mock.calls[0][0];
      expect(createArg.playbookSnapshot).toBeDefined();
      expect(createArg.playbookSnapshot.tasks).toHaveLength(2);
      expect(createArg.playbookSnapshot.edges).toHaveLength(1);
    });

    it('preserves __trigger__ edges in execution snapshots', async () => {
      const playbook = createMockPlaybook({
        edges: [
          {
            id: 'edge-trigger',
            sourceId: '__trigger__',
            targetId: 'task-1',
            sourceOutputPortId: 'mail_data',
            targetInputPortId: 'default',
          },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));

      await service.executePlaybook(userId, playbookId, dto, userEmail);

      const createArg = mockExecutionModel.create.mock.calls[0][0];
      expect(createArg.playbookSnapshot.edges).toEqual([
        expect.objectContaining({
          sourceId: '__trigger__',
          sourceOutputPortId: 'mail_data',
          targetId: 'task-1',
          targetInputPortId: 'default',
        }),
      ]);
    });

    it('forwards triggerContext to single-step RunStep requests as a plain struct object', async () => {
      const playbook = createMockPlaybook({
        tasks: [
          {
            id: 'task-1',
            title: 'Task One',
            description: 'First task',
            assignedAgentId: objectId('agent1'),
            executionOrder: 0,
            interruptBefore: false,
            interruptAfter: false,
            allowClarification: false,
            clarificationPrompt: '',
            maxClarifications: 3,
            inputKeys: [],
            outputKey: '',
            inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'data', required: false }],
            outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
            toObject: function () {
              return { ...this };
            },
          },
        ],
        edges: [
          {
            id: 'edge-trigger',
            sourceId: '__trigger__',
            targetId: 'task-1',
            sourceOutputPortId: 'mail_data',
            targetInputPortId: 'default',
            toObject: function () {
              return { ...this };
            },
          },
        ],
      });
      const triggerContext = {
        type: 'mail',
        ports: {
          mail_data: {
            kind: 'data',
            value: {
              subject: 'FW: Yellowsys.ai',
              bodyText: 'Expected body',
            },
          },
        },
      };

      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(
        createChainMock(
          createMockExecution({
            playbookSnapshot: {
              tasks: playbook.tasks.map((task: any) => ({ ...task })),
              edges: playbook.edges.map((edge: any) => ({ ...edge })),
            },
            triggerContext,
          }),
        ),
      );
      mockGrpcService.runStep.mockResolvedValue({
        status: 'skipped',
        result: { task_id: 'task-1', status: 'skipped' },
      });
      const grpcAgentMap = new Map([[objectId('agent1').toString(), { id: objectId('agent1').toString(), name: 'Agent One' }]]);

      await (service as any).runSingleStepExecution(
        userId,
        objectId('exec1').toString(),
        playbook,
        playbook.tasks[0],
        grpcAgentMap,
        [],
        userEmail,
        'live',
        null,
        false,
        false,
        false,
      );

      expect(mockGrpcService.runStep).toHaveBeenCalled();
      expect(mockGrpcService.runStep.mock.calls[0][0].trigger_context).toEqual(triggerContext);
    });

    it('preserves distinct same-node edges when ports differ in snapshot merges', () => {
      const snapshot = {
        tasks: [{ id: 'task-1' }, { id: 'task-2' }],
        edges: [
          {
            id: 'edge-existing',
            sourceId: 'task-1',
            targetId: 'task-2',
            sourceOutputPortId: 'documents',
            targetInputPortId: 'primary',
          },
        ],
      };
      const playbook = createMockPlaybook({
        tasks: [{ id: 'task-1' }, { id: 'task-2' }],
        edges: [
          {
            id: 'edge-existing',
            sourceId: 'task-1',
            targetId: 'task-2',
            sourceOutputPortId: 'documents',
            targetInputPortId: 'primary',
          },
          {
            id: 'edge-secondary',
            sourceId: 'task-1',
            targetId: 'task-2',
            sourceOutputPortId: 'summary',
            targetInputPortId: 'secondary',
          },
        ],
      });

      const merged = (service as any).graphService.mergeSnapshotForNewTask(snapshot, playbook, 'task-1');

      expect(merged.edges).toHaveLength(2);
      expect(merged.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'task-1',
            targetId: 'task-2',
            sourceOutputPortId: 'documents',
            targetInputPortId: 'primary',
          }),
          expect.objectContaining({
            sourceId: 'task-1',
            targetId: 'task-2',
            sourceOutputPortId: 'summary',
            targetInputPortId: 'secondary',
          }),
        ]),
      );
    });
  });

  // ===== handleStepUpdate (tested via consumePlaybookStream) =====

  describe('handleStepUpdate (via consumePlaybookStream)', () => {
    /**
     * We access handleStepUpdate indirectly by mocking a gRPC stream
     * and feeding data events to consumePlaybookStream. We verify SSE
     * events and buffer state via findActiveExecutionsByUser.
     */

    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should send SSE playbook_step_start for in_progress status', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const playbook = createMockPlaybook();
      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      mockExecutionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
      mockExecutionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const userId = objectId('user1').toString();
      const playbookId = objectId('pb1').toString();
      await service.executePlaybook(userId, playbookId, {}, 'user@test.com');
      await waitForWorkflowStreamReady();

      // Emit in_progress step update
      mockStream.emit('data', {
        step_update: { task_id: 'task-1', status: 'in_progress' },
      });

      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_step_start',
          data: expect.objectContaining({
            executionId: objectId('exec1').toString(),
            taskId: 'task-1',
            status: 'running',
          }),
        }),
      );
    });

    it('should send SSE playbook_step_complete for completed status', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, 'user@test.com');
      await waitForWorkflowStreamReady();

      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: {
            components: [],
            duration_ms: '1500',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
              model: 'test-runtime-model-a',
            },
          },
        },
      });

      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_step_complete',
          data: expect.objectContaining({
            taskId: 'task-1',
            status: 'completed',
            durationMs: 1500,
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            modelName: 'test-runtime-model-a',
          }),
        }),
      );
    });

    it('should derive completed status from result payload when step status is missing', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, 'user@test.com');
      await waitForWorkflowStreamReady();

      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          result: {
            status: 'completed',
            components: [],
            duration_ms: '1500',
          },
        },
      });

      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_step_complete',
          data: expect.objectContaining({
            taskId: 'task-1',
            status: 'completed',
            durationMs: 1500,
          }),
        }),
      );
    });

    it('should send SSE playbook_step_complete for failed status with error', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, 'user@test.com');
      await waitForWorkflowStreamReady();

      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'failed',
          result: {
            error: 'Something broke',
            components: [],
            duration_ms: '500',
          },
        },
      });

      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_step_complete',
          data: expect.objectContaining({
            taskId: 'task-1',
            status: 'failed',
            error: 'Something broke',
            durationMs: 500,
          }),
        }),
      );
    });

    it('should preserve existing buffer data on suspended status', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, 'user@test.com');
      await waitForWorkflowStreamReady();

      // First: task starts
      mockStream.emit('data', {
        step_update: { task_id: 'task-1', status: 'in_progress' },
      });

      // Then: completed with output
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: { components: [], duration_ms: '1000' },
        },
      });

      // Then: suspended — should preserve completed data
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'suspended',
          interrupt: { type: 'approval', message: 'Need approval', task_id: 'task-1' },
        },
      });

      // Access activeStepBuffers via findActiveExecutionsByUser (which reads from buffers)
      // The buffer for task-1 should still have durationMs from the completed update
      // but status set to RUNNING (suspended sets it to RUNNING to keep it active)
      // We verify indirectly: the buffer should exist
      const activeBuffers = (service as any).bufferService.activeStepBuffers;
      const buffer = activeBuffers.get(objectId('exec1').toString());
      expect(buffer).toBeDefined();

      const taskBuf = buffer.get('task-1');
      expect(taskBuf).toBeDefined();
      expect(taskBuf.status).toBe(StepStatus.RUNNING);
      // durationMs should be preserved from the completed update
      expect(taskBuf.durationMs).toBe(1000);
    });
  });

  // ===== consumePlaybookStream — buffer lifecycle =====

  describe('consumePlaybookStream (buffer lifecycle)', () => {
    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should register buffer in activeStepBuffers on stream start', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      const activeBuffers = (service as any).bufferService.activeStepBuffers as Map<string, any>;
      expect(activeBuffers.has(objectId('exec1').toString())).toBe(true);
    });

    it('should delete buffer from activeStepBuffers after stream end', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      // Execution with all tasks completed (no pending/running) so we hit markExecutionCompleted
      const completedExecution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.COMPLETED, components: [] },
          { taskId: 'task-2', status: StepStatus.COMPLETED, components: [] },
        ],
      });

      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(completedExecution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Buffer should exist before stream ends
      const activeBuffers = (service as any).bufferService.activeStepBuffers as Map<string, any>;
      expect(activeBuffers.has(objectId('exec1').toString())).toBe(true);

      // End the stream
      mockStream.emit('end');

      // Wait for async handlers
      await new Promise((resolve) => setImmediate(resolve));

      expect(activeBuffers.has(objectId('exec1').toString())).toBe(false);
    });

    it('should delete buffer from activeStepBuffers after stream error', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      const activeBuffers = (service as any).bufferService.activeStepBuffers as Map<string, any>;
      expect(activeBuffers.has(objectId('exec1').toString())).toBe(true);

      // Error the stream
      mockStream.emit('error', new Error('Stream crashed'));

      await new Promise((resolve) => setImmediate(resolve));

      expect(activeBuffers.has(objectId('exec1').toString())).toBe(false);
    });

    it('should flush buffer on cancelled stream error', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);
      mockGrpcService.wasCancelled.mockReturnValue(true);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Buffer in_progress
      mockStream.emit('data', {
        step_update: { task_id: 'task-1', status: 'in_progress' },
      });

      // Error (cancellation)
      mockStream.emit('error', new Error('Cancelled'));

      await new Promise((resolve) => setImmediate(resolve));

      const activeBuffers = (service as any).bufferService.activeStepBuffers as Map<string, any>;
      expect(activeBuffers.has(objectId('exec1').toString())).toBe(false);
      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: objectId('exec1').toString(),
          status: {
            $in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: ExecutionStatus.CANCELLED }),
        }),
      );
      expect(mockLoggerService.error).not.toHaveBeenCalledWith(
        'Workflow stream error',
        expect.anything(),
      );
    });

    it('should fail execution on transport-level gRPC abort errors', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);
      mockGrpcService.wasCancelled.mockReturnValue(false);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      const grpcAbortError = Object.assign(
        new Error('13 INTERNAL: Playbook workflow failed: boom'),
        {
          code: 13,
          details: 'Playbook workflow failed: boom',
        },
      );

      mockStream.emit('error', grpcAbortError);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: objectId('exec1').toString(),
          status: {
            $in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: ExecutionStatus.FAILED }),
        }),
      );
      expect(mockLoggerService.error).toHaveBeenCalledWith(
        'Workflow stream error',
        expect.objectContaining({
          executionId: objectId('exec1').toString(),
          error: grpcAbortError.message,
        }),
      );
    });

    it('should register and remove gRPC stream calls', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.COMPLETED, components: [] },
          { taskId: 'task-2', status: StepStatus.COMPLETED, components: [] },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      expect(mockGrpcService.registerStream).toHaveBeenCalledWith(
        objectId('exec1').toString(),
        mockStream,
      );

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockGrpcService.removeStream).toHaveBeenCalledWith(objectId('exec1').toString());
    });
  });

  // ===== flushStepBuffer (tested via stream end) =====

  describe('flushStepBuffer (via stream end)', () => {
    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should write all buffer entries to DB on stream end', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.COMPLETED, components: [] },
          { taskId: 'task-2', status: StepStatus.COMPLETED, components: [] },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Buffer some step updates
      mockStream.emit('data', {
        step_update: { task_id: 'task-1', status: 'in_progress' },
      });
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: { components: [], duration_ms: '1000' },
        },
      });
      mockStream.emit('data', {
        step_update: { task_id: 'task-2', status: 'in_progress' },
      });
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-2',
          status: 'completed',
          result: { components: [], duration_ms: '2000' },
        },
      });

      // End stream — triggers bufferService.flushStepBuffer
      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockBufferService.flushStepBuffer).toHaveBeenCalled();
    });

    it('should preserve humanFeedback components during flush', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      // Execution has existing humanFeedback component
      const executionWithHF = createMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            status: StepStatus.COMPLETED,
            components: [
              {
                id: 'hf-task-1-123',
                type: 'humanFeedback',
                data: { status: 'answered', approved: true },
              },
            ],
          },
          { taskId: 'task-2', status: StepStatus.COMPLETED, components: [] },
        ],
      });

      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(executionWithHF));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Emit completed with new components
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: { components: [], duration_ms: '1000' },
        },
      });

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockBufferService.flushStepBuffer).toHaveBeenCalled();
    });

    it('schedules enrichment only after the workflow buffer flush persists completed steps', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({ reflectionEnabled: true });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById
        .mockReturnValueOnce(createChainMock(execution))
        .mockReturnValueOnce(createChainMock({ runEvaluation: true, reflectionEnabled: true }))
        .mockReturnValueOnce(createChainMock({ taskResults: execution.taskResults }))
        .mockReturnValueOnce(
          createChainMock({
            taskResults: [
              { ...execution.taskResults[0], status: StepStatus.COMPLETED },
              execution.taskResults[1],
            ],
          }),
        );

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: { components: [], duration_ms: '1000' },
        },
      });

      expect(mockBufferService.flushStepBuffer).not.toHaveBeenCalled();
      expect(mockSemanticEnrichmentService.schedule).not.toHaveBeenCalled();
      expect(mockJudgeEnrichmentService.schedule).not.toHaveBeenCalled();

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockBufferService.flushStepBuffer).toHaveBeenCalled();
      expect(mockSemanticEnrichmentService.schedule).toHaveBeenCalledWith(
        userId,
        objectId('exec1').toString(),
        'task-1',
      );
      expect(mockJudgeEnrichmentService.schedule).toHaveBeenCalledWith(
        userId,
        objectId('exec1').toString(),
        'task-1',
      );
    });
  });

  // ===== findActiveExecutionsByUser =====

  describe('findActiveExecutionsByUser', () => {
    const userId = objectId('user1').toString();

    it('should return mapped executions from DB', async () => {
      const dbExecution = createMockExecution();
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

      const result = await service.findActiveExecutionsByUser(userId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(objectId('exec1').toString());
      expect(result[0].playbookId).toBe(objectId('pb1').toString());
      expect(result[0].executedBy).toBe(objectId('user1').toString());
      expect(result[0].executionNumber).toBe(1);
      expect(result[0].status).toBe(ExecutionStatus.RUNNING);
    });

    it('should return task results with correct shape', async () => {
      const dbExecution = createMockExecution();
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

      const result = await service.findActiveExecutionsByUser(userId);

      const tr = result[0].taskResults[0];
      expect(tr).toHaveProperty('taskId', 'task-1');
      expect(tr).toHaveProperty('nodeTitle', 'Task One');
      expect(tr).toHaveProperty('agentName', 'Agent A');
      expect(tr).toHaveProperty('order', 0);
      expect(tr).toHaveProperty('status', StepStatus.PENDING);
      expect(tr).toHaveProperty('output', null);
      expect(tr).toHaveProperty('error', null);
      expect(tr).toHaveProperty('durationMs', null);
      expect(tr).toHaveProperty('components');
      expect(tr).toHaveProperty('inputTokens', null);
      expect(tr).toHaveProperty('outputTokens', null);
      expect(tr).toHaveProperty('totalTokens', null);
      expect(tr).toHaveProperty('modelName', null);
    });

    it('should return empty array when no active executions', async () => {
      mockExecutionModel.find.mockReturnValue(createChainMock([]));

      const result = await service.findActiveExecutionsByUser(userId);
      expect(result).toEqual([]);
    });

    describe('buffer merge behavior', () => {
      it('should merge in-memory buffer data when activeStepBuffers has an entry', async () => {
        const dbExecution = createMockExecution({
          taskResults: [
            {
              taskId: 'task-1',
              nodeTitle: 'Task One',
              agentName: 'Agent A',
              order: 0,
              status: StepStatus.PENDING,
              output: null,
              error: null,
              durationMs: null,
              startedAt: null,
              completedAt: null,
              components: [{ id: 'c1', type: 'text', data: { content: 'old' } }],
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              modelName: null,
            },
          ],
        });
        mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

        // Inject buffer directly
        const execId = objectId('exec1').toString();
        const buffer = new Map();
        buffer.set('task-1', {
          taskId: 'task-1',
          status: StepStatus.RUNNING,
          startedAt: new Date('2026-03-10T10:05:00Z'),
        });
        (service as any).bufferService.activeStepBuffers.set(execId, buffer);

        const result = await service.findActiveExecutionsByUser(userId);

        const tr = result[0].taskResults[0];
        // Buffer has RUNNING (weight 1) >= DB's PENDING (weight 0), so buffer wins
        expect(tr.status).toBe(StepStatus.RUNNING);
        expect(tr.startedAt).toBeDefined();
        // DB fields that buffer doesn't override stay from DB
        expect(tr.nodeTitle).toBe('Task One');
        expect(tr.agentName).toBe('Agent A');
        expect(tr.order).toBe(0);
        // components not in buffer — should fall back to DB
        expect(tr.components).toEqual([{ id: 'c1', type: 'text', data: { content: 'old' } }]);

        // Clean up
        (service as any).bufferService.activeStepBuffers.delete(execId);
      });

      it('should override DB with buffer when status weight is equal (completed >= completed)', async () => {
        const dbExecution = createMockExecution({
          taskResults: [
            {
              taskId: 'task-1',
              nodeTitle: 'Task One',
              agentName: 'Agent A',
              order: 0,
              status: StepStatus.COMPLETED,
              output: 'old output',
              error: null,
              durationMs: 1000,
              startedAt: new Date('2026-03-10T10:00:00Z'),
              completedAt: new Date('2026-03-10T10:01:00Z'),
              components: [],
              inputTokens: 50,
              outputTokens: 25,
              totalTokens: 75,
              modelName: 'test-runtime-model-b',
            },
          ],
        });
        mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

        const execId = objectId('exec1').toString();
        const buffer = new Map();
        buffer.set('task-1', {
          taskId: 'task-1',
          status: StepStatus.COMPLETED,
          output: 'output',
          durationMs: 2000,
          completedAt: new Date('2026-03-10T10:02:00Z'),
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          modelName: 'test-runtime-model-a',
        });
        (service as any).bufferService.activeStepBuffers.set(execId, buffer);

        const result = await service.findActiveExecutionsByUser(userId);

        const tr = result[0].taskResults[0];
        // Buffer wins (same weight = 2)
        expect(tr.status).toBe(StepStatus.COMPLETED);
        expect(tr.output).toBe('output');
        expect(tr.durationMs).toBe(2000);
        expect(tr.inputTokens).toBe(100);
        expect(tr.outputTokens).toBe(50);
        expect(tr.totalTokens).toBe(150);
        expect(tr.modelName).toBe('test-runtime-model-a');

        (service as any).bufferService.activeStepBuffers.delete(execId);
      });

      it('should NOT override DB when buffer status weight is lower', async () => {
        const dbExecution = createMockExecution({
          taskResults: [
            {
              taskId: 'task-1',
              nodeTitle: 'Task One',
              agentName: 'Agent A',
              order: 0,
              status: StepStatus.COMPLETED,
              output: 'db output',
              error: null,
              durationMs: 1000,
              startedAt: new Date('2026-03-10T10:00:00Z'),
              completedAt: new Date('2026-03-10T10:01:00Z'),
              components: [],
              inputTokens: 50,
              outputTokens: 25,
              totalTokens: 75,
              modelName: 'test-runtime-model-b',
            },
          ],
        });
        mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

        const execId = objectId('exec1').toString();
        const buffer = new Map();
        // Buffer has RUNNING (weight 1), DB has COMPLETED (weight 2) — DB should win
        buffer.set('task-1', {
          taskId: 'task-1',
          status: StepStatus.RUNNING,
          startedAt: new Date('2026-03-10T10:05:00Z'),
          output: 'buffer output',
        });
        (service as any).bufferService.activeStepBuffers.set(execId, buffer);

        const result = await service.findActiveExecutionsByUser(userId);

        const tr = result[0].taskResults[0];
        // DB wins because completed (2) > running (1)
        expect(tr.status).toBe(StepStatus.COMPLETED);
        expect(tr.output).toBe('db output');
        expect(tr.durationMs).toBe(1000);

        (service as any).bufferService.activeStepBuffers.delete(execId);
      });

      it('should not modify non-buffered tasks', async () => {
        const dbExecution = createMockExecution({
          taskResults: [
            {
              taskId: 'task-1',
              nodeTitle: 'Task One',
              agentName: 'Agent A',
              order: 0,
              status: StepStatus.PENDING,
              output: null,
              error: null,
              durationMs: null,
              startedAt: null,
              completedAt: null,
              components: [],
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              modelName: null,
            },
            {
              taskId: 'task-2',
              nodeTitle: 'Task Two',
              agentName: 'Agent B',
              order: 1,
              status: StepStatus.PENDING,
              output: null,
              error: null,
              durationMs: null,
              startedAt: null,
              completedAt: null,
              components: [],
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              modelName: null,
            },
          ],
        });
        mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

        const execId = objectId('exec1').toString();
        const buffer = new Map();
        // Only buffer task-1
        buffer.set('task-1', {
          taskId: 'task-1',
          status: StepStatus.RUNNING,
          startedAt: new Date('2026-03-10T10:05:00Z'),
        });
        (service as any).bufferService.activeStepBuffers.set(execId, buffer);

        const result = await service.findActiveExecutionsByUser(userId);

        // task-1 should be merged
        expect(result[0].taskResults[0].status).toBe(StepStatus.RUNNING);
        // task-2 should remain unchanged from DB
        expect(result[0].taskResults[1].status).toBe(StepStatus.PENDING);
        expect(result[0].taskResults[1].output).toBeNull();

        (service as any).bufferService.activeStepBuffers.delete(execId);
      });

      it('should merge buffer fields correctly with undefined fallback to DB', async () => {
        const dbExecution = createMockExecution({
          taskResults: [
            {
              taskId: 'task-1',
              nodeTitle: 'Task One',
              agentName: 'Agent A',
              order: 0,
              status: StepStatus.PENDING,
              output: 'old-output',
              error: 'old-error',
              durationMs: 500,
              startedAt: new Date('2026-03-10T09:00:00Z'),
              completedAt: new Date('2026-03-10T09:01:00Z'),
              components: [],
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              modelName: 'old-model',
            },
          ],
        });
        mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

        const execId = objectId('exec1').toString();
        const buffer = new Map();
        // Buffer only has status and startedAt — other fields undefined
        buffer.set('task-1', {
          taskId: 'task-1',
          status: StepStatus.RUNNING,
          startedAt: new Date('2026-03-10T10:05:00Z'),
        });
        (service as any).bufferService.activeStepBuffers.set(execId, buffer);

        const result = await service.findActiveExecutionsByUser(userId);

        const tr = result[0].taskResults[0];
        // Buffer overrides status and startedAt
        expect(tr.status).toBe(StepStatus.RUNNING);
        // Undefined buffer fields fall back to DB
        expect(tr.output).toBe('old-output');
        expect(tr.error).toBe('old-error');
        expect(tr.durationMs).toBe(500);
        expect(tr.inputTokens).toBe(10);
        expect(tr.outputTokens).toBe(5);
        expect(tr.totalTokens).toBe(15);
        expect(tr.modelName).toBe('old-model');

        (service as any).bufferService.activeStepBuffers.delete(execId);
      });

      it('should keep DB fields like components, nodeTitle, agentName, order from DB', async () => {
        const dbExecution = createMockExecution({
          taskResults: [
            {
              taskId: 'task-1',
              nodeTitle: 'DB Title',
              agentName: 'DB Agent',
              order: 42,
              status: StepStatus.PENDING,
              output: null,
              error: null,
              durationMs: null,
              startedAt: null,
              completedAt: null,
              components: [{ id: 'c1', type: 'text', data: {} }],
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              modelName: null,
            },
          ],
        });
        mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

        const execId = objectId('exec1').toString();
        const buffer = new Map();
        buffer.set('task-1', {
          taskId: 'task-1',
          status: StepStatus.RUNNING,
          startedAt: new Date(),
        });
        (service as any).bufferService.activeStepBuffers.set(execId, buffer);

        const result = await service.findActiveExecutionsByUser(userId);

        const tr = result[0].taskResults[0];
        // These come from DB, not buffer
        expect(tr.nodeTitle).toBe('DB Title');
        expect(tr.agentName).toBe('DB Agent');
        expect(tr.order).toBe(42);
        expect(tr.components).toEqual([{ id: 'c1', type: 'text', data: {} }]);

        (service as any).bufferService.activeStepBuffers.delete(execId);
      });

      it('should handle execution without buffer gracefully', async () => {
        const dbExecution = createMockExecution();
        mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

        // No buffer injected — activeStepBuffers is empty
        const result = await service.findActiveExecutionsByUser(userId);

        expect(result).toHaveLength(1);
        expect(result[0].taskResults[0].status).toBe(StepStatus.PENDING);
      });
    });

    it('should return top-level execution fields correctly', async () => {
      const dbExecution = createMockExecution({
        threadId: 'thread-123',
        interruptPayload: { type: 'approval' },
        error: 'some error',
        durationMs: 5000,
        singleStepTaskId: 'task-1',
        playbookSnapshot: { tasks: [], edges: [] },
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      });
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExecution]));

      const result = await service.findActiveExecutionsByUser(userId);

      expect(result[0].threadId).toBe('thread-123');
      expect(result[0].interruptPayload).toEqual({ type: 'approval' });
      expect(result[0].error).toBe('some error');
      expect(result[0].durationMs).toBe(5000);
      expect(result[0].singleStepTaskId).toBe('task-1');
      expect(result[0].totalInputTokens).toBe(100);
      expect(result[0].totalOutputTokens).toBe(50);
      expect(result[0].totalTokens).toBe(150);
    });
  });

  // ===== mergeTaskResultWithBuffer (tested via findActiveExecutionsByUser) =====

  describe('mergeTaskResultWithBuffer (via findActiveExecutionsByUser)', () => {
    const userId = objectId('user1').toString();

    it('pending(0) < running(1): buffer wins', async () => {
      const dbExec = createMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'T',
            agentName: '',
            order: 0,
            status: StepStatus.PENDING,
            output: null,
            error: null,
            durationMs: null,
            startedAt: null,
            completedAt: null,
            components: [],
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            modelName: null,
          },
        ],
      });
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExec]));

      const buf = new Map();
      buf.set('task-1', { taskId: 'task-1', status: StepStatus.RUNNING, startedAt: new Date() });
      (service as any).bufferService.activeStepBuffers.set(objectId('exec1').toString(), buf);

      const result = await service.findActiveExecutionsByUser(userId);
      expect(result[0].taskResults[0].status).toBe(StepStatus.RUNNING);

      (service as any).bufferService.activeStepBuffers.delete(objectId('exec1').toString());
    });

    it('running(1) < completed(2): buffer wins', async () => {
      const dbExec = createMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'T',
            agentName: '',
            order: 0,
            status: StepStatus.RUNNING,
            output: null,
            error: null,
            durationMs: null,
            startedAt: new Date(),
            completedAt: null,
            components: [],
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            modelName: null,
          },
        ],
      });
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExec]));

      const buf = new Map();
      buf.set('task-1', {
        taskId: 'task-1',
        status: StepStatus.COMPLETED,
        output: 'done',
        durationMs: 1500,
        completedAt: new Date(),
      });
      (service as any).bufferService.activeStepBuffers.set(objectId('exec1').toString(), buf);

      const result = await service.findActiveExecutionsByUser(userId);
      expect(result[0].taskResults[0].status).toBe(StepStatus.COMPLETED);
      expect(result[0].taskResults[0].output).toBe('done');

      (service as any).bufferService.activeStepBuffers.delete(objectId('exec1').toString());
    });

    it('running(1) < failed(2): buffer wins', async () => {
      const dbExec = createMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'T',
            agentName: '',
            order: 0,
            status: StepStatus.RUNNING,
            output: null,
            error: null,
            durationMs: null,
            startedAt: new Date(),
            completedAt: null,
            components: [],
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            modelName: null,
          },
        ],
      });
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExec]));

      const buf = new Map();
      buf.set('task-1', {
        taskId: 'task-1',
        status: StepStatus.FAILED,
        error: 'crashed',
        durationMs: 300,
        completedAt: new Date(),
      });
      (service as any).bufferService.activeStepBuffers.set(objectId('exec1').toString(), buf);

      const result = await service.findActiveExecutionsByUser(userId);
      expect(result[0].taskResults[0].status).toBe(StepStatus.FAILED);
      expect(result[0].taskResults[0].error).toBe('crashed');

      (service as any).bufferService.activeStepBuffers.delete(objectId('exec1').toString());
    });

    it('completed(2) > pending(0): DB wins', async () => {
      const dbExec = createMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'T',
            agentName: '',
            order: 0,
            status: StepStatus.COMPLETED,
            output: 'final',
            error: null,
            durationMs: 1000,
            startedAt: new Date(),
            completedAt: new Date(),
            components: [],
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            modelName: 'test-runtime-model-a',
          },
        ],
      });
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExec]));

      const buf = new Map();
      buf.set('task-1', { taskId: 'task-1', status: StepStatus.PENDING });
      (service as any).bufferService.activeStepBuffers.set(objectId('exec1').toString(), buf);

      const result = await service.findActiveExecutionsByUser(userId);
      // DB wins: completed(2) > pending(0)
      expect(result[0].taskResults[0].status).toBe(StepStatus.COMPLETED);
      expect(result[0].taskResults[0].output).toBe('final');

      (service as any).bufferService.activeStepBuffers.delete(objectId('exec1').toString());
    });

    it('failed(2) > running(1): DB wins', async () => {
      const dbExec = createMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'T',
            agentName: '',
            order: 0,
            status: StepStatus.FAILED,
            output: null,
            error: 'db-error',
            durationMs: 800,
            startedAt: new Date(),
            completedAt: new Date(),
            components: [],
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            modelName: null,
          },
        ],
      });
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExec]));

      const buf = new Map();
      buf.set('task-1', {
        taskId: 'task-1',
        status: StepStatus.RUNNING,
        startedAt: new Date(),
        error: 'buffer-error',
      });
      (service as any).bufferService.activeStepBuffers.set(objectId('exec1').toString(), buf);

      const result = await service.findActiveExecutionsByUser(userId);
      // DB wins: failed(2) > running(1)
      expect(result[0].taskResults[0].status).toBe(StepStatus.FAILED);
      expect(result[0].taskResults[0].error).toBe('db-error');

      (service as any).bufferService.activeStepBuffers.delete(objectId('exec1').toString());
    });

    it('skipped(2) == completed(2): buffer wins (equal weight)', async () => {
      const dbExec = createMockExecution({
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'T',
            agentName: '',
            order: 0,
            status: StepStatus.SKIPPED,
            output: null,
            error: null,
            durationMs: null,
            startedAt: null,
            completedAt: null,
            components: [],
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            modelName: null,
          },
        ],
      });
      mockExecutionModel.find.mockReturnValue(createChainMock([dbExec]));

      const buf = new Map();
      buf.set('task-1', {
        taskId: 'task-1',
        status: StepStatus.COMPLETED,
        output: 'new',
        durationMs: 100,
      });
      (service as any).bufferService.activeStepBuffers.set(objectId('exec1').toString(), buf);

      const result = await service.findActiveExecutionsByUser(userId);
      // Both have weight 2, so buffer wins (>=)
      expect(result[0].taskResults[0].status).toBe(StepStatus.COMPLETED);
      expect(result[0].taskResults[0].output).toBe('new');

      (service as any).bufferService.activeStepBuffers.delete(objectId('exec1').toString());
    });
  });

  // ===== stopExecution =====

  describe('stopExecution', () => {
    const userId = objectId('user1').toString();
    const playbookId = objectId('pb1').toString();
    const executionId = objectId('exec1').toString();

    it('should throw NotFoundException for missing execution', async () => {
      mockExecutionModel.findById.mockReturnValue(createChainMock(null));

      await expect(service.stopExecution(userId, playbookId, executionId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for wrong user', async () => {
      const execution = createMockExecution({
        executedBy: objectId('other-user'),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      await expect(service.stopExecution(userId, playbookId, executionId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return current status for completed execution', async () => {
      const execution = createMockExecution({
        status: ExecutionStatus.COMPLETED,
        executedBy: objectId('user1'),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const result = await service.stopExecution(userId, playbookId, executionId);
      expect(result.status).toBe(ExecutionStatus.COMPLETED);
    });

    it('should return current status for failed execution', async () => {
      const execution = createMockExecution({
        status: ExecutionStatus.FAILED,
        executedBy: objectId('user1'),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const result = await service.stopExecution(userId, playbookId, executionId);
      expect(result.status).toBe(ExecutionStatus.FAILED);
    });

    it('should return current status for cancelled execution', async () => {
      const execution = createMockExecution({
        status: ExecutionStatus.CANCELLED,
        executedBy: objectId('user1'),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const result = await service.stopExecution(userId, playbookId, executionId);
      expect(result.status).toBe(ExecutionStatus.CANCELLED);
    });

    it('should cancel directly for interrupted execution', async () => {
      const execution = createMockExecution({
        status: ExecutionStatus.INTERRUPTED,
        executedBy: objectId('user1'),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      // For markExecutionCancelled: need findById for fetching taskResults
      const selectChain = createChainMock(execution);
      mockExecutionModel.findById
        .mockReturnValueOnce(createChainMock(execution)) // first call (stopExecution)
        .mockReturnValueOnce(selectChain); // second call (markExecutionCancelled)

      const result = await service.stopExecution(userId, playbookId, executionId);

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      // Should NOT call gRPC stop for interrupted (no active stream)
      expect(mockGrpcService.stopPlaybookWorkflow).not.toHaveBeenCalled();
    });

    it('should attempt gRPC stop and cancel stream for running execution', async () => {
      const execution = createMockExecution({
        status: ExecutionStatus.RUNNING,
        executedBy: objectId('user1'),
        threadId: 'thread-abc',
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const mockCall = { cancel: jest.fn() };
      mockGrpcService.getStream.mockReturnValue(mockCall);
      mockGrpcService.stopPlaybookWorkflow.mockResolvedValue(undefined);

      const result = await service.stopExecution(userId, playbookId, executionId, 'user@test.com');

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      expect(mockGrpcService.stopPlaybookWorkflow).toHaveBeenCalledWith({
        user_context: { user_id: userId, username: 'user@test.com' },
        thread_id: 'thread-abc',
      });
      expect(mockGrpcService.markCancelled).toHaveBeenCalledWith(executionId);
      expect(mockCall.cancel).toHaveBeenCalled();
    });

    it('should cancel directly when no active stream exists for running execution', async () => {
      const execution = createMockExecution({
        status: ExecutionStatus.RUNNING,
        executedBy: objectId('user1'),
        threadId: 'thread-abc',
      });
      // First call: stopExecution reads execution
      // Second call: markExecutionCancelled reads taskResults
      mockExecutionModel.findById
        .mockReturnValueOnce(createChainMock(execution))
        .mockReturnValueOnce(createChainMock(execution));

      mockGrpcService.getStream.mockReturnValue(null);
      mockGrpcService.stopPlaybookWorkflow.mockResolvedValue(undefined);

      const result = await service.stopExecution(userId, playbookId, executionId);

      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      // Should still try gRPC stop
      expect(mockGrpcService.stopPlaybookWorkflow).toHaveBeenCalled();
      // But no stream to cancel
      expect(mockGrpcService.markCancelled).not.toHaveBeenCalled();
      // Should mark as cancelled directly
      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: executionId,
          status: {
            $in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ExecutionStatus.CANCELLED,
          }),
        }),
      );
    });

    it('should handle gRPC stop failure gracefully for running execution', async () => {
      const execution = createMockExecution({
        status: ExecutionStatus.RUNNING,
        executedBy: objectId('user1'),
        threadId: 'thread-abc',
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const mockCall = { cancel: jest.fn() };
      mockGrpcService.getStream.mockReturnValue(mockCall);
      mockGrpcService.stopPlaybookWorkflow.mockRejectedValue(new Error('gRPC failed'));

      const result = await service.stopExecution(userId, playbookId, executionId);

      // Should not throw despite gRPC failure
      expect(result.status).toBe(ExecutionStatus.CANCELLED);
      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        'StopPlaybookWorkflow gRPC failed (best-effort)',
        expect.any(Object),
      );
    });
  });

  describe('executeStepWithStreaming', () => {
    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should complete when terminal status is present only on the result payload', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runStepStream.mockReturnValue(mockStream);

      mockExecutionModel.findById.mockReturnValue(
        createChainMock(
          createMockExecution({
            taskResults: [{ taskId: 'task-1', status: StepStatus.RUNNING, components: [] }],
          }),
        ),
      );

      const promise = (service as any).executeStepWithStreaming(
        objectId('user1').toString(),
        objectId('exec1').toString(),
        objectId('pb1').toString(),
        createMockPlaybook().tasks[0],
        { playbook_id: objectId('pb1').toString(), task: { id: 'task-1' } },
        new Map<string, string>(),
        'Test Playbook',
        false,
      );

      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          result: {
            status: 'completed',
            components: [],
            duration_ms: '250',
          },
        },
      });
      mockStream.emit('end');

      await expect(promise).resolves.toEqual(expect.objectContaining({ outcome: 'completed' }));
      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        objectId('user1').toString(),
        expect.objectContaining({
          type: 'playbook_step_complete',
          data: expect.objectContaining({
            executionId: objectId('exec1').toString(),
            taskId: 'task-1',
            status: 'completed',
            durationMs: 250,
          }),
        }),
      );
    });
  });

  // ===== resumeExecution =====

  describe('resumeExecution', () => {
    const userId = objectId('user1').toString();
    const playbookId = objectId('pb1').toString();

    function makeResumeDto(
      overrides: Partial<{
        executionId: string;
        taskId: string;
        approved: boolean;
        reason: string;
        feedback: string;
      }> = {},
    ) {
      return {
        executionId: objectId('exec1').toString(),
        taskId: 'task-1',
        approved: true,
        reason: '',
        feedback: '',
        ...overrides,
      };
    }

    it('should throw NotFoundException for missing execution', async () => {
      mockExecutionModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(service.resumeExecution(userId, playbookId, makeResumeDto())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException for wrong user', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('other-user'),
          status: ExecutionStatus.INTERRUPTED,
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockExecutionModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(execution) });

      await expect(service.resumeExecution(userId, playbookId, makeResumeDto())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if execution is not interrupted', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.RUNNING,
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockExecutionModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(execution) });

      await expect(service.resumeExecution(userId, playbookId, makeResumeDto())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if no threadId', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.INTERRUPTED,
          threadId: null,
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockExecutionModel.findById.mockReturnValue({ exec: jest.fn().mockResolvedValue(execution) });

      await expect(service.resumeExecution(userId, playbookId, makeResumeDto())).rejects.toThrow(
        BadRequestException,
      );
    });

    describe('single-step mode', () => {
      it('should call resumeStep and process completed response', async () => {
        const execution = {
          ...createMockExecution({
            executedBy: objectId('user1'),
            status: ExecutionStatus.INTERRUPTED,
            threadId: 'thread-abc',
            singleStepTaskId: 'task-1',
            taskResults: [{ taskId: 'task-1', status: StepStatus.RUNNING, components: [] }],
          }),
          markModified: jest.fn(),
          save: jest.fn().mockResolvedValue(undefined),
        };

        // First findById: resumeExecution reads execution (.exec())
        mockExecutionModel.findById.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(execution),
        });
        // Second findById: updateHumanFeedbackResponse (.exec())
        mockExecutionModel.findById.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(execution),
        });
        // Third findById: freshExecution in resume (.lean().exec())
        mockExecutionModel.findById.mockReturnValueOnce(createChainMock(execution));
        // Fourth findById: markExecutionCompleted
        mockExecutionModel.findById.mockReturnValueOnce(createChainMock(execution));

        mockGrpcService.resumeStep.mockResolvedValue({
          status: 'completed',
          result: {
            task_id: 'task-1',
            status: 'completed',
            components: [],
            duration_ms: '500',
          },
        });

        const dto = makeResumeDto();
        const result = await service.resumeExecution(userId, playbookId, dto, 'user@test.com');

        expect(result.status).toBe('resumed');
        expect(mockGrpcService.resumeStep).toHaveBeenCalledWith(
          expect.objectContaining({
            playbook_id: playbookId,
            thread_id: 'thread-abc',
            task_id: 'task-1',
            human_response: expect.objectContaining({
              approved: true,
              reason: '',
              feedback: '',
              action: 'approve',
            }),
            user_context: expect.objectContaining({ user_id: userId }),
          }),
        );
      });
    });

    describe('full workflow mode', () => {
      it('should call resumePlaybookWorkflow and start stream consumer', async () => {
        const execution = {
          ...createMockExecution({
            executedBy: objectId('user1'),
            status: ExecutionStatus.INTERRUPTED,
            threadId: 'thread-abc',
            singleStepTaskId: null, // full workflow
            playbookSnapshot: { tasks: [{ id: 'task-1', title: 'T1' }], edges: [] },
            taskResults: [{ taskId: 'task-1', status: StepStatus.RUNNING, components: [] }],
          }),
          markModified: jest.fn(),
          save: jest.fn().mockResolvedValue(undefined),
        };

        // First findById: resumeExecution reads execution (.exec())
        mockExecutionModel.findById.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(execution),
        });
        // Second findById: updateHumanFeedbackResponse (.exec())
        mockExecutionModel.findById.mockReturnValueOnce({
          exec: jest.fn().mockResolvedValue(execution),
        });

        const mockStream = new EventEmitter();
        (mockStream as any).cancel = jest.fn();
        mockGrpcService.resumePlaybookWorkflow.mockReturnValue(mockStream);

        const dto = makeResumeDto();
        const result = await service.resumeExecution(userId, playbookId, dto, 'user@test.com');

        expect(result.status).toBe('resumed');
        expect(mockGrpcService.resumePlaybookWorkflow).toHaveBeenCalledWith(
          expect.objectContaining({
            playbook_id: playbookId,
            thread_id: 'thread-abc',
            task_id: 'task-1',
          }),
        );
        expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
          userId,
          expect.objectContaining({
            type: 'playbook_step_start',
            data: expect.objectContaining({
              executionId: objectId('exec1').toString(),
              taskId: 'task-1',
              status: 'running',
            }),
          }),
        );
      });
    });

    it('should update human feedback response in DB', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.INTERRUPTED,
          threadId: 'thread-abc',
          singleStepTaskId: null,
          playbookSnapshot: { tasks: [], edges: [] },
          taskResults: [
            {
              taskId: 'task-1',
              status: StepStatus.RUNNING,
              components: [{ id: 'hf-1', type: 'humanFeedback', data: { status: 'pending' } }],
            },
          ],
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };

      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });
      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });

      const mockStream = new EventEmitter();
      (mockStream as any).cancel = jest.fn();
      mockGrpcService.resumePlaybookWorkflow.mockReturnValue(mockStream);

      const dto = makeResumeDto({ approved: false, reason: 'Not good', feedback: 'Try again' });
      await service.resumeExecution(userId, playbookId, dto, 'user@test.com');

      // The execution.save() should have been called (via updateHumanFeedbackResponse)
      expect(execution.save).toHaveBeenCalled();
      expect(execution.markModified).toHaveBeenCalledWith('taskResults');
    });

    it('should set execution status back to RUNNING', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.INTERRUPTED,
          threadId: 'thread-abc',
          singleStepTaskId: null,
          playbookSnapshot: { tasks: [], edges: [] },
          taskResults: [{ taskId: 'task-1', status: StepStatus.RUNNING, components: [] }],
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };

      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });
      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });

      const mockStream = new EventEmitter();
      (mockStream as any).cancel = jest.fn();
      mockGrpcService.resumePlaybookWorkflow.mockReturnValue(mockStream);

      await service.resumeExecution(userId, playbookId, makeResumeDto());

      expect(mockExecutionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        objectId('exec1').toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ExecutionStatus.RUNNING,
            interruptPayload: null,
          }),
        }),
      );
    });
  });

  describe('rerunStepInExecution', () => {
    it('should throw ServiceUnavailableException when gRPC is unavailable', async () => {
      mockGrpcService.isAvailable = false;

      await expect(
        service.rerunStepInExecution(
          objectId('user1').toString(),
          objectId('pb1').toString(),
          objectId('exec1').toString(),
          'task-1',
          false,
          'live',
          false,
          true,
          '',
        ),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockGrpcService.runStepStream).not.toHaveBeenCalled();
      expect(mockExecutionModel.findById).not.toHaveBeenCalled();
    });

    it('persists downstream tasks back to pending for recompute', async () => {
      const userId = objectId('user1').toString();
      const playbookId = objectId('pb1').toString();
      const execution = createMockExecution({
        executedBy: objectId('user1'),
        playbookId: objectId('pb1'),
        status: ExecutionStatus.COMPLETED,
        executionNumber: 3,
        currentAttemptNumber: 1,
        playbookSnapshot: {
          tasks: createMockPlaybook().tasks.map((task: any) => ({ ...task })),
          edges: createMockPlaybook().edges.map((edge: any) => ({ ...edge })),
        },
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'Task One',
            agentName: 'Agent A',
            order: 0,
            status: StepStatus.COMPLETED,
            output: 'done',
            error: null,
            durationMs: 10,
            startedAt: new Date(),
            completedAt: new Date(),
            components: [],
          },
          {
            taskId: 'task-2',
            nodeTitle: 'Task Two',
            agentName: 'Agent B',
            order: 1,
            status: StepStatus.COMPLETED,
            output: 'downstream',
            error: null,
            durationMs: 20,
            startedAt: new Date(),
            completedAt: new Date(),
            components: [],
            isStale: true,
            staleReason: 'upstream_task_rerun',
            invalidatedByTaskId: 'task-1',
          },
        ],
      });

      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockGrpcService.runStep.mockResolvedValue({
        status: 'completed',
        result: { components: [], duration_ms: '1' },
      });

      await service.rerunStepInExecution(
        userId,
        playbookId,
        objectId('exec1').toString(),
        'task-1',
        false,
        'live',
        false,
        true,
        '',
      );

      expect(mockExecutionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        objectId('exec1').toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            'taskResults.$[elem].status': StepStatus.PENDING,
            'taskResults.$[elem].output': null,
            'taskResults.$[elem].isStale': false,
            'taskResults.$[elem].invalidatedByTaskId': 'task-1',
          }),
        }),
        { arrayFilters: [{ 'elem.taskId': 'task-2' }] },
      );
    });

    it('clears stale judge state for the rerun step and keeps reflection enabled', async () => {
      const userId = objectId('user1').toString();
      const playbookId = objectId('pb1').toString();
      const executionId = objectId('exec1').toString();
      const execution = createMockExecution({
        _id: executionId,
        executedBy: objectId('user1'),
        playbookId: objectId('pb1'),
        status: ExecutionStatus.COMPLETED,
        executionNumber: 3,
        currentAttemptNumber: 1,
        reflectionEnabled: false,
        playbookSnapshot: {
          tasks: createMockPlaybook().tasks.map((task: any) => ({ ...task })),
          edges: createMockPlaybook().edges.map((edge: any) => ({ ...edge })),
        },
        taskResults: [
          {
            taskId: 'task-1',
            nodeTitle: 'Task One',
            agentName: 'Agent A',
            order: 0,
            status: StepStatus.COMPLETED,
            output: 'done',
            error: null,
            durationMs: 10,
            startedAt: new Date(),
            completedAt: new Date(),
            components: [],
            judgeStatus: JudgeStatus.EVALUATED,
            judgeResult: { overallScore: 91 },
            judgeError: 'old error',
          },
        ],
      });

      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockGrpcService.runStep.mockResolvedValue({
        status: 'completed',
        result: { components: [], duration_ms: '1' },
      });

      await service.rerunStepInExecution(
        userId,
        playbookId,
        executionId,
        'task-1',
        false,
        'live',
        false,
        true,
        '',
      );

      expect(mockExecutionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        executionId,
        expect.objectContaining({
          $set: expect.objectContaining({
            runEvaluation: false,
            reflectionEnabled: true,
          }),
        }),
      );

      expect(mockExecutionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        executionId,
        expect.objectContaining({
          $set: expect.objectContaining({
            'taskResults.$[elem].judgeStatus': JudgeStatus.IDLE,
            'taskResults.$[elem].judgeResult': null,
            'taskResults.$[elem].judgeError': null,
          }),
        }),
        { arrayFilters: [{ 'elem.taskId': 'task-1' }] },
      );
    });
  });

  describe('resolveAdvisorAutopilotFixType', () => {
    it('falls back to optimize_step when advisor suggests updating the current playbook with rewrite hints', () => {
      expect(
        (service as any).advisorService.resolveAdvisorAutopilotFixType({
          safeAutoFixType: 'none',
          recommendation: 'update_current_playbook',
          rewriteHints: ['Tighten the task prompt around the baseline contract.'],
        }),
      ).toBe('optimize_step');
    });

    it('keeps none when advisor does not provide a safe step-scoped fallback', () => {
      expect(
        (service as any).advisorService.resolveAdvisorAutopilotFixType({
          safeAutoFixType: 'none',
          recommendation: 'generate_new_optimized_playbook',
          rewriteHints: ['Broader workflow rewrite needed.'],
        }),
      ).toBe('none');
    });
  });

  // ===== STATUS_WEIGHT =====

  describe('STATUS_WEIGHT', () => {
    it('should define correct status weights', () => {
      const weights = PlaybookExecutionBufferService.STATUS_WEIGHT;
      expect(weights[StepStatus.PENDING]).toBe(0);
      expect(weights[StepStatus.RUNNING]).toBe(1);
      expect(weights[StepStatus.COMPLETED]).toBe(2);
      expect(weights[StepStatus.FAILED]).toBe(2);
      expect(weights[StepStatus.SKIPPED]).toBe(2);
    });
  });

  // ===== Stream interrupt handling =====

  describe('stream interrupt handling', () => {
    const userId = objectId('user1').toString();

    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should skip stale re-emitted interrupts for resumed tasks', async () => {
      // Access consumePlaybookStream indirectly via resumeExecution (full workflow)
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.INTERRUPTED,
          threadId: 'thread-abc',
          interruptPayload: { interruptId: 'interrupt-1', type: 'clarification', round: 1 },
          singleStepTaskId: null,
          playbookSnapshot: { tasks: [{ id: 'task-1', title: 'T' }], edges: [] },
          taskResults: [{ taskId: 'task-1', status: StepStatus.RUNNING, components: [] }],
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };

      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });
      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });

      const mockStream = createMockStream();
      mockGrpcService.resumePlaybookWorkflow.mockReturnValue(mockStream);

      await service.resumeExecution(userId, objectId('pb1').toString(), {
        executionId: objectId('exec1').toString(),
        taskId: 'task-1',
        approved: true,
      } as any);

      // Emit a stale interrupt for the same task that was just resumed
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'suspended',
          interrupt: {
            type: 'clarification',
            task_id: 'task-1',
            message: 'stale',
            interrupt_id: 'interrupt-1',
            round: 1,
          },
        },
      });

      // The stale interrupt should be logged and skipped
      expect(mockLoggerService.debug).toHaveBeenCalledWith(
        'Skipping stale re-emitted interrupt for resumed task',
        expect.objectContaining({ resumedTaskId: 'task-1' }),
      );
    });

    it('should keep new interrupts for the same resumed task when interrupt id changes', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.INTERRUPTED,
          threadId: 'thread-abc',
          interruptPayload: { interruptId: 'interrupt-1', type: 'clarification', round: 1 },
          singleStepTaskId: null,
          playbookSnapshot: { tasks: [{ id: 'task-1', title: 'T' }], edges: [] },
          taskResults: [{ taskId: 'task-1', status: StepStatus.RUNNING, components: [] }],
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };

      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });
      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });

      const mockStream = createMockStream();
      mockGrpcService.resumePlaybookWorkflow.mockReturnValue(mockStream);

      await service.resumeExecution(userId, objectId('pb1').toString(), {
        executionId: objectId('exec1').toString(),
        taskId: 'task-1',
        approved: true,
      } as any);

      mockStream.emit('data', {
        thread_id: 'thread-abc',
        step_update: {
          task_id: 'task-1',
          status: 'suspended',
          interrupt: {
            type: 'clarification',
            task_id: 'task-1',
            message: 'next round',
            interrupt_id: 'interrupt-2',
            round: 2,
          },
        },
      });

      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockLoggerService.log).not.toHaveBeenCalledWith(
        'Skipping stale re-emitted interrupt for resumed task',
        expect.objectContaining({ interruptId: 'interrupt-2' }),
      );
      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_interrupt',
          data: expect.objectContaining({
            executionId: objectId('exec1').toString(),
            taskId: 'task-1',
            interruptId: 'interrupt-2',
            round: 2,
          }),
        }),
      );
    });

    it('should collect non-stale interrupts during stream', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.INTERRUPTED,
          threadId: 'thread-abc',
          singleStepTaskId: null,
          playbookSnapshot: { tasks: [{ id: 'task-1' }, { id: 'task-2' }], edges: [] },
          taskResults: [
            { taskId: 'task-1', status: StepStatus.RUNNING, components: [] },
            { taskId: 'task-2', status: StepStatus.PENDING, components: [] },
          ],
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };

      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });
      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });

      const mockStream = createMockStream();
      mockGrpcService.resumePlaybookWorkflow.mockReturnValue(mockStream);

      await service.resumeExecution(userId, objectId('pb1').toString(), {
        executionId: objectId('exec1').toString(),
        taskId: 'task-1',
        approved: true,
      } as any);

      // Emit an interrupt for a DIFFERENT task (not stale)
      mockStream.emit('data', {
        thread_id: 'thread-abc',
        step_update: {
          task_id: 'task-2',
          status: 'suspended',
          interrupt: { type: 'approval', task_id: 'task-2', message: 'Need approval for task 2' },
        },
      });

      // Mock for flushStepBuffer + handleStreamInterrupts
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      // End the stream — should trigger handleStreamInterrupts
      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      // Should set execution to INTERRUPTED with the interrupt payload
      expect(mockExecutionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        objectId('exec1').toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ExecutionStatus.INTERRUPTED,
          }),
        }),
      );

      // Should send SSE interrupt event
      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_interrupt',
          data: expect.objectContaining({
            taskId: 'task-2',
            type: 'approval',
            message: 'Need approval for task 2',
          }),
        }),
      );
    });

    it('should handle interrupt then fail on a later resume gRPC abort', async () => {
      const execution = {
        ...createMockExecution({
          executedBy: objectId('user1'),
          status: ExecutionStatus.INTERRUPTED,
          threadId: 'thread-abc',
          singleStepTaskId: null,
          playbookSnapshot: { tasks: [{ id: 'task-1' }, { id: 'task-2' }], edges: [] },
          taskResults: [
            { taskId: 'task-1', status: StepStatus.RUNNING, components: [] },
            { taskId: 'task-2', status: StepStatus.PENDING, components: [] },
          ],
        }),
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      };

      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });
      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(execution),
      });

      const firstResumeStream = createMockStream();
      mockGrpcService.resumePlaybookWorkflow.mockReturnValueOnce(firstResumeStream);

      await service.resumeExecution(userId, objectId('pb1').toString(), {
        executionId: objectId('exec1').toString(),
        taskId: 'task-1',
        approved: true,
      } as any);

      firstResumeStream.emit('data', {
        thread_id: 'thread-abc',
        step_update: {
          task_id: 'task-2',
          status: 'suspended',
          interrupt: {
            type: 'approval',
            task_id: 'task-2',
            message: 'Need approval for task 2',
            interrupt_id: 'interrupt-2',
            round: 2,
          },
        },
      });

      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      firstResumeStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockStreamGateway.sendToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_interrupt',
          data: expect.objectContaining({
            taskId: 'task-2',
            interruptId: 'interrupt-2',
          }),
        }),
      );

      const interruptedExecution = {
        ...execution,
        status: ExecutionStatus.INTERRUPTED,
        interruptPayload: { interruptId: 'interrupt-2', type: 'approval', round: 2 },
      };

      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(interruptedExecution),
      });
      mockExecutionModel.findById.mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(interruptedExecution),
      });

      const secondResumeStream = createMockStream();
      mockGrpcService.resumePlaybookWorkflow.mockReturnValueOnce(secondResumeStream);
      mockGrpcService.wasCancelled.mockReturnValue(false);

      await service.resumeExecution(userId, objectId('pb1').toString(), {
        executionId: objectId('exec1').toString(),
        taskId: 'task-2',
        approved: true,
      } as any);

      const grpcAbortError = Object.assign(
        new Error('13 INTERNAL: Playbook workflow resume failed: boom'),
        {
          code: 13,
          details: 'Playbook workflow resume failed: boom',
        },
      );
      secondResumeStream.emit('error', grpcAbortError);
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: objectId('exec1').toString(),
          status: {
            $in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({ status: ExecutionStatus.FAILED }),
        }),
      );
      expect(mockLoggerService.error).toHaveBeenCalledWith(
        'Workflow stream error',
        expect.objectContaining({
          executionId: objectId('exec1').toString(),
          error: grpcAbortError.message,
        }),
      );
    });
  });

  // ===== Email notifications =====

  describe('sendStepNotificationEmail', () => {
    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should not send email when notifyOnComplete is false', async () => {
      const playbook = createMockPlaybook({
        tasks: [
          {
            id: 'task-1',
            title: 'Task One',
            notifyOnComplete: false,
            notifyEmails: ['admin@test.com'],
            assignedAgentId: null,
            executionOrder: 0,
            toObject: function () {
              return { ...this };
            },
          },
        ],
        edges: [],
      });

      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [{ taskId: 'task-1', status: StepStatus.PENDING, components: [] }],
      });
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      await service.executePlaybook(
        objectId('user1').toString(),
        objectId('pb1').toString(),
        {},
        '',
      );
      await waitForWorkflowStreamReady();

      // Complete a task
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: { components: [], duration_ms: '1000' },
        },
      });

      expect(mockEmailService.send).not.toHaveBeenCalled();
    });

    it('should not send email when email service is unavailable', async () => {
      mockEmailService.isAvailable.mockReturnValue(false);

      const playbook = createMockPlaybook({
        tasks: [
          {
            id: 'task-1',
            title: 'Task One',
            notifyOnComplete: true,
            notifyEmails: ['admin@test.com'],
            assignedAgentId: null,
            executionOrder: 0,
            toObject: function () {
              return { ...this };
            },
          },
        ],
        edges: [],
      });

      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [{ taskId: 'task-1', status: StepStatus.PENDING, components: [] }],
      });
      mockPlaybookService.findRawById.mockResolvedValue(playbook);
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      await service.executePlaybook(
        objectId('user1').toString(),
        objectId('pb1').toString(),
        {},
        '',
      );
      await waitForWorkflowStreamReady();

      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: { components: [], duration_ms: '100' },
        },
      });

      expect(mockEmailService.send).not.toHaveBeenCalled();
    });
  });

  // ===== Usage recording =====

  describe('recordStreamUsage (via stream end)', () => {
    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should aggregate usage from step buffer and record to usage service', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.COMPLETED, components: [] },
          { taskId: 'task-2', status: StepStatus.COMPLETED, components: [] },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, 'user@test.com');
      await waitForWorkflowStreamReady();

      // Emit completed steps with usage
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: {
            components: [],
            duration_ms: '1000',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              total_tokens: 150,
              model: 'test-runtime-model-a',
            },
          },
        },
      });
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-2',
          status: 'completed',
          result: {
            components: [],
            duration_ms: '2000',
            usage: {
              input_tokens: 200,
              output_tokens: 100,
              total_tokens: 300,
              model: 'test-runtime-model-a',
            },
          },
        },
      });

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      // Should have called bufferService.recordStreamUsage
      expect(mockBufferService.recordStreamUsage).toHaveBeenCalled();
    });

    it('should not record usage when no tokens were tracked', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [{ taskId: 'task-1', status: StepStatus.COMPLETED, components: [] }],
      });
      mockPlaybookService.findRawById.mockResolvedValue(
        createMockPlaybook({ tasks: [createMockPlaybook().tasks[0]], edges: [] }),
      );
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Complete without usage
      mockStream.emit('data', {
        step_update: {
          task_id: 'task-1',
          status: 'completed',
          result: { components: [], duration_ms: '500' },
        },
      });

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      // usageService.recordUsage should NOT have been called (no tokens)
      expect(mockUsageService.recordUsage).not.toHaveBeenCalled();
    });
  });

  // ===== Stream timeout =====

  describe('stream idle timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers({ advanceTimers: true });
    });

    afterEach(() => {
      // End any open workflow streams so idle timers cannot outlive this describe.
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should cancel stream after idle timeout', async () => {
      mockGrpcService.workflowTimeoutMs = 5000;

      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Advance timers past the timeout
      jest.advanceTimersByTime(6000);

      expect(mockStream.cancel).toHaveBeenCalled();
      expect(mockLoggerService.error).toHaveBeenCalledWith(
        'Workflow stream idle timeout',
        expect.objectContaining({ executionId: objectId('exec1').toString(), timeoutMs: 5000 }),
      );

      mockStream.emit('error', new Error('Cancelled'));
      await Promise.resolve();
    });

    it('should reset idle timeout on each data event', async () => {
      mockGrpcService.workflowTimeoutMs = 5000;

      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution();
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Advance 4 seconds (just under timeout)
      jest.advanceTimersByTime(4000);

      // Emit data — should reset the timer
      mockStream.emit('data', {
        step_update: { task_id: 'task-1', status: 'in_progress' },
      });

      // Advance another 4 seconds (would be 8s from start, but only 4s from last data)
      jest.advanceTimersByTime(4000);

      // Should NOT have cancelled yet (timer was reset)
      expect(mockStream.cancel).not.toHaveBeenCalled();

      // Advance 2 more seconds (now 6s since last data)
      jest.advanceTimersByTime(2000);

      // NOW it should have cancelled
      expect(mockStream.cancel).toHaveBeenCalled();

      mockStream.emit('error', new Error('Cancelled'));
      await Promise.resolve();
    });
  });

  // ===== Premature stream end =====

  describe('premature stream end handling', () => {
    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should mark execution CANCELLED when a locally cancelled stream ends', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);
      mockGrpcService.wasCancelled.mockReturnValueOnce(true);

      const execution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.RUNNING, components: [] },
          { taskId: 'task-2', status: StepStatus.PENDING, components: [] },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: objectId('exec1').toString(),
          status: {
            $in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ExecutionStatus.CANCELLED,
          }),
        }),
      );

      expect(mockLoggerService.warn).not.toHaveBeenCalledWith(
        'Stream ended prematurely with tasks still pending/running',
        expect.anything(),
      );
    });

    it('should mark execution FAILED when stream ends with tasks still pending', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      // Execution still has pending tasks
      const execution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.COMPLETED, components: [] },
          { taskId: 'task-2', status: StepStatus.PENDING, components: [] },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      mockExecutionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockLoggerService.warn).toHaveBeenCalledWith(
        'Stream ended prematurely with tasks still pending/running',
        expect.any(Object),
      );

      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: objectId('exec1').toString(),
          status: {
            $in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.INTERRUPTED],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ExecutionStatus.FAILED,
          }),
        }),
      );
    });

    it('should mark running tasks failed when a failed execution ends unexpectedly', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.RUNNING, components: [] },
          { taskId: 'task-2', status: StepStatus.PENDING, components: [] },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      mockExecutionModel.updateOne
        .mockResolvedValueOnce({ modifiedCount: 1 })
        .mockResolvedValueOnce({ modifiedCount: 1 })
        .mockResolvedValueOnce({ modifiedCount: 1 });

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        { _id: objectId('exec1').toString() },
        { $set: { 'taskResults.$[elem].status': StepStatus.FAILED } },
        { arrayFilters: [{ 'elem.status': StepStatus.RUNNING }] },
      );
      expect(mockExecutionModel.updateOne).toHaveBeenCalledWith(
        { _id: objectId('exec1').toString() },
        { $set: { 'taskResults.$[elem].status': StepStatus.SKIPPED } },
        { arrayFilters: [{ 'elem.status': StepStatus.PENDING }] },
      );
    });

    it('should mark execution COMPLETED when all tasks are done', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [
          { taskId: 'task-1', status: StepStatus.COMPLETED, components: [] },
          { taskId: 'task-2', status: StepStatus.COMPLETED, components: [] },
        ],
      });
      mockPlaybookService.findRawById.mockResolvedValue(createMockPlaybook());
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));
      mockExecutionModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockStreamGateway.sendToUser.mock.calls).toEqual(
        expect.arrayContaining([
          [
            userId,
            expect.objectContaining({
              type: 'playbook_execution_complete',
              data: expect.objectContaining({
                executionId: objectId('exec1').toString(),
                status: ExecutionStatus.COMPLETED,
              }),
            }),
          ],
        ]),
      );
    });

    it('should skip completed terminalization when another terminal path already won', async () => {
      const userId = objectId('user1').toString();

      mockExecutionModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      await (service as any).markExecutionCompleted(
        userId,
        objectId('exec1').toString(),
        new Date('2026-03-10T10:00:00Z'),
      );

      expect(mockStreamGateway.sendToUser).not.toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_execution_complete',
          data: expect.objectContaining({ status: ExecutionStatus.COMPLETED }),
        }),
      );
      expect(mockJudgeEnrichmentService.scheduleExecutionSweep).not.toHaveBeenCalled();
    });

    it('should skip failed terminalization when another terminal path already won', async () => {
      const userId = objectId('user1').toString();
      mockExecutionModel.findById.mockReturnValue(createChainMock(createMockExecution()));
      mockExecutionModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      await (service as any).markRemainingSkippedAndFail(
        userId,
        objectId('exec1').toString(),
        'boom',
        new Date('2026-03-10T10:00:00Z'),
      );

      expect(mockStreamGateway.sendToUser).not.toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'playbook_execution_complete',
          data: expect.objectContaining({ status: ExecutionStatus.FAILED }),
        }),
      );
    });
  });

  // ===== Thread ID tracking =====

  describe('thread ID tracking in stream', () => {
    function createMockStream(): EventEmitter & { cancel: jest.Mock } {
      const stream = new EventEmitter() as EventEmitter & { cancel: jest.Mock };
      stream.cancel = jest.fn();
      return stream;
    }

    it('should track thread_id from stream chunks', async () => {
      const mockStream = createMockStream();
      mockGrpcService.runPlaybookWorkflow.mockReturnValue(mockStream);

      const execution = createMockExecution({
        taskResults: [{ taskId: 'task-1', status: StepStatus.PENDING, components: [] }],
      });
      mockPlaybookService.findRawById.mockResolvedValue(
        createMockPlaybook({ tasks: [createMockPlaybook().tasks[0]], edges: [] }),
      );
      mockExecutionModel.findOne.mockReturnValue(createChainMock(null));
      mockExecutionModel.create.mockResolvedValue({
        _id: objectId('exec1'),
        toString: () => objectId('exec1').toString(),
      });
      mockExecutionModel.findById.mockReturnValue(createChainMock(execution));

      const userId = objectId('user1').toString();
      await service.executePlaybook(userId, objectId('pb1').toString(), {}, '');
      await waitForWorkflowStreamReady();

      // Emit with thread_id
      mockStream.emit('data', {
        thread_id: 'thread-xyz',
        step_update: {
          task_id: 'task-1',
          status: 'suspended',
          interrupt: { type: 'approval', task_id: 'task-1', message: 'Approve?' },
        },
      });

      // End stream — should use the tracked thread_id for interrupt handling
      mockStream.emit('end');
      await new Promise((resolve) => setImmediate(resolve));

      // Interrupt should use the tracked threadId
      expect(mockExecutionModel.findByIdAndUpdate).toHaveBeenCalledWith(
        objectId('exec1').toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: ExecutionStatus.INTERRUPTED,
            threadId: 'thread-xyz',
          }),
        }),
      );
    });
  });
});
