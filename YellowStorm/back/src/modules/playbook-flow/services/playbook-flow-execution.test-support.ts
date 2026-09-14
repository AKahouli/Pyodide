import {
  PlaybookFlowExecutionService,
} from './playbook-flow-execution.service';
import { PlaybookExecutionHitlResumeService } from '../execution/runtime/playbook-execution-hitl-resume.service';
import { PlaybookExecutionSingleStepPrepService } from '../execution/runtime/playbook-execution-single-step-prep.service';

import { PlaybookFlowObservabilityService } from './observability/playbook-flow-observability.service';
import { PlaybookFlowPublicReasoningParserService } from './observability/playbook-flow-public-reasoning-parser.service';
import { PlaybookFlowTraceRedactionService } from './observability/playbook-flow-trace-redaction.service';
import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { PlaybookFlowReplayPlanService } from './playbook-flow-replay-plan.service';

export function createExecutionServiceForTests(overrides?: {
  executionModel?: Record<string, any>;
  queueService?: Record<string, any>;
  flowService?: Record<string, any>;
  streamEvents?: Record<string, any>;
  configService?: Record<string, any>;
  runtimeClient?: Record<string, any>;
  routerDecisionModel?: Record<string, any>;
  builderService?: Record<string, any>;
  replayArtifactService?: Record<string, any>;
  replayPromptService?: Record<string, any>;
  replayReportService?: Record<string, any>;
  replayDriftService?: Record<string, any>;
  outputFormatService?: Record<string, any>;
  tokenBufferService?: Record<string, any>;
  executionLeaseService?: Record<string, any>;
  graphSanitizerService?: Record<string, any>;
  executionDispatcherService?: Record<string, any>;
  workspaceService?: Record<string, any>;
  hitlMemoryModel?: Record<string, any>;
  accessService?: Record<string, any>;
  executionSettingsResolver?: Record<string, any>;
}) {
  const executionModel = {
    exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(null) })),
    updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
    findById: jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
      }),
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) }),
    })),
    findByIdAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(undefined) })),
    ...overrides?.executionModel,
  };
  const taskResultModel = {
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findOne: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) })),
  };
  const routerDecisionModel = {
    create: jest.fn(),
    deleteMany: jest.fn(),
    ...overrides?.routerDecisionModel,
  };
  const configService = {
    get: jest.fn((key: string, fallback: unknown) => fallback),
    ...overrides?.configService,
  };
  const runtimeClient = {
    init: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(false),
    run: jest.fn(),
    runFromCheckpoint: jest.fn(),
    cancel: jest.fn(),
    resumeApproval: jest.fn(),
    resumeFromStep: jest.fn(),
    ...overrides?.runtimeClient,
  };
  const queueService = {
    release: jest.fn(),
    refreshPositions: jest.fn().mockResolvedValue([]),
    ...overrides?.queueService,
  };
  const idempotencyService = {
    reserve: jest.fn(),
    confirmLink: jest.fn(),
    release: jest.fn(),
  };
  const flowService = {
    findOneForExecutionStart: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }),
    findOne: jest.fn().mockResolvedValue({ nodes: [], controlEdges: [], dataBindings: [], settings: {} }),
    persistSanitizedExecutionGraph: jest.fn().mockResolvedValue(1),
    ...overrides?.flowService,
  };
  const builderService = {
    buildSnapshot: jest.fn().mockReturnValue({ settings: {}, nodes: [], controlEdges: [], dataBindings: [] }),
    ...overrides?.builderService,
  };
  const agentService = {
    buildGrpcAgentsForPlaybook: jest.fn(),
    buildGrpcConnectorRuntimeForPlaybook: jest.fn(),
    buildGrpcSkillsForPlaybook: jest.fn(),
  };
  const validatorService = {
    validate: jest.fn(),
    collectValidationErrors: jest.fn().mockReturnValue([]),
  };
  const streamEvents = {
    emitExecutionComplete: jest.fn(),
    emitExecutionCancelled: jest.fn(),
    emitExecutionStart: jest.fn(),
    emitRouterDecision: jest.fn(),
    emitQueuePositionUpdate: jest.fn(),
    emitStepComplete: jest.fn(),
    emitStepStart: jest.fn(),
    emitStepUpdate: jest.fn(),
    emitIteratorChildStepStarted: jest.fn(),
    emitIteratorChildStepCompleted: jest.fn(),
    emitInterrupt: jest.fn(),
    emitHitlInterruptResolved: jest.fn(),
    emitHitlMemorySaved: jest.fn(),
    ...overrides?.streamEvents,
  };
  const observabilityService = new PlaybookFlowObservabilityService(
    new PlaybookFlowTraceRedactionService(),
    new PlaybookFlowPublicReasoningParserService(),
  );
  const replayArtifactService = {
    resolveReplayArtifacts: async () => new Map(),
    resolveReplayArtifactByIdentity: jest.fn().mockResolvedValue(null),
    resolveActiveReplayArtifact: jest.fn().mockResolvedValue(null),
    ...overrides?.replayArtifactService,
  };
  const replayPromptService = {
    buildReplayPromptSection: () => '',
    ...overrides?.replayPromptService,
  };
  const replayReportService: Record<string, any> = {
    findLatestReportForExecutionTask: jest.fn().mockResolvedValue(null),
    ...overrides?.replayReportService,
  };
  const replayDriftService = {
    createPreRunReport: replayReportService.createPreRunReport ?? jest.fn().mockResolvedValue(undefined),
    recordCompletedTaskDrift: replayReportService.updateStructuralDrift ?? jest.fn().mockResolvedValue(undefined),
    backfillSemanticMatch: replayReportService.updateSemanticMatch ?? jest.fn().mockResolvedValue(undefined),
    ensureIterationReportMaterialized: replayReportService.ensureIterationReportMaterialized ?? jest.fn().mockResolvedValue(undefined),
    ...overrides?.replayDriftService,
  };
  const replayPlanService = new PlaybookFlowReplayPlanService();
  const outputContractService = new PlaybookFlowOutputContractService();
  const outputFormatService = {
    getActiveTemplates: jest.fn().mockResolvedValue(new Map()),
    ...overrides?.outputFormatService,
  };
  const executionLeaseService = {
    isEnabled: jest.fn().mockReturnValue(false),
    acquire: jest.fn().mockResolvedValue({ acquired: true }),
    release: jest.fn().mockResolvedValue(undefined),
    startHeartbeat: jest.fn(),
    hasActiveLease: jest.fn().mockResolvedValue(false),
    ...overrides?.executionLeaseService,
  };
  replayReportService.createPreRunReport = replayDriftService.createPreRunReport;
  replayReportService.updateStructuralDrift = replayDriftService.recordCompletedTaskDrift;
  replayReportService.updateSemanticMatch = replayDriftService.backfillSemanticMatch;
  replayReportService.ensureIterationReportMaterialized = replayDriftService.ensureIterationReportMaterialized;

  const workspaceService = {
    getStoragePathMapByIds: jest.fn().mockResolvedValue({}),
    ...overrides?.workspaceService,
  };

  const accessService = {
    assertExecutionAccess: jest.fn().mockResolvedValue(undefined),
    ...overrides?.accessService,
  };

  const hitlResumeService = new PlaybookExecutionHitlResumeService(
    executionModel as any,
    streamEvents as any,
    overrides?.hitlMemoryModel as any,
    accessService as any,
  );

  const singleStepPrepService = new PlaybookExecutionSingleStepPrepService(
    executionModel as any,
    taskResultModel as any,
  );

  const service = new PlaybookFlowExecutionService(
    executionModel as any,
    taskResultModel as any,
    routerDecisionModel as any,
    configService as any,
    runtimeClient as any,
    queueService as any,
    idempotencyService as any,
    flowService as any,
    builderService as any,
    validatorService as any,
    agentService as any,
    streamEvents as any,
    observabilityService as any,
    {} as any,
    replayArtifactService as any,
    replayPromptService as any,
    replayReportService as any,
    outputContractService as any,
    { validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: null, inactive: false }) } as any,
    outputFormatService as any,
    replayPlanService as any,
    replayDriftService as any,
    undefined as any,
    overrides?.tokenBufferService as any,
    executionLeaseService as any,
    overrides?.graphSanitizerService as any,
    overrides?.executionDispatcherService as any,
    undefined as any,
    undefined as any,
    undefined as any,
    workspaceService as any,
    overrides?.hitlMemoryModel as any,
    accessService as any,
    hitlResumeService,
    singleStepPrepService,
    overrides?.executionSettingsResolver as any,
  );

  return {
    service,
    executionModel,
    workspaceService,
    taskResultModel,
    queueService,
    flowService,
    streamEvents,
    routerDecisionModel,
    idempotencyService,
    builderService,
    agentService,
    replayArtifactService,
    replayPromptService,
    replayReportService,
    replayDriftService,
    replayPlanService,
    outputContractService,
    outputFormatService,
    executionLeaseService,
    runtimeClient,
    hitlResumeService,
  };
}

export function createNoopGraphSanitizer() {
  return {
    sanitize: jest.fn(({ nodes, controlEdges, dataBindings }) => ({
      nodes,
      controlEdges,
      dataBindings,
      removedDisabledNodeCount: 0,
      removedOrphanedEdgeCount: 0,
      removedOrphanedBindingCount: 0,
      removedStaleBindingCount: 0,
    })),
  };
}

